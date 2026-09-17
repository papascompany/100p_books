// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * DELETE·PATCH /api/projects/[id] (DEBT-9).
 *
 * 핵심 계약: 주문이 하나라도(상태 무관) 연결된 프로젝트는 **어떤 자식 데이터도 지우기 전에** 409.
 * 예전 구현은 cancelled 주문을 통과시킨 뒤 pages·photos 를 먼저 지우고 projects 삭제가 FK 로
 * 실패해 사진·페이지만 영구 손실됐다. 인메모리 mock 이 모든 쓰기를 기록해 그 순서를 검증한다.
 */

type Filter = [op: string, column: string, value: unknown];

const PROJECT_ID = "4b6f2a0e-7c1d-4f7a-9a51-2b1f0c3d4e5f";

const state = vi.hoisted(() => ({
  project: null as null | { id: string; user_id: string },
  orders: [] as Array<{ project_id: string; status: string }>,
  mutations: [] as Array<{ table: string; action: string; filters: Array<[string, string, unknown]> }>,
  orderQueries: [] as Array<Array<[string, string, unknown]>>,
  projectDeleteError: null as null | { code: string; message: string },
  activeUserError: null as null | (Error & { status?: number; code?: string }),
  calls: [] as string[],
}));

vi.mock("@/lib/auth/session", () => ({
  requireUser: vi.fn(async () => {
    state.calls.push("requireUser");
    return { id: "user-1" };
  }),
  requireActiveUser: vi.fn(async () => {
    state.calls.push("requireActiveUser");
    if (state.activeUserError) throw state.activeUserError;
    return { id: "user-1" };
  }),
}));

function serverTable(table: string) {
  const filters: Filter[] = [];
  let action: "select" | "delete" | "update" = "select";
  let values: Record<string, unknown> = {};
  const b = {
    select() {
      return b;
    },
    delete() {
      action = "delete";
      return b;
    },
    update(v: Record<string, unknown>) {
      action = "update";
      values = v;
      return b;
    },
    eq(column: string, value: unknown) {
      filters.push(["eq", column, value]);
      return b;
    },
    async maybeSingle() {
      return { data: table === "projects" ? state.project : null, error: null };
    },
    async single() {
      state.mutations.push({ table, action, filters });
      return {
        data: { id: PROJECT_ID, title: values.title ?? null, status: "draft", book_size_id: null },
        error: null,
      };
    },
    then<T>(
      resolve: (v: { data: unknown; error: unknown }) => T,
      reject?: (e: unknown) => T,
    ) {
      const run = () => {
        state.mutations.push({ table, action, filters });
        if (table === "projects" && action === "delete") {
          if (state.projectDeleteError) return { data: null, error: state.projectDeleteError };
          const hit =
            state.project &&
            filters.every(([, col, v]) => (state.project as Record<string, unknown>)[col] === v);
          if (!hit) return { data: [], error: null };
          state.project = null;
          return { data: [{ id: PROJECT_ID }], error: null };
        }
        return { data: null, error: null };
      };
      return Promise.resolve().then(run).then(resolve, reject);
    },
  };
  return b;
}

vi.mock("@/lib/db/server", () => ({
  createServerSupabase: () => ({ from: (table: string) => serverTable(table) }),
}));

vi.mock("@/lib/db/admin", () => ({
  createAdminSupabase: () => ({
    from: (table: string) => {
      if (table !== "orders") throw new Error(`unexpected admin table ${table}`);
      const filters: Filter[] = [];
      const b = {
        select() {
          return b;
        },
        eq(column: string, value: unknown) {
          filters.push(["eq", column, value]);
          return b;
        },
        neq(column: string, value: unknown) {
          filters.push(["neq", column, value]);
          return b;
        },
        then<T>(
          resolve: (v: { count: number; error: null }) => T,
          reject?: (e: unknown) => T,
        ) {
          const run = () => {
            state.orderQueries.push(filters);
            const count = state.orders.filter((o) =>
              filters.every(([op, col, v]) => {
                const cell = (o as Record<string, unknown>)[col];
                return op === "eq" ? cell === v : cell !== v;
              }),
            ).length;
            return { count, error: null };
          };
          return Promise.resolve().then(run).then(resolve, reject);
        },
      };
      return b;
    },
  }),
}));

import { DELETE, PATCH } from "./route";

const ctx = { params: { id: PROJECT_ID } };

type Body = { ok: boolean; data?: Record<string, unknown>; error?: { code: string; message: string } };

async function del() {
  const res = await DELETE(new Request(`https://100p.test/api/projects/${PROJECT_ID}`, { method: "DELETE" }), ctx);
  return { status: res.status, body: (await res.json()) as Body };
}

beforeEach(() => {
  state.project = { id: PROJECT_ID, user_id: "user-1" };
  state.orders = [];
  state.mutations = [];
  state.orderQueries = [];
  state.projectDeleteError = null;
  state.activeUserError = null;
  state.calls = [];
});

describe("DELETE /api/projects/[id]", () => {
  it("cancelled 주문만 있어도 409 HAS_ORDERS — 어떤 삭제도 일어나지 않는다", async () => {
    state.orders = [{ project_id: PROJECT_ID, status: "cancelled" }];
    const { status, body } = await del();
    expect(status).toBe(409);
    expect(body.error?.code).toBe("HAS_ORDERS");
    expect(state.mutations).toEqual([]);
    expect(state.project).not.toBeNull();
  });

  it.each(["pending", "paid", "refunded", "delivered"])("%s 주문이 있어도 409", async (s) => {
    state.orders = [{ project_id: PROJECT_ID, status: s }];
    const { status } = await del();
    expect(status).toBe(409);
    expect(state.mutations).toEqual([]);
  });

  it("주문 판정은 상태 조건 없이 project_id 만으로 센다", async () => {
    await del();
    expect(state.orderQueries).toEqual([[["eq", "project_id", PROJECT_ID]]]);
  });

  it("주문 없는 프로젝트는 projects 한 번만 삭제한다 (자식은 FK cascade — 개별 삭제 없음)", async () => {
    state.orders = [{ project_id: "other-project", status: "paid" }];
    const { status, body } = await del();
    expect(status).toBe(200);
    expect(body.data).toEqual({ deleted: true });
    expect(state.mutations).toEqual([
      {
        table: "projects",
        action: "delete",
        filters: [
          ["eq", "id", PROJECT_ID],
          ["eq", "user_id", "user-1"],
        ],
      },
    ]);
  });

  it("판정 직후 주문이 붙어 FK 위반(23503)이면 409 — 문장 단위로 되돌려져 손실 없음", async () => {
    state.projectDeleteError = { code: "23503", message: "violates foreign key constraint" };
    const { status, body } = await del();
    expect(status).toBe(409);
    expect(body.error?.code).toBe("HAS_ORDERS");
    expect(state.mutations.map((m) => m.table)).toEqual(["projects"]);
  });

  it("그 밖의 삭제 오류는 500 PROJECT_DELETE_FAILED", async () => {
    state.projectDeleteError = { code: "XX000", message: "boom" };
    const { status, body } = await del();
    expect(status).toBe(500);
    expect(body.error?.code).toBe("PROJECT_DELETE_FAILED");
  });

  it("남의 프로젝트는 403 — 주문 조회·삭제 없음", async () => {
    state.project = { id: PROJECT_ID, user_id: "someone-else" };
    const { status } = await del();
    expect(status).toBe(403);
    expect(state.orderQueries).toEqual([]);
    expect(state.mutations).toEqual([]);
  });

  it("탈퇴 처리 중 계정은 requireActiveUser 가 410 으로 막는다", async () => {
    state.activeUserError = Object.assign(new Error("탈퇴 처리 중"), {
      status: 410,
      code: "ACCOUNT_DELETED",
    });
    const { status } = await del();
    expect(status).toBe(410);
    expect(state.calls).toEqual(["requireActiveUser"]);
    expect(state.mutations).toEqual([]);
  });
});

describe("PATCH /api/projects/[id]", () => {
  function patch(body: unknown) {
    return PATCH(
      new Request(`https://100p.test/api/projects/${PROJECT_ID}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
      ctx,
    );
  }

  it("requireActiveUser 를 쓴다 (requireUser 아님)", async () => {
    const res = await patch({ title: "새 제목" });
    expect(res.status).toBe(200);
    expect(state.calls).toEqual(["requireActiveUser"]);
  });

  it("탈퇴 처리 중 계정은 410 — 수정 없음", async () => {
    state.activeUserError = Object.assign(new Error("탈퇴 처리 중"), {
      status: 410,
      code: "ACCOUNT_DELETED",
    });
    const res = await patch({ title: "새 제목" });
    expect(res.status).toBe(410);
    expect(state.mutations).toEqual([]);
  });
});

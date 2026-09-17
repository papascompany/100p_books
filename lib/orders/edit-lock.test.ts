// @vitest-environment node
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import { failFromError } from "@/app/api/_lib/response";
import type { Database, OrderStatus } from "@/lib/db/types";

import {
  assertProjectsEditable,
  excludeLockedProjectRows,
  findLockedProjectIds,
  orderStatusLocksEditing,
  partitionRowsByProjectLock,
  PROJECT_LOCKED_MESSAGE,
  ProjectLockCheckError,
  ProjectLockedError,
} from "./edit-lock";
import { ALL_ORDER_STATUSES, canDownloadPdfs } from "./state";

/**
 * lib/orders/edit-lock (DEBT-2) — 결제 이후 주문이 있으면 편집 잠금.
 * 판정표·fail-closed·표준 응답 변환을 고정한다.
 */

const LOCKED: OrderStatus[] = ["paid", "in_production", "shipped", "delivered"];
const EDITABLE: OrderStatus[] = ["pending", "cancelled", "refunded"];

describe("orderStatusLocksEditing — 상태 판정표", () => {
  it.each(LOCKED)("%s → 잠금", (status) => {
    expect(orderStatusLocksEditing(status)).toBe(true);
  });

  it.each(EDITABLE)("%s → 편집 허용", (status) => {
    expect(orderStatusLocksEditing(status)).toBe(false);
  });

  it("모든 주문 상태가 분류돼 있고, 잠금 집합은 결제 이후(canDownloadPdfs) 집합과 같다", () => {
    expect([...LOCKED, ...EDITABLE].sort()).toEqual([...ALL_ORDER_STATUSES].sort());
    for (const status of ALL_ORDER_STATUSES) {
      expect(orderStatusLocksEditing(status)).toBe(canDownloadPdfs(status));
    }
  });

  it.each(["", "PAID", "partially_refunded", "toString", "__proto__"])(
    "모르는 상태 %j → 잠금 (fail-closed)",
    (status) => {
      expect(orderStatusLocksEditing(status)).toBe(true);
    },
  );
});

describe("findLockedProjectIds", () => {
  it("pending/cancelled/refunded 만 있는 프로젝트는 잠기지 않는다", () => {
    expect(
      findLockedProjectIds([
        { project_id: "p1", status: "pending" },
        { project_id: "p1", status: "cancelled" },
        { project_id: "p1", status: "refunded" },
      ]),
    ).toEqual([]);
  });

  it("같은 프로젝트에 취소 주문과 결제 주문이 섞여 있으면 잠금 (중복 제거)", () => {
    expect(
      findLockedProjectIds([
        { project_id: "p1", status: "cancelled" },
        { project_id: "p2", status: "pending" },
        { project_id: "p1", status: "paid" },
        { project_id: "p1", status: "delivered" },
        { project_id: "p3", status: "in_production" },
      ]),
    ).toEqual(["p1", "p3"]);
  });

  it("주문이 없으면 잠기지 않는다", () => {
    expect(findLockedProjectIds([])).toEqual([]);
  });
});

type OrdersResult = {
  data: Array<{ project_id: string; status: string }> | null;
  error: { message: string } | null;
};

function fakeAdmin(result: OrdersResult) {
  const calls: Array<{ table: string; columns: string; column: string; values: unknown[] }> = [];
  const client = {
    from: (table: string) => ({
      select: (columns: string) => ({
        in: async (column: string, values: unknown[]) => {
          calls.push({ table, columns, column, values });
          return result;
        },
      }),
    }),
  };
  return { admin: client as unknown as SupabaseClient<Database>, calls };
}

describe("assertProjectsEditable", () => {
  it("결제 이후 주문이 없으면 통과, orders 를 project_id IN 으로 1회 조회", async () => {
    const { admin, calls } = fakeAdmin({
      data: [
        { project_id: "p1", status: "pending" },
        { project_id: "p2", status: "refunded" },
      ],
      error: null,
    });
    await expect(assertProjectsEditable(admin, ["p1", "p2", "p1"])).resolves.toBeUndefined();
    expect(calls).toEqual([
      { table: "orders", columns: "project_id, status", column: "project_id", values: ["p1", "p2"] },
    ]);
  });

  it("단일 id 문자열도 받는다", async () => {
    const { admin, calls } = fakeAdmin({ data: [], error: null });
    await assertProjectsEditable(admin, "p9");
    expect(calls[0]?.values).toEqual(["p9"]);
  });

  it("빈 목록은 조회하지 않는다", async () => {
    const { admin, calls } = fakeAdmin({ data: [], error: null });
    await assertProjectsEditable(admin, []);
    expect(calls).toEqual([]);
  });

  it("paid 주문이 있으면 ProjectLockedError → failFromError 로 409 PROJECT_LOCKED", async () => {
    const { admin } = fakeAdmin({
      data: [
        { project_id: "p1", status: "cancelled" },
        { project_id: "p2", status: "paid" },
      ],
      error: null,
    });
    const err = await assertProjectsEditable(admin, ["p1", "p2"]).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ProjectLockedError);
    expect((err as ProjectLockedError).projectIds).toEqual(["p2"]);

    const res = failFromError(err);
    expect(res.status).toBe(409);
    const json = (await res.json()) as { ok: boolean; error: { code: string; message: string } };
    expect(json).toEqual({
      ok: false,
      error: { code: "PROJECT_LOCKED", message: PROJECT_LOCKED_MESSAGE },
    });
    expect(json.error.message).toContain("결제가 완료된 포토북은 수정할 수 없어요");
  });

  it("조회 실패는 통과시키지 않는다 — 503, 원문 비노출", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { admin } = fakeAdmin({ data: null, error: { message: "relation secret_internal" } });
    const err = await assertProjectsEditable(admin, "p1").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ProjectLockCheckError);

    const res = failFromError(err);
    expect(res.status).toBe(503);
    const json = (await res.json()) as { error: { code: string; message: string } };
    expect(json.error.code).toBe("PROJECT_LOCK_CHECK_FAILED");
    expect(json.error.message).not.toContain("secret_internal");
    warn.mockRestore();
  });
});

describe("partitionRowsByProjectLock", () => {
  it("잠긴 프로젝트 소속 행과 나머지를 입력 순서대로 나눈다", () => {
    const rows = [
      { id: "a", project_id: "p1" },
      { id: "b", project_id: "p2" },
      { id: "c", project_id: "p1" },
      { id: "d", project_id: "p3" },
    ];
    expect(partitionRowsByProjectLock(rows, ["p1"])).toEqual({
      editable: [rows[1], rows[3]],
      locked: [rows[0], rows[2]],
    });
    expect(partitionRowsByProjectLock(rows, [])).toEqual({ editable: rows, locked: [] });
  });
});

describe("excludeLockedProjectRows — 여러 포토북에 걸친 배치", () => {
  const rows = [
    { id: "a", project_id: "p1" },
    { id: "b", project_id: "p2" },
    { id: "c", project_id: "p1" },
  ];

  it("잠긴 포토북 사진만 빼고 돌려준다 — 조회는 중복 제거한 project_id 로 1회", async () => {
    const { admin, calls } = fakeAdmin({
      data: [
        { project_id: "p1", status: "shipped" },
        { project_id: "p2", status: "cancelled" },
      ],
      error: null,
    });
    await expect(excludeLockedProjectRows(admin, rows)).resolves.toEqual({
      editable: [rows[1]],
      skippedLocked: 2,
    });
    expect(calls).toEqual([
      { table: "orders", columns: "project_id, status", column: "project_id", values: ["p1", "p2"] },
    ]);
  });

  it("잠긴 포토북이 없으면 전부 돌려준다", async () => {
    const { admin } = fakeAdmin({ data: [{ project_id: "p1", status: "pending" }], error: null });
    await expect(excludeLockedProjectRows(admin, rows)).resolves.toEqual({
      editable: rows,
      skippedLocked: 0,
    });
  });

  it("전부 잠긴 포토북 소속이면 ProjectLockedError (409)", async () => {
    const { admin } = fakeAdmin({
      data: [
        { project_id: "p1", status: "paid" },
        { project_id: "p2", status: "delivered" },
      ],
      error: null,
    });
    const err = await excludeLockedProjectRows(admin, rows).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ProjectLockedError);
    expect(failFromError(err).status).toBe(409);
  });

  it("빈 배치는 조회하지 않는다", async () => {
    const { admin, calls } = fakeAdmin({ data: [], error: null });
    await expect(excludeLockedProjectRows(admin, [])).resolves.toEqual({ editable: [], skippedLocked: 0 });
    expect(calls).toEqual([]);
  });

  it("조회 실패는 부분 처리하지 않는다 — ProjectLockCheckError (503)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { admin } = fakeAdmin({ data: null, error: { message: "boom" } });
    const err = await excludeLockedProjectRows(admin, rows).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ProjectLockCheckError);
    warn.mockRestore();
  });
});

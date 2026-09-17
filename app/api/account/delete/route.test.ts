// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * POST /api/account/delete 라우트 흐름 테스트.
 * DEBT-3: soft delete, 정리·auth 실패를 성공으로 응답하지 않음, 익명화 후 재시도 가능,
 * 탈퇴 후 공개 공유 링크·미주문 프로젝트·프로필 식별 필드가 남지 않음.
 *
 * 콘텐츠 정리는 실제 lib/auth/account-content-store 를 쓰고, service_role 클라이언트만
 * 인메모리 테이블(필터·FK cascade 흉내)로 바꾼다 → Supabase 호출 모양까지 검증한다.
 */

type Row = Record<string, unknown>;
type Filter = { op: "eq" | "in"; column: string; value: unknown };

const USER_ID = "user-1";

const state = vi.hoisted(() => ({
  profile: null as null | {
    id: string;
    email: string | null;
    display_name: string | null;
    deleted_at: string | null;
  },
  blockingCount: 0,
  tables: {} as Record<string, Array<Record<string, unknown>>>,
  storage: {} as Record<string, Set<string>>,
  calls: [] as string[],
  deleteUserArgs: [] as unknown[][],
  anonymizeError: null as null | { message: string },
  deleteUserError: null as null | { message: string },
  failMutation: null as null | string,
  enqueued: [] as Array<{ to: { email: string; name?: string } }>,
  signOut: vi.fn(async () => ({ error: null })),
}));

vi.mock("@/lib/auth/session", () => ({
  requireUser: vi.fn(async () => ({ id: "user-1", email: "me@example.com" })),
  requireActiveUser: vi.fn(async () => {
    throw new Error("account/delete must not use requireActiveUser");
  }),
}));

vi.mock("@/lib/security/rate-limit", () => ({
  enforceRateLimit: vi.fn(async () => ({ success: true, reset: 0, limit: 5 })),
}));

vi.mock("@/lib/db/server", () => ({
  createServerSupabase: () => ({
    auth: { signOut: state.signOut },
    from: (table: string) => {
      if (table === "profiles") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: state.profile, error: null }),
            }),
          }),
        };
      }
      // orders — select(..., {count, head}).eq().in()
      return {
        select: () => ({
          eq: () => ({
            in: async () => ({ count: state.blockingCount, error: null }),
          }),
        }),
      };
    },
  }),
}));

/** 최소 PostgREST 흉내: select/delete/update + eq/in/order/range/limit, projects 삭제 시 cascade. */
function tableBuilder(table: string) {
  let action: "select" | "delete" | "update" = "select";
  let payload: Row = {};
  let columns = "*";
  const filters: Filter[] = [];
  let range: [number, number] | null = null;
  let limit: number | null = null;

  const matches = (row: Row) =>
    filters.every((f) =>
      f.op === "eq" ? row[f.column] === f.value : (f.value as unknown[]).includes(row[f.column]),
    );

  const run = (): { data: Row[] | null; error: { message: string } | null } => {
    const rows = state.tables[table] ?? [];
    if (action !== "select") {
      const key = `${table}.${action}`;
      state.calls.push(key);
      if (state.failMutation === key) return { data: null, error: { message: `${key} failed` } };
    }
    if (action === "delete") {
      const removed = rows.filter(matches);
      state.tables[table] = rows.filter((r) => !matches(r));
      if (table === "projects") {
        const ids = removed.map((r) => r.id);
        for (const child of ["photos", "pages", "share_tokens"]) {
          state.tables[child] = (state.tables[child] ?? []).filter(
            (r) => !ids.includes(r.project_id),
          );
        }
      }
      return { data: null, error: null };
    }
    if (action === "update") {
      state.tables[table] = rows.map((r) => (matches(r) ? { ...r, ...payload } : r));
      return { data: null, error: null };
    }
    let out = rows.filter(matches);
    if (range) out = out.slice(range[0], range[1] + 1);
    if (limit !== null) out = out.slice(0, limit);
    const cols = columns.split(",").map((c) => c.trim());
    return {
      data: out.map((r) => (columns === "*" ? r : Object.fromEntries(cols.map((c) => [c, r[c]])))),
      error: null,
    };
  };

  const builder = {
    select(cols?: string) {
      columns = cols ?? "*";
      return builder;
    },
    delete() {
      action = "delete";
      return builder;
    },
    update(values: Row) {
      action = "update";
      payload = values;
      return builder;
    },
    eq(column: string, value: unknown) {
      filters.push({ op: "eq", column, value });
      return builder;
    },
    in(column: string, value: unknown[]) {
      filters.push({ op: "in", column, value });
      return builder;
    },
    order() {
      return builder;
    },
    range(from: number, to: number) {
      range = [from, to];
      return builder;
    },
    limit(n: number) {
      limit = n;
      return builder;
    },
    then<T>(resolve: (v: ReturnType<typeof run>) => T, reject?: (e: unknown) => T) {
      return Promise.resolve().then(run).then(resolve, reject);
    },
  };
  return builder;
}

vi.mock("@/lib/db/admin", () => ({
  createAdminSupabase: () => ({
    rpc: async (fn: string) => {
      state.calls.push(fn);
      if (fn === "anonymize_account" && !state.anonymizeError && state.profile) {
        state.profile = {
          ...state.profile,
          email: null,
          display_name: "탈퇴회원",
          deleted_at: state.profile.deleted_at ?? "2026-09-17T00:00:00Z",
        };
      }
      return { data: null, error: state.anonymizeError };
    },
    from: (table: string) => tableBuilder(table),
    storage: {
      from: (bucket: string) => ({
        remove: async (keys: string[]) => {
          state.calls.push(`storage.remove(${bucket})`);
          for (const k of keys) state.storage[bucket]?.delete(k);
          return { data: [], error: null };
        },
      }),
    },
    auth: {
      admin: {
        deleteUser: async (...args: unknown[]) => {
          state.calls.push("deleteUser");
          state.deleteUserArgs.push(args);
          return { data: { user: null }, error: state.deleteUserError };
        },
      },
    },
  }),
}));

vi.mock("@/lib/email/queue", () => ({
  enqueueEmail: vi.fn(
    async (args: {
      to: { email: string; name?: string };
      template: string;
      relatedType?: string;
      relatedId?: string;
    }) => {
      state.calls.push("enqueueEmail");
      state.enqueued.push(args);
      (state.tables.email_jobs ??= []).push({
        id: `job-${state.enqueued.length}`,
        template: args.template,
        related_type: args.relatedType ?? null,
        related_id: args.relatedId ?? null,
      });
      return { ok: true, jobId: "j", sent: false };
    },
  ),
}));

import { POST } from "./route";

function request() {
  return new Request("https://100pbooks.vercel.app/api/account/delete", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ confirmEmail: "me@example.com", confirmText: "회원 탈퇴" }),
  });
}

function seedTables() {
  state.tables = {
    profiles: [{ id: USER_ID, avatar_url: "https://k.kakaocdn.net/me.jpg", oauth_provider: "kakao" }],
    projects: [
      { id: "p-draft", user_id: USER_ID },
      { id: "p-ordered", user_id: USER_ID },
      { id: "p-other", user_id: "user-2" },
    ],
    orders: [{ id: "o-1", project_id: "p-ordered", user_id: USER_ID }],
    photos: [
      { id: "ph-1", project_id: "p-draft", storage_key: "user-1/p-draft/ph-1.jpg", thumb_key: "user-1/p-draft/ph-1.webp" },
      { id: "ph-2", project_id: "p-ordered", storage_key: "user-1/p-ordered/ph-2.jpg", thumb_key: "user-1/p-ordered/ph-2.webp" },
      { id: "ph-3", project_id: "p-other", storage_key: "user-2/p-other/ph-3.jpg", thumb_key: null },
    ],
    pages: [
      { id: "pg-1", project_id: "p-draft" },
      { id: "pg-2", project_id: "p-ordered" },
    ],
    share_tokens: [
      { id: "st-draft", project_id: "p-draft" },
      { id: "st-ordered", project_id: "p-ordered" },
      { id: "st-other", project_id: "p-other" },
    ],
    email_jobs: [],
  };
  state.storage = {
    "photo-originals": new Set([
      "user-1/p-draft/ph-1.jpg",
      "user-1/p-ordered/ph-2.jpg",
      "user-2/p-other/ph-3.jpg",
    ]),
    "photo-thumbs": new Set(["user-1/p-draft/ph-1.webp", "user-1/p-ordered/ph-2.webp"]),
  };
}

const ids = (table: string) => (state.tables[table] ?? []).map((r) => r.id);

beforeEach(() => {
  state.profile = {
    id: USER_ID,
    email: "me@example.com",
    display_name: "홍길동",
    deleted_at: null,
  };
  state.blockingCount = 0;
  seedTables();
  state.calls = [];
  state.deleteUserArgs = [];
  state.anonymizeError = null;
  state.deleteUserError = null;
  state.failMutation = null;
  state.enqueued = [];
  state.signOut.mockClear();
});

describe("POST /api/account/delete", () => {
  it("성공: 익명화 → 콘텐츠 정리 → soft delete(id, true) → 안내 메일, 200", async () => {
    const res = await POST(request());
    const json = (await res.json()) as { ok: boolean; data: Record<string, unknown> };
    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.data).toMatchObject({ authDeleted: true, anonymized: true, resumed: false });
    expect(state.calls).toEqual([
      "anonymize_account",
      "share_tokens.delete",
      "profiles.update",
      "projects.delete",
      "storage.remove(photo-originals)",
      "storage.remove(photo-thumbs)",
      "deleteUser",
      "enqueueEmail",
    ]);
    expect(state.deleteUserArgs).toEqual([["user-1", true]]);
    expect(state.enqueued[0]?.to).toEqual({ email: "me@example.com", name: "홍길동" });
    // 전역 로그아웃 요청 + 쿠키 제거 (세션이 이미 없으면 auth-js 가 403 을 무시)
    expect(state.signOut).toHaveBeenCalledWith({ scope: "global" });
  });

  it("탈퇴 후 공개 공유 링크가 남지 않는다 (주문된 프로젝트 포함), 다른 사용자 링크는 유지", async () => {
    expect((await POST(request())).status).toBe(200);
    expect(ids("share_tokens")).toEqual(["st-other"]);
  });

  it("미주문 프로젝트·사진·페이지와 그 Storage 객체는 삭제, 주문된 프로젝트는 보존", async () => {
    expect((await POST(request())).status).toBe(200);
    expect(ids("projects")).toEqual(["p-ordered", "p-other"]);
    expect(ids("photos")).toEqual(["ph-2", "ph-3"]);
    expect(ids("pages")).toEqual(["pg-2"]);
    expect([...state.storage["photo-originals"]!]).toEqual([
      "user-1/p-ordered/ph-2.jpg",
      "user-2/p-other/ph-3.jpg",
    ]);
    expect([...state.storage["photo-thumbs"]!]).toEqual(["user-1/p-ordered/ph-2.webp"]);
  });

  it("profiles.avatar_url · oauth_provider 를 비운다", async () => {
    expect((await POST(request())).status).toBe(200);
    expect(state.tables.profiles?.[0]).toMatchObject({ avatar_url: null, oauth_provider: null });
  });

  it("콘텐츠 정리 실패 → 500 CONTENT_PURGE_FAILED, auth·메일 단계로 가지 않고 원문 비노출", async () => {
    state.failMutation = "share_tokens.delete";
    const res = await POST(request());
    const json = (await res.json()) as { ok: boolean; error: { code: string; message: string } };
    expect(res.status).toBe(500);
    expect(json.error.code).toBe("CONTENT_PURGE_FAILED");
    expect(json.error.message).not.toContain("share_tokens");
    expect(state.calls).toEqual(["anonymize_account", "share_tokens.delete"]);
    expect(state.deleteUserArgs).toEqual([]);
    expect(state.enqueued).toEqual([]);

    // 같은 요청 재시도 → 완료
    state.failMutation = null;
    const retry = await POST(request());
    expect(retry.status).toBe(200);
    expect(((await retry.json()) as { data: Record<string, unknown> }).data).toMatchObject({
      resumed: true,
    });
    expect(ids("share_tokens")).toEqual(["st-other"]);
  });

  it("프로젝트 삭제 실패도 성공으로 응답하지 않는다", async () => {
    state.failMutation = "projects.delete";
    const res = await POST(request());
    expect(res.status).toBe(500);
    expect(state.deleteUserArgs).toEqual([]);
  });

  it("auth 삭제 실패는 200 이 아니다 (이전: 200 authDeleted:false) + 메일 없음", async () => {
    state.deleteUserError = { message: "Database error deleting user" };
    const res = await POST(request());
    const json = (await res.json()) as { ok: boolean; error: { code: string; message: string } };
    expect(res.status).toBe(500);
    expect(json.ok).toBe(false);
    expect(json.error.code).toBe("AUTH_DELETE_FAILED");
    expect(json.error.message).not.toContain("Database error");
    expect(state.calls.at(-1)).toBe("deleteUser");
    expect(state.enqueued).toEqual([]);
    expect(state.signOut).not.toHaveBeenCalled();
  });

  it("auth 실패 후 같은 요청 재시도 → 완료 (resumed), 안내 메일은 전체 1회", async () => {
    state.deleteUserError = { message: "temporary" };
    expect((await POST(request())).status).toBe(500);
    expect(state.profile?.deleted_at).not.toBeNull();

    state.deleteUserError = null;
    const res = await POST(request());
    const json = (await res.json()) as { ok: boolean; data: Record<string, unknown> };
    expect(res.status).toBe(200);
    expect(json.data).toMatchObject({ authDeleted: true, resumed: true });
    expect(state.enqueued).toHaveLength(1);
    // 익명화된 display_name('탈퇴회원') 대신 이메일 앞부분으로 부른다.
    expect(state.enqueued[0]?.to.name).toBe("me");
  });

  it("안내 메일이 이미 큐에 있으면(이전 구현이 남긴 중간 상태 재시도·중복 요청) 다시 넣지 않는다", async () => {
    state.profile = { ...state.profile!, deleted_at: "2026-09-01T00:00:00Z", display_name: "탈퇴회원" };
    state.tables.email_jobs = [
      { id: "legacy", template: "user.account_deleted", related_type: "user", related_id: USER_ID },
    ];
    const res = await POST(request());
    expect(res.status).toBe(200);
    expect(state.enqueued).toEqual([]);

    // 완료 뒤 같은 요청이 한 번 더 들어와도(동시 요청의 뒤쪽) 메일은 추가되지 않는다.
    expect((await POST(request())).status).toBe(200);
    expect(state.enqueued).toEqual([]);
  });

  it("익명화 실패 → 500, 정리·auth 단계로 가지 않음", async () => {
    state.anonymizeError = { message: "rpc down" };
    const res = await POST(request());
    expect(res.status).toBe(500);
    expect(state.calls).toEqual(["anonymize_account"]);
  });

  it("진행 중 주문 → 409, 아무 단계도 실행하지 않음", async () => {
    state.blockingCount = 1;
    const res = await POST(request());
    expect(res.status).toBe(409);
    expect(state.calls).toEqual([]);
    expect(ids("share_tokens")).toHaveLength(3);
  });
});

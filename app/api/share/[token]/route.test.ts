// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * GET /api/share/[token] — 공개 공유 뷰어.
 * DEBT-3: 프로젝트 소유자가 탈퇴(profiles.deleted_at)했으면 토큰이 남아 있어도 404 로,
 * 사진 썸네일 서명 URL·페이지·조회수 증가까지 가지 않는다.
 * service_role 클라이언트는 인메모리 테이블(eq/is/order/maybeSingle)로 바꾼다.
 */

type Row = Record<string, unknown>;

const TOKEN = "0c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f";
const OWNER = "owner-1";
const PROJECT = "project-1";

const state = vi.hoisted(() => ({
  tables: {} as Record<string, Array<Record<string, unknown>>>,
  errors: {} as Record<string, { message: string }>,
  calls: [] as string[],
}));

function tableBuilder(table: string) {
  const filters: Array<(r: Row) => boolean> = [];
  let columns = "*";
  const run = () => {
    const err = state.errors[table];
    if (err) return { data: null, error: err };
    const rows = (state.tables[table] ?? []).filter((r) => filters.every((f) => f(r)));
    const cols = columns.split(",").map((c) => c.trim());
    const data = rows.map((r) =>
      columns === "*" ? r : Object.fromEntries(cols.map((c) => [c, r[c]])),
    );
    return { data, error: null };
  };
  const builder = {
    select(cols?: string) {
      columns = cols ?? "*";
      state.calls.push(`${table}.select`);
      return builder;
    },
    eq(column: string, value: unknown) {
      filters.push((r) => r[column] === value);
      return builder;
    },
    is(column: string, value: unknown) {
      filters.push((r) => (r[column] ?? null) === value);
      return builder;
    },
    order() {
      return builder;
    },
    async maybeSingle() {
      const { data, error } = run();
      return { data: data?.[0] ?? null, error };
    },
    then<T>(resolve: (v: ReturnType<typeof run>) => T, reject?: (e: unknown) => T) {
      return Promise.resolve().then(run).then(resolve, reject);
    },
  };
  return builder;
}

vi.mock("@/lib/db/admin", () => ({
  createAdminSupabase: () => ({
    from: (table: string) => tableBuilder(table),
    rpc: async (fn: string) => {
      state.calls.push(`rpc.${fn}`);
      return { data: 8, error: null };
    },
    storage: {
      from: () => ({
        createSignedUrls: async (paths: string[]) => {
          state.calls.push("storage.createSignedUrls");
          return {
            data: paths.map((path) => ({ path, signedUrl: `https://signed.example/${path}` })),
            error: null,
          };
        },
      }),
    },
  }),
}));

import { GET } from "./route";

function seed(ownerDeletedAt: string | null) {
  state.errors = {};
  state.calls = [];
  state.tables = {
    share_tokens: [
      {
        id: "st-1",
        project_id: PROJECT,
        token: TOKEN,
        expires_at: null,
        view_count: 7,
        created_at: "2026-09-01T00:00:00Z",
      },
    ],
    projects: [
      {
        id: PROJECT,
        user_id: OWNER,
        title: "여름 여행",
        layout_mode: "polaroid",
        book_size_id: "size-1",
        cover_json: null,
        created_at: "2026-09-01T00:00:00Z",
        updated_at: "2026-09-02T00:00:00Z",
      },
    ],
    profiles: [{ id: OWNER, deleted_at: ownerDeletedAt }],
    pages: [{ id: "page-1", project_id: PROJECT, page_no: 1, layout_mode: "polaroid", fabric_json: {} }],
    photos: [
      {
        id: "photo-1",
        project_id: PROJECT,
        thumb_key: `${OWNER}/${PROJECT}/photo-1.webp`,
        filename: "IMG_0001.jpg",
        width: 100,
        height: 100,
        exif_taken_at: null,
        order_idx: 0,
        deleted_at: null,
      },
    ],
  };
}

async function call() {
  const res = await GET(new Request(`https://100pbooks.vercel.app/api/share/${TOKEN}`), {
    params: Promise.resolve({ token: TOKEN }),
  });
  const json = (await res.json()) as {
    ok: boolean;
    data?: { project: Row; photos: Row[]; pages: Row[]; viewCount: number };
    error?: { code: string; message: string };
  };
  return { res, json };
}

const LEAK_CALLS = ["pages.select", "photos.select", "storage.createSignedUrls", "rpc.increment_share_view"];

beforeEach(() => seed(null));

describe("GET /api/share/[token] — 소유자 탈퇴 (DEBT-3)", () => {
  it("활성 소유자: 페이지·사진(서명 URL)·조회수를 돌려주고 소유자 id 는 싣지 않는다", async () => {
    const { res, json } = await call();
    expect(res.status).toBe(200);
    expect(json.data?.pages).toHaveLength(1);
    expect(json.data?.photos[0]?.thumbUrl).toContain("photo-1.webp");
    expect(json.data?.viewCount).toBe(8);
    expect(json.data?.project).not.toHaveProperty("user_id");
    expect(json.data?.project).not.toHaveProperty("userId");
  });

  it("탈퇴 소유자: 토큰 없음과 같은 404 NOT_FOUND, 사진·페이지·서명 URL·조회수 단계 미실행", async () => {
    seed("2026-09-17T00:00:00Z");
    const { res, json } = await call();
    expect(res.status).toBe(404);
    expect(json.ok).toBe(false);
    expect(json.error).toEqual({ code: "NOT_FOUND", message: "유효하지 않은 공유 링크입니다." });
    for (const c of LEAK_CALLS) expect(state.calls).not.toContain(c);
  });

  it("소유자 프로필 행이 없으면 404 (fail-closed)", async () => {
    state.tables.profiles = [];
    const { res, json } = await call();
    expect(res.status).toBe(404);
    expect(json.error?.code).toBe("NOT_FOUND");
    for (const c of LEAK_CALLS) expect(state.calls).not.toContain(c);
  });

  it("소유자 조회 실패는 500, DB 원문 비노출, 사진 단계 미실행", async () => {
    state.errors.profiles = { message: "permission denied for relation profiles" };
    const { res, json } = await call();
    expect(res.status).toBe(500);
    expect(json.error?.code).toBe("OWNER_QUERY_FAILED");
    expect(json.error?.message).not.toContain("permission denied");
    for (const c of LEAK_CALLS) expect(state.calls).not.toContain(c);
  });
});

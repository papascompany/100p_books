// @vitest-environment node
import type * as ReactModule from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 프로젝트 쓰기 라우트의 두 가드를 실제 라우트 핸들러로 고정한다 (F1a).
 *
 *   1) 탈퇴 가드 (DEBT-3) — requireActiveUser: 익명화된 계정은 410 ACCOUNT_DELETED, 가드 뒤 단계 미실행.
 *   2) 결제 후 편집 잠금 (DEBT-2) — assertProjectsEditable: paid 이후 주문이 달린 프로젝트는
 *      409 PROJECT_LOCKED, 쓰기(RPC·INSERT/UPDATE/DELETE·Storage) 0건. pending/cancelled/refunded 만 있으면 통과.
 *
 * lib/auth/session 과 lib/orders/edit-lock 은 mock 하지 않는다 — 라우트가 가드를 빼먹으면 실패한다.
 * Supabase 는 server/admin 공용 인메모리 테이블(PostgREST 필터 흉내)로 바꾸고 모든 쓰기를 기록한다.
 */

type Row = Record<string, unknown>;

const USER = "11111111-1111-4111-8111-111111111111";
const OTHER = "99999999-9999-4999-8999-999999999999";
const P1 = "22222222-2222-4222-8222-222222222222";
const P2 = "33333333-3333-4333-8333-333333333333";
const P_OTHER = "44444444-4444-4444-8444-444444444444";
const SIZE = "55555555-5555-4555-8555-555555555555";
const PAGE1 = "66666666-6666-4666-8666-666666666661";
const PAGE2 = "66666666-6666-4666-8666-666666666662";
const PHOTO_ACTIVE = "77777777-7777-4777-8777-777777777771";
const PHOTO_TRASHED = "77777777-7777-4777-8777-777777777772";
const NEW_PHOTO = "77777777-7777-4777-8777-777777777773";
const P2_PHOTO = "77777777-7777-4777-8777-777777777774";
const TOKEN_ID = "88888888-8888-4888-8888-888888888888";

const state = vi.hoisted(() => ({
  tables: {} as Record<string, Array<Record<string, unknown>>>,
  /** 모든 접근 기록 — 탈퇴 가드 테스트에서 가드 뒤 단계 미실행 확인용. */
  log: [] as string[],
  /** 쓰기만 — 편집 잠금 테스트에서 쓰기 0건 확인용. */
  writes: [] as string[],
}));

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof ReactModule>();
  return { ...actual, cache: <T>(fn: T): T => fn };
});

/** 최소 PostgREST 흉내: select(count/head)/insert/update/delete/upsert + eq/in/is/not/order/limit/maybeSingle/single. */
function tableBuilder(client: "server" | "admin", table: string) {
  let action: "select" | "insert" | "update" | "delete" | "upsert" = "select";
  let payload: Row | Row[] = {};
  let head = false;
  let withCount = false;
  let limit: number | null = null;
  const filters: Array<(r: Row) => boolean> = [];
  state.log.push(`${client}.from(${table})`);

  const run = () => {
    if (action !== "select") state.writes.push(`${client}.${table}.${action}`);
    const rows = state.tables[table] ?? [];
    const matches = (r: Row) => filters.every((f) => f(r));
    if (action === "insert" || action === "upsert") {
      const list = Array.isArray(payload) ? payload : [payload];
      const inserted = list.map((r) => ({ id: r.id ?? `gen-${rows.length + 1}`, ...r }));
      state.tables[table] = [...rows, ...inserted];
      return { data: inserted, error: null, count: null };
    }
    if (action === "update") {
      const updated: Row[] = [];
      state.tables[table] = rows.map((r) => {
        if (!matches(r)) return r;
        const next = { ...r, ...(payload as Row) };
        updated.push(next);
        return next;
      });
      return { data: updated, error: null, count: null };
    }
    if (action === "delete") {
      const removed = rows.filter(matches);
      state.tables[table] = rows.filter((r) => !matches(r));
      return { data: removed, error: null, count: removed.length };
    }
    let out = rows.filter(matches);
    if (limit !== null) out = out.slice(0, limit);
    return { data: head ? null : out, error: null, count: withCount ? out.length : null };
  };

  const builder = {
    select(_cols?: string, opts?: { count?: string; head?: boolean }) {
      head = opts?.head ?? false;
      withCount = Boolean(opts?.count);
      return builder;
    },
    insert(values: Row | Row[]) {
      action = "insert";
      payload = values;
      return builder;
    },
    upsert(values: Row | Row[]) {
      action = "upsert";
      payload = values;
      return builder;
    },
    update(values: Row) {
      action = "update";
      payload = values;
      return builder;
    },
    delete(opts?: { count?: string }) {
      action = "delete";
      withCount = Boolean(opts?.count);
      return builder;
    },
    eq(column: string, value: unknown) {
      filters.push((r) => r[column] === value);
      return builder;
    },
    in(column: string, values: unknown[]) {
      filters.push((r) => values.includes(r[column]));
      return builder;
    },
    is(column: string, value: unknown) {
      filters.push((r) => (r[column] ?? null) === value);
      return builder;
    },
    not(column: string, _op: "is", value: unknown) {
      filters.push((r) => (r[column] ?? null) !== value);
      return builder;
    },
    order() {
      return builder;
    },
    limit(n: number) {
      limit = n;
      return builder;
    },
    async maybeSingle() {
      const { data, error } = run();
      return { data: data?.[0] ?? null, error };
    },
    async single() {
      const { data, error } = run();
      return { data: data?.[0] ?? null, error };
    },
    then<T>(resolve: (v: ReturnType<typeof run>) => T, reject?: (e: unknown) => T) {
      return Promise.resolve().then(run).then(resolve, reject);
    },
  };
  return builder;
}

vi.mock("@/lib/db/server", () => ({
  createServerSupabase: () => ({
    auth: {
      getUser: async () => ({ data: { user: { id: USER, email: "me@example.com" } } }),
    },
    from: (table: string) => tableBuilder("server", table),
  }),
}));

vi.mock("@/lib/db/admin", () => ({
  createAdminSupabase: () => {
    state.log.push("admin");
    return {
      from: (table: string) => tableBuilder("admin", table),
      rpc: async (fn: string) => {
        state.log.push(`rpc.${fn}`);
        state.writes.push(`rpc.${fn}`);
        return { data: 2, error: null };
      },
      storage: {
        from: (bucket: string) => ({
          remove: async () => {
            state.writes.push(`storage.${bucket}.remove`);
            return { data: [], error: null };
          },
          copy: async () => {
            state.writes.push(`storage.${bucket}.copy`);
            return { data: {}, error: null };
          },
          upload: async () => {
            state.writes.push(`storage.${bucket}.upload`);
            return { data: {}, error: null };
          },
          download: async () => {
            state.log.push(`storage.${bucket}.download`);
            return { data: null, error: { message: "not found" } };
          },
          createSignedUploadUrl: async (key: string) => {
            state.writes.push(`storage.${bucket}.createSignedUploadUrl`);
            return { data: { signedUrl: `https://upload.example/${key}`, token: "t" }, error: null };
          },
        }),
      },
    };
  },
}));

vi.mock("@/lib/security/rate-limit", () => ({
  enforceRateLimit: async () => ({ success: true, limit: 30, remaining: 29, reset: 0 }),
}));

vi.mock("@/lib/analytics/funnel", () => ({
  trackFunnelEvent: async () => {
    state.writes.push("funnel");
  },
}));

vi.mock("@/lib/image/sharp-safe", () => ({
  UNTRUSTED_INPUT_OPTIONS: {},
  loadHardenedSharp: async () => () => {
    throw new Error("sharp should not run in this test");
  },
}));

// 미리보기 렌더 체인(@napi-rs/canvas) — 가드 테스트에서는 도달하지 않는다
vi.mock("@/lib/pdf/render-page", () => ({
  renderPageToPng: async () => {
    throw new Error("render should not run in this test");
  },
}));
vi.mock("@/lib/pdf/fonts", () => ({
  collectFontFamilies: () => [],
  registerProjectFonts: async () => undefined,
}));
vi.mock("@/lib/pdf/photos", () => ({
  createPhotoResolver: () => ({ resolve: async () => Buffer.alloc(0) }),
}));
vi.mock("@/lib/pdf/resources", () => ({
  createResourceResolver: () => ({
    resolveBackground: async () => Buffer.alloc(0),
    resolveClipart: async () => Buffer.alloc(0),
  }),
}));

import { POST as coverPreview } from "@/app/api/cover/preview/route";
import { POST as layoutGenerate } from "@/app/api/layout/generate/route";
import {
  GET as pagePreviewGet,
  POST as pagePreviewPost,
} from "@/app/api/pages/[id]/preview/route";
import { POST as pagesInsert } from "@/app/api/pages/insert/route";
import { POST as pagesReorder } from "@/app/api/pages/reorder/route";
import { POST as photosAbandon } from "@/app/api/photos/abandon/route";
import { POST as photosComplete } from "@/app/api/photos/complete/route";
import { POST as photosCopy } from "@/app/api/photos/copy-to-project/route";
import { POST as photosPurge } from "@/app/api/photos/purge/route";
import { POST as photosRestore } from "@/app/api/photos/restore/route";
import { POST as photosSignUpload } from "@/app/api/photos/sign-upload/route";
import { POST as photosTrash } from "@/app/api/photos/trash/route";
import { DELETE as shareTokenDelete } from "@/app/api/projects/[id]/share/[tokenId]/route";
import { GET as shareList, POST as shareCreate } from "@/app/api/projects/[id]/share/route";
import { POST as projectsCreate } from "@/app/api/projects/route";

function post(path: string, body: unknown) {
  return new Request(`https://100pbooks.vercel.app${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

type Json = { ok: boolean; data?: unknown; error?: { code: string; message: string } };

async function read(res: Response) {
  return { status: res.status, json: (await res.json()) as Json };
}

function seed(opts: { deletedAt?: string | null; orders?: Array<{ project_id: string; status: string }> } = {}) {
  state.log = [];
  state.writes = [];
  state.tables = {
    profiles: [{ id: USER, deleted_at: opts.deletedAt ?? null }],
    book_sizes: [
      {
        id: SIZE,
        name: "A5",
        width_mm: 148,
        height_mm: 210,
        cover_width_mm: 306,
        cover_height_mm: 216,
        spine_formula_per_page: 0.1,
        active: true,
        display_order: 1,
        created_at: "2026-01-01T00:00:00Z",
      },
    ],
    projects: [
      { id: P1, user_id: USER, book_size_id: SIZE, layout_mode: "polaroid", title: "P1", cover_json: null },
      { id: P2, user_id: USER, book_size_id: SIZE, layout_mode: "polaroid", title: "P2", cover_json: null },
      { id: P_OTHER, user_id: OTHER, book_size_id: SIZE, layout_mode: "polaroid", title: "X", cover_json: null },
    ],
    pages: [
      { id: PAGE1, project_id: P1, page_no: 1, layout_mode: "polaroid", fabric_json: null },
      { id: PAGE2, project_id: P1, page_no: 2, layout_mode: "polaroid", fabric_json: null },
    ],
    photos: [
      {
        id: PHOTO_ACTIVE,
        project_id: P1,
        storage_key: `${USER}/${P1}/${PHOTO_ACTIVE}.jpg`,
        thumb_key: `${USER}/${P1}/${PHOTO_ACTIVE}.webp`,
        filename: "a.jpg",
        mime: "image/jpeg",
        size_bytes: 1000,
        width: 1200,
        height: 800,
        exif_taken_at: null,
        exif_camera: null,
        order_idx: 0,
        created_at: "2026-09-01T00:00:00Z",
        deleted_at: null,
      },
      {
        id: PHOTO_TRASHED,
        project_id: P1,
        storage_key: `${USER}/${P1}/${PHOTO_TRASHED}.jpg`,
        thumb_key: `${USER}/${P1}/${PHOTO_TRASHED}.webp`,
        filename: "b.jpg",
        mime: "image/jpeg",
        size_bytes: 1000,
        width: 1200,
        height: 800,
        exif_taken_at: null,
        exif_camera: null,
        order_idx: 1,
        created_at: "2026-09-01T00:00:00Z",
        deleted_at: "2026-09-10T00:00:00Z",
      },
    ],
    orders: (opts.orders ?? []).map((o, i) => ({ id: `order-${i}`, user_id: USER, ...o })),
    share_tokens: [{ id: TOKEN_ID, project_id: P1, token: "tok", expires_at: null, view_count: 0 }],
  };
}

/** 프로젝트 내용을 바꾸는 쓰기 라우트 — [이름, 잠금 대상 프로젝트, 호출, 통과 시 기대 쓰기]. */
const LOCKED_ROUTES: Array<[string, string, () => Promise<Response>, string]> = [
  ["POST /api/pages/insert", P1, () => pagesInsert(post("/api/pages/insert", { projectId: P1 })), "admin.pages.insert"],
  [
    "POST /api/pages/reorder",
    P1,
    () => pagesReorder(post("/api/pages/reorder", { projectId: P1, pageIds: [PAGE2, PAGE1] })),
    "rpc.reorder_project_pages",
  ],
  [
    "POST /api/layout/generate (재생성)",
    P1,
    () =>
      layoutGenerate(
        post("/api/layout/generate", { projectId: P1, sortMode: "upload", layoutMode: "polaroid" }),
      ),
    "rpc.regenerate_project_pages",
  ],
  [
    "POST /api/photos/trash",
    P1,
    () => photosTrash(post("/api/photos/trash", { photoIds: [PHOTO_ACTIVE] })),
    "admin.photos.update",
  ],
  [
    "POST /api/photos/restore",
    P1,
    () => photosRestore(post("/api/photos/restore", { photoIds: [PHOTO_TRASHED] })),
    "admin.photos.update",
  ],
  [
    "POST /api/photos/copy-to-project (대상)",
    P2,
    () => photosCopy(post("/api/photos/copy-to-project", { photoIds: [PHOTO_ACTIVE], targetProjectId: P2 })),
    "admin.photos.insert",
  ],
  [
    "POST /api/photos/sign-upload",
    P1,
    () =>
      photosSignUpload(
        post("/api/photos/sign-upload", {
          projectId: P1,
          files: [{ filename: "c.jpg", mime: "image/jpeg", size: 1000 }],
        }),
      ),
    "storage.photo-originals.createSignedUploadUrl",
  ],
];

const COMPLETE_BODY = {
  projectId: P1,
  photos: [
    {
      photoId: NEW_PHOTO,
      storageKey: `${USER}/${P1}/${NEW_PHOTO}.jpg`,
      filename: "c.jpg",
      mime: "image/jpeg",
      sizeBytes: 1000,
      orderIdx: 2,
    },
  ],
};

beforeEach(() => seed());

describe("결제 후 편집 잠금 (DEBT-2) — 프로젝트 내용 쓰기 라우트", () => {
  for (const [name, lockedProject, call] of LOCKED_ROUTES) {
    it.each(["paid", "in_production", "shipped", "delivered"])(
      `${name} — 대상 프로젝트에 %s 주문 → 409 PROJECT_LOCKED, 쓰기 0건`,
      async (status) => {
        seed({ orders: [{ project_id: lockedProject, status }] });
        const { status: http, json } = await read(await call());
        expect(http).toBe(409);
        expect(json.ok).toBe(false);
        expect(json.error?.code).toBe("PROJECT_LOCKED");
        expect(json.error?.message).toContain("결제가 완료된 포토북은 수정할 수 없어요");
        expect(state.writes).toEqual([]);
      },
    );
  }

  for (const [name, lockedProject, call, expectedWrite] of LOCKED_ROUTES) {
    it(`${name} — pending·cancelled·refunded 주문만 있으면 쓰기가 진행된다`, async () => {
      seed({
        orders: [
          { project_id: lockedProject, status: "pending" },
          { project_id: lockedProject, status: "cancelled" },
          { project_id: lockedProject, status: "refunded" },
        ],
      });
      const { status: http, json } = await read(await call());
      expect(json.error?.code).not.toBe("PROJECT_LOCKED");
      expect(http).toBe(200);
      expect(state.writes).toContain(expectedWrite);
    });
  }

  it("POST /api/photos/complete — paid 주문 → 409, Storage 다운로드·INSERT 전에 멈춘다", async () => {
    seed({ orders: [{ project_id: P1, status: "paid" }] });
    const { status, json } = await read(await photosComplete(post("/api/photos/complete", COMPLETE_BODY)));
    expect(status).toBe(409);
    expect(json.error?.code).toBe("PROJECT_LOCKED");
    expect(state.log).not.toContain("storage.photo-originals.download");
    expect(state.writes).toEqual([]);
  });

  it("POST /api/photos/complete — 주문이 없으면 잠금을 통과해 원본 처리 단계로 간다", async () => {
    const { status, json } = await read(await photosComplete(post("/api/photos/complete", COMPLETE_BODY)));
    expect(status).toBe(200);
    expect(json.error).toBeUndefined();
    expect(state.log).toContain("storage.photo-originals.download");
  });

  it("copy-to-project 는 원본 프로젝트가 결제됐어도 대상이 편집 가능하면 허용 (원본은 읽기만)", async () => {
    seed({ orders: [{ project_id: P1, status: "paid" }] });
    const { status } = await read(
      await photosCopy(post("/api/photos/copy-to-project", { photoIds: [PHOTO_ACTIVE], targetProjectId: P2 })),
    );
    expect(status).toBe(200);
    expect(state.writes).toContain("admin.photos.insert");
  });

  it("잠금 확인은 소유권 검증 뒤 — 남의 결제된 프로젝트는 409 가 아니라 403 (결제 여부 비노출)", async () => {
    seed({ orders: [{ project_id: P_OTHER, status: "paid" }] });
    const { status, json } = await read(await pagesInsert(post("/api/pages/insert", { projectId: P_OTHER })));
    expect(status).toBe(403);
    expect(json.error?.code).toBe("FORBIDDEN");
  });

  it("POST /api/photos/complete — 이미 확정된 photoId 만 다시 오면(재시도) 잠금과 무관하게 200, 쓰기 0건", async () => {
    seed({ orders: [{ project_id: P1, status: "paid" }] });
    const { status, json } = await read(
      await photosComplete(
        post("/api/photos/complete", {
          ...COMPLETE_BODY,
          photos: [{ ...COMPLETE_BODY.photos[0], photoId: PHOTO_ACTIVE, storageKey: `${USER}/${P1}/${PHOTO_ACTIVE}.jpg` }],
        }),
      ),
    );
    expect(status).toBe(200);
    expect(json.data).toEqual({ inserted: [], failed: [] });
    expect(state.log).not.toContain("admin.from(orders)");
    expect(state.writes).toEqual([]);
  });

  it("POST /api/photos/trash — 여러 포토북이 섞인 배치는 잠긴 포토북 사진만 빼고 처리 (skippedLocked)", async () => {
    seed({ orders: [{ project_id: P1, status: "paid" }] });
    state.tables.photos!.push({ id: P2_PHOTO, project_id: P2, storage_key: `${USER}/${P2}/${P2_PHOTO}.jpg`, deleted_at: null });
    const { status, json } = await read(
      await photosTrash(post("/api/photos/trash", { photoIds: [PHOTO_ACTIVE, P2_PHOTO] })),
    );
    expect(status).toBe(200);
    expect(json.data).toEqual({ updated: 1, skipped: 1, skippedLocked: 1 });
    const photos = state.tables.photos!;
    expect(photos.find((r) => r.id === PHOTO_ACTIVE)?.deleted_at).toBeNull();
    expect(photos.find((r) => r.id === P2_PHOTO)?.deleted_at).toEqual(expect.any(String));
  });

  it("POST /api/photos/restore — 여러 포토북이 섞인 배치는 잠긴 포토북 사진만 빼고 복원 (skippedLocked)", async () => {
    seed({ orders: [{ project_id: P1, status: "delivered" }] });
    state.tables.photos!.push({
      id: P2_PHOTO,
      project_id: P2,
      storage_key: `${USER}/${P2}/${P2_PHOTO}.jpg`,
      deleted_at: "2026-09-10T00:00:00Z",
    });
    const { status, json } = await read(
      await photosRestore(post("/api/photos/restore", { photoIds: [PHOTO_TRASHED, P2_PHOTO] })),
    );
    expect(status).toBe(200);
    expect(json.data).toEqual({ restored: 1, skipped: 1, skippedQuota: 0, skippedLocked: 1 });
    const photos = state.tables.photos!;
    expect(photos.find((r) => r.id === PHOTO_TRASHED)?.deleted_at).toEqual(expect.any(String));
    expect(photos.find((r) => r.id === P2_PHOTO)?.deleted_at).toBeNull();
  });

  it.each(["paid", "in_production", "shipped", "delivered"])(
    "POST /api/photos/purge 는 잠그지 않는다 — %s 주문이 있어도 휴지통 사진 영구 삭제 (PDF resolver 는 휴지통 사진을 이미 제외)",
    async (status) => {
      seed({ orders: [{ project_id: P1, status }] });
      const { status: http, json } = await read(
        await photosPurge(post("/api/photos/purge", { photoIds: [PHOTO_TRASHED] })),
      );
      expect(http).toBe(200);
      expect(json.data).toEqual({ deleted: 1, skipped: 0 });
      expect(state.writes).toContain("admin.photos.delete");
      expect(state.log).not.toContain("admin.from(orders)");
    },
  );

  it("POST /api/photos/abandon 은 잠그지 않는다 — 확정 전 업로드 객체 정리는 인쇄물과 무관, 막으면 고아가 남음", async () => {
    seed({ orders: [{ project_id: P1, status: "paid" }] });
    const key = `${USER}/${P1}/${NEW_PHOTO}.jpg`;
    const { status } = await read(
      await photosAbandon(post("/api/photos/abandon", { projectId: P1, storageKeys: [key] })),
    );
    expect(status).toBe(200);
    expect(state.writes).toContain("storage.photo-originals.remove");
  });
});

/** requireActiveUser 로 바꾼 라우트 전부. */
const GUARDED_ROUTES: Array<[string, () => Promise<Response>]> = [
  ["POST /api/cover/preview", () => coverPreview(post("/api/cover/preview", { projectId: P1 }))],
  ["POST /api/pages/insert", () => pagesInsert(post("/api/pages/insert", { projectId: P1 }))],
  [
    "POST /api/pages/reorder",
    () => pagesReorder(post("/api/pages/reorder", { projectId: P1, pageIds: [PAGE2, PAGE1] })),
  ],
  [
    "POST /api/pages/[id]/preview",
    () => pagePreviewPost(post(`/api/pages/${PAGE1}/preview`, {}), { params: { id: PAGE1 } }),
  ],
  [
    "POST /api/photos/abandon",
    () =>
      photosAbandon(
        post("/api/photos/abandon", { projectId: P1, storageKeys: [`${USER}/${P1}/${NEW_PHOTO}.jpg`] }),
      ),
  ],
  ["POST /api/photos/complete", () => photosComplete(post("/api/photos/complete", COMPLETE_BODY))],
  [
    "POST /api/photos/copy-to-project",
    () => photosCopy(post("/api/photos/copy-to-project", { photoIds: [PHOTO_ACTIVE], targetProjectId: P2 })),
  ],
  ["POST /api/photos/purge", () => photosPurge(post("/api/photos/purge", { photoIds: [PHOTO_TRASHED] }))],
  ["POST /api/photos/restore", () => photosRestore(post("/api/photos/restore", { photoIds: [PHOTO_TRASHED] }))],
  [
    "POST /api/photos/sign-upload",
    () =>
      photosSignUpload(
        post("/api/photos/sign-upload", {
          projectId: P1,
          files: [{ filename: "c.jpg", mime: "image/jpeg", size: 1000 }],
        }),
      ),
  ],
  ["POST /api/photos/trash", () => photosTrash(post("/api/photos/trash", { photoIds: [PHOTO_ACTIVE] }))],
  ["POST /api/projects", () => projectsCreate(post("/api/projects", { title: "새 책" }))],
  [
    "POST /api/projects/[id]/share",
    () => shareCreate(post(`/api/projects/${P1}/share`, {}), { params: { id: P1 } }),
  ],
  [
    "DELETE /api/projects/[id]/share/[tokenId]",
    () =>
      shareTokenDelete(new Request(`https://100pbooks.vercel.app/api/projects/${P1}/share/${TOKEN_ID}`), {
        params: { id: P1, tokenId: TOKEN_ID },
      }),
  ],
  [
    "POST /api/layout/generate",
    () =>
      layoutGenerate(
        post("/api/layout/generate", { projectId: P1, sortMode: "upload", layoutMode: "polaroid" }),
      ),
  ],
];

describe("탈퇴(익명화) 계정 — 프로젝트 쓰기 라우트 410 (DEBT-3)", () => {
  for (const [name, call] of GUARDED_ROUTES) {
    it(`${name} → 410 ACCOUNT_DELETED, 가드 뒤 단계 미실행`, async () => {
      seed({ deletedAt: "2026-09-17T00:00:00Z" });
      const { status, json } = await read(await call());
      expect(status).toBe(410);
      expect(json.error?.code).toBe("ACCOUNT_DELETED");
      expect(state.log).toEqual(["server.from(profiles)"]);
      expect(state.writes).toEqual([]);
    });
  }

  it("읽기 전용 GET 은 requireUser 유지 — GET /api/projects/[id]/share 는 탈퇴 계정도 410 이 아니다", async () => {
    seed({ deletedAt: "2026-09-17T00:00:00Z" });
    const { status } = await read(
      await shareList(new Request(`https://100pbooks.vercel.app/api/projects/${P1}/share`), {
        params: { id: P1 },
      }),
    );
    expect(status).toBe(200);
    expect(state.log).not.toContain("server.from(profiles)");
  });

  it("읽기 전용 GET 은 requireUser 유지 — GET /api/pages/[id]/preview 는 탈퇴 계정도 410 이 아니다", async () => {
    seed({ deletedAt: "2026-09-17T00:00:00Z" });
    // fabric_json 이 비어 있어 렌더 전에 400 EMPTY_PAGE 로 끝난다
    const { status, json } = await read(
      await pagePreviewGet(new Request(`https://100pbooks.vercel.app/api/pages/${PAGE1}/preview`), {
        params: { id: PAGE1 },
      }),
    );
    expect(status).toBe(400);
    expect(json.error?.code).toBe("EMPTY_PAGE");
    expect(state.log).not.toContain("server.from(profiles)");
  });

  it("활성 계정은 가드를 통과한다 — POST /api/projects 생성", async () => {
    const { status } = await read(await projectsCreate(post("/api/projects", { title: "새 책" })));
    expect(status).toBe(200);
    expect(state.log).toContain("server.from(profiles)");
    expect(state.writes).toContain("server.projects.insert");
  });
});

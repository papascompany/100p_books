// @vitest-environment node
import type * as ReactModule from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  harness,
  readJson,
  resetHarness,
  seedOrder,
  seedProject,
  USER_ID,
} from "@/app/api/payments/_test/harness";
import type { MemoryDb, Row } from "@/app/api/payments/_test/memory-supabase";
import { computeDocVersion } from "@/lib/editor/doc-version";
import { PAGEDOC_VERSION, type PageDoc } from "@/lib/layout/types";

/**
 * PATCH·DELETE /api/pages/[id] — 결제 후 편집 잠금(DEBT-2) + 탈퇴 가드(DEBT-3).
 *
 * 에디터 자동저장·페이지 삭제가 결제된 포토북의 인쇄물을 바꾸던 마지막 경로다.
 * lib/auth/session 과 lib/orders/edit-lock 은 mock 하지 않는다 — 라우트가 가드를 빼먹으면 실패한다.
 * 인메모리 DB(app/api/payments/_test)가 모든 쓰기를 calls 에 남긴다.
 *
 * 판정 순서 계약: 소유권(403) → 잠금(409 PROJECT_LOCKED) → 버전(409 EDIT_CONFLICT).
 */

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof ReactModule>();
  return { ...actual, cache: <T>(fn: T): T => fn };
});

const auth = vi.hoisted(() => ({ userId: "11111111-1111-4111-8111-111111111111" }));

vi.mock("@/lib/db/server", async () => {
  const { harness: h } = await import("@/app/api/payments/_test/harness");
  return {
    createServerSupabase: () => ({
      ...h.db.client(),
      auth: { getUser: async () => ({ data: { user: { id: auth.userId } } }) },
    }),
  };
});
vi.mock("@/lib/db/admin", async () => {
  const { harness: h } = await import("@/app/api/payments/_test/harness");
  return { createAdminSupabase: () => h.db.client() };
});

import { DELETE, PATCH } from "./route";

const LOCKING = ["paid", "in_production", "shipped", "delivered"] as const;
const NON_LOCKING = ["pending", "cancelled", "refunded"] as const;
const OTHER_USER = "99999999-9999-4999-8999-999999999999";

interface Fixture {
  db: MemoryDb;
  projectId: string;
  bookSizeId: string;
  page: Row;
}

function setup(opts: { orders?: readonly string[]; deleted?: boolean; owner?: string } = {}): Fixture {
  auth.userId = USER_ID;
  const db = resetHarness({ atomic: true });
  const { projectId, bookSizeId } = seedProject(db, { pages: 2 });
  const project = db.find("projects", (r) => r.id === projectId)!;
  if (opts.owner) project.user_id = opts.owner;
  const page = db.find("pages", (r) => r.project_id === projectId && r.page_no === 1)!;
  page.fabric_json = pageDoc(bookSizeId, 1, "#ffffff");
  page.updated_at = "2026-09-17T00:00:00Z";
  const profile = db.find("profiles", (r) => r.id === USER_ID)!;
  profile.deleted_at = opts.deleted ? "2026-09-17T00:00:00Z" : null;
  for (const status of opts.orders ?? []) {
    seedOrder(db, { projectId, pages: 2, status });
  }
  db.calls = [];
  return { db, projectId, bookSizeId, page };
}

function pageDoc(bookSizeId: string, pageNo: number, backgroundColor: string): PageDoc {
  return {
    version: PAGEDOC_VERSION,
    bookSizeId,
    pageNo,
    layoutMode: "polaroid",
    widthMm: 148,
    heightMm: 210,
    bleedMm: 2,
    backgroundColor,
    objects: [],
  };
}

function patch(pageId: string, body: unknown) {
  return PATCH(
    new Request(`https://100pbooks.vercel.app/api/pages/${pageId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: pageId }) },
  );
}

function del(pageId: string) {
  return DELETE(
    new Request(`https://100pbooks.vercel.app/api/pages/${pageId}`, { method: "DELETE" }),
    { params: Promise.resolve({ id: pageId }) },
  );
}

function writes(db: MemoryDb): string[] {
  return db.calls.filter((c) => !c.startsWith("select:"));
}

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

describe("PATCH /api/pages/[id] — 결제 후 편집 잠금", () => {
  it.each(LOCKING)("%s 주문이 있으면 409 PROJECT_LOCKED, 쓰기 0건", async (status) => {
    const { db, bookSizeId, page } = setup({ orders: [status] });
    const res = await patch(String(page.id), {
      fabricJson: pageDoc(bookSizeId, 1, "#000000"),
      baseVersion: computeDocVersion(page.fabric_json),
    });
    const json = await readJson(res);
    expect(res.status).toBe(409);
    expect(json.error?.code).toBe("PROJECT_LOCKED");
    expect(json.error?.message).toContain("결제가 완료된 포토북은 수정할 수 없어요");
    expect(writes(db)).toEqual([]);
    expect((db.find("pages", (r) => r.id === page.id)!.fabric_json as PageDoc).backgroundColor).toBe(
      "#ffffff",
    );
  });

  it("구 클라이언트(baseVersion 없음)도 잠금에 걸린다", async () => {
    const { db, bookSizeId, page } = setup({ orders: ["paid"] });
    const res = await patch(String(page.id), { fabricJson: pageDoc(bookSizeId, 1, "#000000") });
    expect(res.status).toBe(409);
    expect((await readJson(res)).error?.code).toBe("PROJECT_LOCKED");
    expect(writes(db)).toEqual([]);
  });

  it("잠금이 버전 판정보다 먼저 — 옛 baseVersion 이어도 EDIT_CONFLICT 가 아니라 PROJECT_LOCKED", async () => {
    const { db, bookSizeId, page } = setup({ orders: ["paid"] });
    const res = await patch(String(page.id), {
      fabricJson: pageDoc(bookSizeId, 1, "#000000"),
      baseVersion: "v1-stale-base-version",
    });
    expect(res.status).toBe(409);
    expect((await readJson(res)).error?.code).toBe("PROJECT_LOCKED");
    expect(writes(db)).toEqual([]);
  });

  it("pending·cancelled·refunded 주문만 있으면 저장된다", async () => {
    const { db, bookSizeId, page } = setup({ orders: NON_LOCKING });
    const res = await patch(String(page.id), {
      fabricJson: pageDoc(bookSizeId, 1, "#000000"),
      baseVersion: computeDocVersion(page.fabric_json),
    });
    expect(res.status).toBe(200);
    expect(writes(db)).toContain("update:pages");
    expect((db.find("pages", (r) => r.id === page.id)!.fabric_json as PageDoc).backgroundColor).toBe(
      "#000000",
    );
  });

  it("잠금이 풀린 상태의 옛 baseVersion 은 여전히 409 EDIT_CONFLICT (기존 계약 유지)", async () => {
    const { db, bookSizeId, page } = setup({ orders: ["refunded"] });
    const res = await patch(String(page.id), {
      fabricJson: pageDoc(bookSizeId, 1, "#000000"),
      baseVersion: "v1-stale-base-version",
    });
    expect(res.status).toBe(409);
    expect((await readJson(res)).error?.code).toBe("EDIT_CONFLICT");
    expect(writes(db)).toEqual([]);
  });

  it("남의 결제된 페이지는 409 가 아니라 403 — 잠금 조회 전에 멈춘다(결제 여부 비노출)", async () => {
    const { db, bookSizeId, page } = setup({ orders: ["paid"], owner: OTHER_USER });
    const res = await patch(String(page.id), {
      fabricJson: pageDoc(bookSizeId, 1, "#000000"),
      baseVersion: computeDocVersion(page.fabric_json),
    });
    expect(res.status).toBe(403);
    expect((await readJson(res)).error?.code).toBe("FORBIDDEN");
    expect(db.calls).not.toContain("select:orders");
    expect(writes(db)).toEqual([]);
  });

  it("주문 조회 실패 → 503 PROJECT_LOCK_CHECK_FAILED, 쓰기 0건 (fail-closed)", async () => {
    const { db, bookSizeId, page } = setup();
    db.failOnce.set("select:orders", { message: "connection reset" });
    const res = await patch(String(page.id), {
      fabricJson: pageDoc(bookSizeId, 1, "#000000"),
      baseVersion: computeDocVersion(page.fabric_json),
    });
    const json = await readJson(res);
    expect(res.status).toBe(503);
    expect(json.error?.code).toBe("PROJECT_LOCK_CHECK_FAILED");
    expect(json.error?.message).not.toContain("connection reset");
    expect(writes(db)).toEqual([]);
  });

  it("탈퇴(익명화) 계정 → 410 ACCOUNT_DELETED, 페이지 조회 전에 멈춘다", async () => {
    const { db, bookSizeId, page } = setup({ deleted: true });
    const res = await patch(String(page.id), {
      fabricJson: pageDoc(bookSizeId, 1, "#000000"),
      baseVersion: computeDocVersion(page.fabric_json),
    });
    expect(res.status).toBe(410);
    expect((await readJson(res)).error?.code).toBe("ACCOUNT_DELETED");
    expect(db.calls).toEqual(["select:profiles"]);
  });
});

describe("DELETE /api/pages/[id] — 결제 후 편집 잠금", () => {
  it.each(LOCKING)("%s 주문이 있으면 409 PROJECT_LOCKED, 페이지 삭제·번호 압축 0건", async (status) => {
    const { db, page } = setup({ orders: [status] });
    const res = await del(String(page.id));
    expect(res.status).toBe(409);
    expect((await readJson(res)).error?.code).toBe("PROJECT_LOCKED");
    expect(writes(db)).toEqual([]);
    expect(db.find("pages", (r) => r.id === page.id)).toBeDefined();
  });

  it("잠기지 않은 포토북은 삭제된다", async () => {
    const { db, page } = setup({ orders: NON_LOCKING });
    const res = await del(String(page.id));
    expect(res.status).toBe(200);
    expect(db.find("pages", (r) => r.id === page.id)).toBeUndefined();
    expect(writes(db)).toContain("delete:pages");
  });

  it("남의 결제된 페이지는 403, 잠금 조회 없음", async () => {
    const { db, page } = setup({ orders: ["paid"], owner: OTHER_USER });
    const res = await del(String(page.id));
    expect(res.status).toBe(403);
    expect(db.calls).not.toContain("select:orders");
    expect(writes(db)).toEqual([]);
  });

  it("탈퇴 계정 → 410, 가드 뒤 단계 미실행", async () => {
    const { db, page } = setup({ deleted: true });
    const res = await del(String(page.id));
    expect(res.status).toBe(410);
    expect(db.calls).toEqual(["select:profiles"]);
    expect(harness.db.find("pages", (r) => r.id === page.id)).toBeDefined();
  });
});

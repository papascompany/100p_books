// @vitest-environment node
import type * as ReactModule from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { readJson, resetHarness, USER_ID } from "@/app/api/payments/_test/harness";
import type { MemoryDb } from "@/app/api/payments/_test/memory-supabase";

/**
 * POST /api/reviews — 후기 대상 주문의 소유·상태 검증 (방어 보강).
 *
 * reviews RLS(reviews_own_all)는 user_id 만 본다. 라우트가 order 소유·배송 이후 상태·첨부 이미지 폴더를
 * 검증하지 않으면 남의 주문에 후기를 달아(order_id UNIQUE) 실제 주문자가 후기를 못 쓰게 만들거나
 * 남의 이미지 키를 붙일 수 있다. 이 테스트가 그 검증과 순서(INSERT 전에 멈춤)를 고정한다.
 */

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof ReactModule>();
  return { ...actual, cache: <T>(fn: T): T => fn };
});

vi.mock("@/lib/db/server", async () => {
  const { harness: h, USER_ID: uid } = await import("@/app/api/payments/_test/harness");
  return {
    createServerSupabase: () => ({
      ...h.db.client(),
      auth: {
        getUser: async () => ({ data: { user: { id: uid } } }),
        getSession: async () => ({ data: { session: null } }),
      },
    }),
  };
});
vi.mock("@/lib/db/admin", async () => {
  const { harness: h } = await import("@/app/api/payments/_test/harness");
  return { createAdminSupabase: () => h.db.client() };
});

import { POST } from "./route";

const OTHER = "99999999-9999-4999-8999-999999999999";

function setup(order: { user_id: string; status: string }): { db: MemoryDb; orderId: string } {
  const db = resetHarness({ atomic: true });
  db.seed("profiles", { id: USER_ID, deleted_at: null });
  const row = db.seed("orders", {
    project_id: "22222222-2222-4222-8222-222222222222",
    ...order,
  });
  db.calls = [];
  return { db, orderId: String(row.id) };
}

function post(body: unknown) {
  return POST(
    new Request("https://100pbooks.vercel.app/api/reviews", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

describe("POST /api/reviews — 주문 소유·상태 검증", () => {
  it("남의 주문 → 403 FORBIDDEN, INSERT 0건", async () => {
    const { db, orderId } = setup({ user_id: OTHER, status: "delivered" });
    const res = await post({ orderId, rating: 5 });
    expect(res.status).toBe(403);
    expect((await readJson(res)).error?.code).toBe("FORBIDDEN");
    expect(db.calls).not.toContain("insert:reviews");
  });

  it("없는 주문 → 404, INSERT 0건", async () => {
    const { db } = setup({ user_id: USER_ID, status: "delivered" });
    const res = await post({ orderId: "33333333-3333-4333-8333-333333333333", rating: 5 });
    expect(res.status).toBe(404);
    expect(db.calls).not.toContain("insert:reviews");
  });

  it.each(["pending", "paid", "in_production", "cancelled", "refunded"])(
    "본인 주문이라도 %s 상태면 400 ORDER_NOT_REVIEWABLE, INSERT 0건",
    async (status) => {
      const { db, orderId } = setup({ user_id: USER_ID, status });
      const res = await post({ orderId, rating: 4 });
      expect(res.status).toBe(400);
      expect((await readJson(res)).error?.code).toBe("ORDER_NOT_REVIEWABLE");
      expect(db.calls).not.toContain("insert:reviews");
    },
  );

  it("첨부 이미지가 본인 폴더가 아니면 400 INVALID_IMAGE_KEY, INSERT 0건", async () => {
    const { db, orderId } = setup({ user_id: USER_ID, status: "shipped" });
    const res = await post({ orderId, rating: 5, imageKeys: [`${OTHER}/g/1.jpg`] });
    expect(res.status).toBe(400);
    expect((await readJson(res)).error?.code).toBe("INVALID_IMAGE_KEY");
    expect(db.calls).not.toContain("insert:reviews");
  });

  it.each(["shipped", "delivered"])("본인 %s 주문 → 201, 본인 user_id 로 INSERT", async (status) => {
    const { db, orderId } = setup({ user_id: USER_ID, status });
    const res = await post({ orderId, rating: 5, body: "좋아요", imageKeys: [`${USER_ID}/g/1.jpg`] });
    expect(res.status).toBe(201);
    const inserted = db.find("reviews", (r) => r.order_id === orderId);
    expect(inserted?.user_id).toBe(USER_ID);
  });

  it("같은 주문에 두 번째 후기 → 409 REVIEW_ALREADY_EXISTS", async () => {
    const { db, orderId } = setup({ user_id: USER_ID, status: "delivered" });
    expect((await post({ orderId, rating: 5 })).status).toBe(201);
    db.calls = [];
    const res = await post({ orderId, rating: 3 });
    expect(res.status).toBe(409);
    expect(db.calls).not.toContain("insert:reviews");
  });
});

// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  jsonRequest,
  readJson,
  resetHarness,
  seedBalance,
  seedProject,
  USER_ID,
} from "@/app/api/payments/_test/harness";
import type { MemoryDb } from "@/app/api/payments/_test/memory-supabase";

/**
 * POST /api/orders/create — 결제창 이탈 후 재주문 시 pending 주문 재사용 (DEBT-6 일부).
 */

vi.mock("@/lib/auth/session", () => ({
  requireActiveUser: vi.fn(async () => ({ id: "11111111-1111-4111-8111-111111111111", email: "buyer@example.com" })),
}));
vi.mock("@/lib/db/admin", async () => {
  const { harness: h } = await import("@/app/api/payments/_test/harness");
  return { createAdminSupabase: () => h.db.client() };
});
vi.mock("@/lib/db/server", async () => {
  const { harness: h } = await import("@/app/api/payments/_test/harness");
  return { createServerSupabase: () => h.db.client() };
});

import { POST } from "./route";

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

const ADDRESS = {
  name: "홍길동",
  phone: "010-1234-5678",
  zip: "12345",
  addr1: "서울시 중구",
};

function create(projectId: string, body: Record<string, unknown> = {}) {
  return POST(jsonRequest("/api/orders/create", { projectId, qty: 1, address: ADDRESS, ...body }));
}

function setup(): { db: MemoryDb; projectId: string } {
  const db = resetHarness({ atomic: true });
  const { projectId } = seedProject(db);
  seedBalance(db, 5000);
  return { db, projectId };
}

function ordersOf(db: MemoryDb, projectId: string) {
  return db.table("orders").filter((o) => o.project_id === projectId && o.user_id === USER_ID);
}

describe("orders/create — pending 주문 재사용", () => {
  it("결제창을 닫고 다시 결제하기 → 같은 주문을 새 값·새 토스 주문번호로 갱신", async () => {
    const { db, projectId } = setup();
    const first = await readJson(await create(projectId));
    expect(first.data).toMatchObject({ reused: false, amount: 18000 });

    const secondRes = await create(projectId, { qty: 2, usePoints: 1000 });
    const second = await readJson(secondRes);
    expect(secondRes.status).toBe(200);
    expect(second.data).toMatchObject({ reused: true, orderId: first.data!.orderId });
    expect(second.data!.tossOrderId).not.toBe(first.data!.tossOrderId);

    const rows = ordersOf(db, projectId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      qty: 2,
      amount: 34200 - 1000,
      points_used: 1000,
      toss_order_id: second.data!.tossOrderId,
      status: "pending",
    });
  });

  it("paymentKey 가 묶인(승인 시도 중·복구 대기) 주문은 건드리지 않고 새로 만든다", async () => {
    const { db, projectId } = setup();
    const first = await readJson(await create(projectId));
    const row = db.find("orders", (o) => o.id === first.data!.orderId)!;
    row.toss_payment_key = "pk-in-flight";
    const tossOrderIdBefore = row.toss_order_id;

    const second = await readJson(await create(projectId));
    expect(second.data).toMatchObject({ reused: false });
    expect(second.data!.orderId).not.toBe(first.data!.orderId);
    expect(row.toss_order_id).toBe(tossOrderIdBefore);
    expect(ordersOf(db, projectId)).toHaveLength(2);
  });

  it("크레딧이 잡혀 있는 pending 주문은 재사용하지 않는다", async () => {
    const { db, projectId } = setup();
    const first = await readJson(await create(projectId));
    db.seed("point_ledger", {
      user_id: USER_ID,
      amount: -1000,
      reason: "order_use",
      ref_type: "orders",
      ref_id: first.data!.orderId,
      balance_after: 4000,
    });
    const second = await readJson(await create(projectId));
    expect(second.data).toMatchObject({ reused: false });
    expect(ordersOf(db, projectId)).toHaveLength(2);
  });

  it("결제 완료 주문은 재사용 대상이 아니다", async () => {
    const { db, projectId } = setup();
    const first = await readJson(await create(projectId));
    db.find("orders", (o) => o.id === first.data!.orderId)!.status = "paid";
    const second = await readJson(await create(projectId));
    expect(second.data).toMatchObject({ reused: false });
  });

  it("더블클릭 동시 요청 — 두 응답의 (주문, 토스 주문번호)가 모두 DB 와 일치", async () => {
    const { db, projectId } = setup();
    await create(projectId); // 재사용 후보를 만든다
    const results = await Promise.all([
      create(projectId, { qty: 3 }).then(readJson),
      create(projectId, { qty: 4 }).then(readJson),
    ]);
    for (const r of results) {
      const row = db.find("orders", (o) => o.id === r.data!.orderId)!;
      expect(row.toss_order_id).toBe(r.data!.tossOrderId);
      expect(row.amount).toBe(r.data!.amount);
    }
    expect(results.filter((r) => r.data!.reused)).toHaveLength(1);
  });
});

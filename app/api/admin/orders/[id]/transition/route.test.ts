// @vitest-environment node
import type { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  balanceOf,
  harness,
  resetHarness,
  seedBalance,
  seedDiscountCode,
  seedOrder,
  seedProject,
} from "@/app/api/payments/_test/harness";
import type { MemoryDb, Row } from "@/app/api/payments/_test/memory-supabase";
import type { TossOrderProbe } from "@/lib/orders/toss-order-probe";
import type * as TossModule from "@/lib/payments/toss";

/**
 * POST /api/admin/orders/:id/transition — 결제·주문 정합 부분.
 *
 *   - pending → cancelled 는 토스 확인 뒤에만(캡처·진행 중이면 409, 조회 실패 503) + 확인한 결제 키 CAS.
 *   - cancelled·refunded 전이 클레임 승자는 잡힌 크레딧을 복원(0033 RPC 흉내로 실제 잔액 확인).
 *
 * DB 는 결제 하네스의 인메모리 Supabase, 토스 결제 키 조회는 하네스 시뮬레이터, 주문번호 probe 는 가짜.
 */

const state = vi.hoisted(() => ({
  probe: { kind: "no_payment", reason: "not_found" } as TossOrderProbe,
  probeCalls: [] as Array<string | null>,
  audits: [] as Array<{ action: string; details?: Record<string, unknown> }>,
}));

vi.mock("@/lib/auth/session", () => ({
  requireAdmin: vi.fn(async () => ({ id: "admin-1", email: "admin@example.com" })),
}));
vi.mock("@/lib/db/admin", async () => {
  const { harness: h } = await import("@/app/api/payments/_test/harness");
  return { createAdminSupabase: () => h.db.client() };
});
vi.mock("@/lib/payments/toss", async (importOriginal) => {
  const actual = await importOriginal<typeof TossModule>();
  return {
    ...actual,
    fetchTossPayment: async (paymentKey: string) =>
      (await import("@/app/api/payments/_test/harness")).harness.toss.fetch(paymentKey),
  };
});
vi.mock("@/lib/orders/toss-order-probe", () => ({
  probeTossOrder: vi.fn(async (tossOrderId: string | null) => {
    state.probeCalls.push(tossOrderId);
    return state.probe;
  }),
}));
vi.mock("@/lib/admin/audit", () => ({
  logAdminAction: vi.fn(async (args: { action: string; details?: Record<string, unknown> }) => {
    state.audits.push({ action: args.action, details: args.details });
  }),
}));
vi.mock("@/lib/email/queue", async () => {
  const { fakes } = await import("@/app/api/payments/_test/harness");
  return { enqueueEmail: fakes.enqueueEmail };
});

import { POST } from "./route";

beforeEach(() => {
  state.probe = { kind: "no_payment", reason: "not_found" };
  state.probeCalls = [];
  state.audits = [];
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

function setup(opts: { status?: string; paymentKey?: string | null; points?: number; discount?: boolean } = {}) {
  const db = resetHarness({ atomic: true });
  const { projectId, pages } = seedProject(db);
  seedBalance(db, 5000);
  const code = opts.discount ? seedDiscountCode(db, { max_uses: 10 }) : null;
  const order = seedOrder(db, {
    projectId,
    pages,
    requestedPoints: opts.points ?? 0,
    discount: code,
    status: opts.status ?? "pending",
    tossPaymentKey: null,
  });
  return { db, order, code };
}

/** confirm 이 캡처 전에 선점·바인딩한 상태 (0033 RPC). */
async function reserve(db: MemoryDb, order: Row, paymentKey: string): Promise<void> {
  const { data, error } = await db.client().rpc("reserve_order_credits", {
    p_order_id: order.id,
    p_payment_key: paymentKey,
    p_amount: order.amount,
    p_toss_order_id: order.toss_order_id,
  });
  expect(error).toBeNull();
  expect((data as Row).ok).toBe(true);
}

function tossHas(order: Row, paymentKey: string, status: string) {
  harness.toss.payments.set(paymentKey, {
    paymentKey,
    orderId: String(order.toss_order_id),
    totalAmount: Number(order.amount),
    status,
  });
}

function transition(order: Row, to: string) {
  const req = new Request(`https://100pbooks.vercel.app/api/admin/orders/${String(order.id)}/transition`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ to }),
  });
  return POST(req as unknown as NextRequest, { params: { id: String(order.id) } });
}

async function codeOf(res: Response): Promise<string | undefined> {
  return ((await res.json()) as { error?: { code: string } }).error?.code;
}

describe("pending → cancelled — 토스 확인 + 크레딧 복원", () => {
  it("결제 키가 묶인 pending + 토스 DONE(캡처됨) → 409, 상태·선점 유지", async () => {
    const { db, order } = setup({ points: 2000 });
    await reserve(db, order, "pk-1");
    tossHas(order, "pk-1", "DONE");

    const res = await transition(order, "cancelled");
    expect(res.status).toBe(409);
    expect(await codeOf(res)).toBe("PAYMENT_CAPTURED_OR_IN_PROGRESS");
    expect(order.status).toBe("pending");
    expect(balanceOf(db)).toBe(3000);
    expect(db.calls).not.toContain("update:orders");
    expect(state.audits).toHaveLength(0);
  });

  it("결제 키가 묶인 pending + 토스 조회 실패 → 503, 아무것도 바꾸지 않음", async () => {
    const { db, order } = setup({ points: 2000 });
    await reserve(db, order, "pk-1");
    const { TossError } = await import("@/lib/payments/toss");
    harness.toss.nextFetchError = new TossError({ code: "TOSS_TIMEOUT", message: "시간 초과", status: 504 });

    const res = await transition(order, "cancelled");
    expect(res.status).toBe(503);
    expect(await codeOf(res)).toBe("PAYMENT_STATUS_UNAVAILABLE");
    expect(order.status).toBe("pending");
    expect(balanceOf(db)).toBe(3000);
  });

  it.each(["CANCELED", "EXPIRED"])(
    "결제 키가 묶인 pending + 토스 %s → cancelled + 선점 포인트·할인 복원(클레임 뒤)",
    async (tossStatus) => {
      const { db, order, code } = setup({ points: 2000, discount: true });
      await reserve(db, order, "pk-1");
      tossHas(order, "pk-1", tossStatus);
      expect(balanceOf(db)).toBe(3000);
      expect(code!.used_count).toBe(1);

      const res = await transition(order, "cancelled");
      expect(res.status).toBe(200);
      expect(order.status).toBe("cancelled");
      expect(balanceOf(db)).toBe(5000);
      expect(code!.used_count).toBe(0);
      expect(state.audits[0]?.details).toMatchObject({
        from: "pending",
        to: "cancelled",
        creditRestore: { ok: true },
      });

      // 재요청은 상태 전이 불가(cancelled 종착) — 이중 복원 없음
      expect((await transition(order, "cancelled")).status).toBe(400);
      expect(balanceOf(db)).toBe(5000);
    },
  );

  it("결제 키가 묶인 pending + 승인된 결제 없음(404) → 허용", async () => {
    const { db, order } = setup({ points: 1000 });
    await reserve(db, order, "pk-1");
    const res = await transition(order, "cancelled");
    expect(res.status).toBe(200);
    expect(order.status).toBe("cancelled");
    expect(balanceOf(db)).toBe(5000);
  });

  it("결제 키 없는 pending 은 토스 주문번호 probe — 결제 기록 있으면 409, 없으면 취소", async () => {
    const { order } = setup();
    state.probe = { kind: "payment_found", tossStatus: "DONE" };
    const blocked = await transition(order, "cancelled");
    expect(blocked.status).toBe(409);
    expect(order.status).toBe("pending");
    expect(state.probeCalls).toEqual([order.toss_order_id]);

    state.probe = { kind: "no_payment", reason: "not_found" };
    const ok = await transition(order, "cancelled");
    expect(ok.status).toBe(200);
    expect(order.status).toBe("cancelled");
  });

  it("CAS: 토스 확인 뒤 다른 결제 키로 바인딩되면 전이하지 않음(409), 복원 없음", async () => {
    const { db, order } = setup({ points: 2000 });
    await reserve(db, order, "pk-1");
    tossHas(order, "pk-1", "EXPIRED");
    harness.toss.onFetch = () => {
      order.toss_payment_key = "pk-2";
    };

    const res = await transition(order, "cancelled");
    expect(res.status).toBe(409);
    expect(await codeOf(res)).toBe("ORDER_NOT_IN_EXPECTED_STATE");
    expect(order.status).toBe("pending");
    expect(balanceOf(db)).toBe(3000);
  });
});

describe("paid 이후 전이", () => {
  it("paid → refunded 는 토스 확인 없이 전이 + 복원(기존 계약)", async () => {
    const { db, order } = setup({ status: "paid", points: 2000 });
    // paid 주문의 원장 차감 기록
    const bal = db.find("user_points", () => true)!;
    bal.balance = 3000;
    db.seed("point_ledger", {
      user_id: order.user_id,
      amount: -2000,
      reason: "order_use",
      ref_type: "orders",
      ref_id: order.id,
      balance_after: 3000,
    });
    order.toss_payment_key = "pk-1";

    const res = await transition(order, "refunded");
    expect(res.status).toBe(200);
    expect(order.status).toBe("refunded");
    expect(balanceOf(db)).toBe(5000);
    expect(state.probeCalls).toHaveLength(0);
    expect(harness.toss.fetchCalls).toHaveLength(0);
  });

  it("paid → in_production 은 복원하지 않음", async () => {
    const { order } = setup({ status: "paid" });
    const res = await transition(order, "in_production");
    expect(res.status).toBe(200);
    expect(state.audits[0]?.details).not.toHaveProperty("creditRestore");
  });
});

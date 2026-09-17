// @vitest-environment node
import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  balanceOf,
  harness,
  resetHarness,
  seedBalance,
  seedDiscountCode,
  seedOrder,
  seedProject,
  USER_ID,
} from "@/app/api/payments/_test/harness";
import type { MemoryDb, Row } from "@/app/api/payments/_test/memory-supabase";
import type { Database } from "@/lib/db/types";
import { TossError } from "@/lib/payments/toss";
import type * as TossCancelModule from "@/lib/payments/toss-cancel";
import { cancelledOrderCancelIdempotencyKey } from "@/lib/payments/toss-cancel";

import {
  CANCELLED_ORDER_CANCEL_REASON,
  refundCapturedPaymentOfCancelledOrder,
} from "./cancelled-order-refund";

/**
 * 취소된 주문에 캡처된 결제 정리 — 토스 전액 취소 + 크레딧 복원, throw 없음.
 * 토스 취소는 하네스 시뮬레이터(DONE→CANCELED), 크레딧은 0033 RPC 흉내(refund 모드)로 검증한다.
 */

vi.mock("@/lib/payments/toss-cancel", async (importOriginal) => {
  const actual = await importOriginal<typeof TossCancelModule>();
  return {
    ...actual,
    cancelTossPaymentFully: async (args: {
      paymentKey: string;
      cancelReason: string;
      idempotencyKey: string;
    }) => (await import("@/app/api/payments/_test/harness")).harness.toss.cancelFully(args),
  };
});

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

function setup(): { db: MemoryDb; order: Row; code: Row } {
  const db = resetHarness({ atomic: true });
  const { projectId, pages } = seedProject(db);
  seedBalance(db, 5000);
  const code = seedDiscountCode(db, { max_uses: 10 });
  const order = seedOrder(db, {
    projectId,
    pages,
    requestedPoints: 2000,
    discount: code,
    status: "pending",
    tossPaymentKey: null,
  });
  return { db, order, code };
}

/** reserve RPC 로 선점 + 캡처 후 주문이 cancelled 로 바뀐 상태. */
async function capturedThenCancelled(db: MemoryDb, order: Row): Promise<void> {
  const { error } = await db.client().rpc("reserve_order_credits", {
    p_order_id: order.id,
    p_payment_key: "pk-1",
    p_amount: order.amount,
    p_toss_order_id: order.toss_order_id,
  });
  expect(error).toBeNull();
  harness.toss.payments.set("pk-1", {
    paymentKey: "pk-1",
    orderId: String(order.toss_order_id),
    totalAmount: Number(order.amount),
    status: "DONE",
  });
  order.status = "cancelled";
}

function adminOf(db: MemoryDb): SupabaseClient<Database> {
  return db.client() as unknown as SupabaseClient<Database>;
}

const ref = (order: Row) => ({
  id: String(order.id),
  user_id: USER_ID,
  points_used: Number(order.points_used),
  discount_code_id: (order.discount_code_id as string | null) ?? null,
});

describe("refundCapturedPaymentOfCancelledOrder", () => {
  it("DONE 결제를 (주문·키) 멱등 키로 전액 취소하고 선점 크레딧을 복원한다", async () => {
    const { db, order, code } = setup();
    await capturedThenCancelled(db, order);
    expect(balanceOf(db)).toBe(3000);
    expect(code.used_count).toBe(1);

    const r = await refundCapturedPaymentOfCancelledOrder(adminOf(db), ref(order), "pk-1", {
      trigger: "confirm",
    });

    expect(r).toMatchObject({ ok: true, tossOutcome: "canceled", credits: { ok: true, pointsRestored: 2000 } });
    expect(harness.toss.payments.get("pk-1")?.status).toBe("CANCELED");
    expect(harness.toss.cancelCalls).toEqual([
      {
        paymentKey: "pk-1",
        cancelReason: CANCELLED_ORDER_CANCEL_REASON,
        idempotencyKey: cancelledOrderCancelIdempotencyKey(String(order.id), "pk-1"),
      },
    ]);
    expect(balanceOf(db)).toBe(5000);
    expect(code.used_count).toBe(0);
    expect(order.status).toBe("cancelled");
  });

  it("다시 불러도 이미 취소로 수렴하고 크레딧을 두 번 돌려주지 않는다", async () => {
    const { db, order } = setup();
    await capturedThenCancelled(db, order);
    await refundCapturedPaymentOfCancelledOrder(adminOf(db), ref(order), "pk-1", { trigger: "confirm" });
    const again = await refundCapturedPaymentOfCancelledOrder(adminOf(db), ref(order), "pk-1", {
      trigger: "webhook",
    });
    expect(again).toMatchObject({ ok: true, tossOutcome: "already_canceled", credits: { ok: true, pointsRestored: 0 } });
    expect(balanceOf(db)).toBe(5000);
  });

  it("토스 취소 실패는 throw 없이 ok=false — 크레딧도 건드리지 않는다", async () => {
    const { db, order } = setup();
    await capturedThenCancelled(db, order);
    harness.toss.nextCancelError = new TossError({ code: "TOSS_TIMEOUT", message: "시간 초과", status: 504 });

    const r = await refundCapturedPaymentOfCancelledOrder(adminOf(db), ref(order), "pk-1", {
      trigger: "confirm",
    });
    expect(r).toEqual({ ok: false, code: "TOSS_TIMEOUT", message: "시간 초과", inProgress: false });
    expect(harness.toss.payments.get("pk-1")?.status).toBe("DONE");
    expect(balanceOf(db)).toBe(3000);
    expect(console.error).toHaveBeenCalled();
  });

  it("같은 멱등 키가 처리 중이면 inProgress=true", async () => {
    const { db, order } = setup();
    await capturedThenCancelled(db, order);
    harness.toss.nextCancelError = new TossError({
      code: "IDEMPOTENT_REQUEST_PROCESSING",
      message: "처리 중",
      status: 409,
    });
    const r = await refundCapturedPaymentOfCancelledOrder(adminOf(db), ref(order), "pk-1", {
      trigger: "webhook",
    });
    expect(r).toMatchObject({ ok: false, inProgress: true });
  });
});

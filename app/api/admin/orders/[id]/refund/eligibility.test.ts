import { describe, expect, it } from "vitest";

import type { OrderStatus } from "@/lib/db/types";

import {
  buildCancelReason,
  checkForceAndReason,
  DEFAULT_CANCEL_REASON,
  evaluateRefundOrderGate,
  evaluateTossPaymentForRefund,
  REFUNDABLE_FROM_STATUSES,
} from "./eligibility";

describe("REFUNDABLE_FROM_STATUSES", () => {
  it("상태 머신상 refunded 로 갈 수 있는 상태만", () => {
    expect([...REFUNDABLE_FROM_STATUSES].sort()).toEqual(
      ["delivered", "in_production", "paid", "shipped"].sort(),
    );
  });
});

describe("evaluateRefundOrderGate", () => {
  it("paid + 결제 키 → 허용, force 불필요", () => {
    expect(evaluateRefundOrderGate({ status: "paid", hasPaymentKey: true })).toEqual({
      kind: "allowed",
      requiresForce: false,
    });
  });

  it.each<OrderStatus>(["in_production", "shipped", "delivered"])(
    "%s → 허용이지만 force 필요 (제작 시작 이후)",
    (status) => {
      expect(evaluateRefundOrderGate({ status, hasPaymentKey: true })).toEqual({
        kind: "allowed",
        requiresForce: true,
      });
    },
  );

  it("refunded → already_refunded", () => {
    expect(evaluateRefundOrderGate({ status: "refunded", hasPaymentKey: true }).kind).toBe(
      "already_refunded",
    );
  });

  it.each<OrderStatus>(["pending", "cancelled"])("%s → ORDER_NOT_REFUNDABLE", (status) => {
    const g = evaluateRefundOrderGate({ status, hasPaymentKey: true });
    expect(g).toMatchObject({ kind: "blocked", code: "ORDER_NOT_REFUNDABLE", httpStatus: 409 });
  });

  it("결제 키 없음 → NO_PAYMENT_KEY", () => {
    const g = evaluateRefundOrderGate({ status: "paid", hasPaymentKey: false });
    expect(g).toMatchObject({ kind: "blocked", code: "NO_PAYMENT_KEY" });
  });
});

describe("checkForceAndReason", () => {
  it("force 불필요면 항상 통과", () => {
    expect(checkForceAndReason({ requiresForce: false, force: false, reason: "" })).toBeNull();
  });

  it("force 필요 + 미확인 → REFUND_REQUIRES_FORCE(409)", () => {
    expect(
      checkForceAndReason({ requiresForce: true, force: false, reason: "인쇄 불량" }),
    ).toMatchObject({ code: "REFUND_REQUIRES_FORCE", httpStatus: 409 });
  });

  it("force 확인 + 사유 공백 → REFUND_REASON_REQUIRED(400)", () => {
    expect(
      checkForceAndReason({ requiresForce: true, force: true, reason: "   " }),
    ).toMatchObject({ code: "REFUND_REASON_REQUIRED", httpStatus: 400 });
  });

  it("force 확인 + 사유 → 통과", () => {
    expect(
      checkForceAndReason({ requiresForce: true, force: true, reason: "인쇄 불량" }),
    ).toBeNull();
  });
});

describe("buildCancelReason", () => {
  it("빈 사유는 기본 문구, 200자 절단", () => {
    expect(buildCancelReason(undefined)).toBe(DEFAULT_CANCEL_REASON);
    expect(buildCancelReason("  ")).toBe(DEFAULT_CANCEL_REASON);
    expect(buildCancelReason(" 인쇄 불량 ")).toBe("인쇄 불량");
    expect(buildCancelReason("가".repeat(300))).toHaveLength(200);
  });
});

describe("evaluateTossPaymentForRefund", () => {
  const order = { amount: 30000, tossOrderId: "toss-order-1" };
  const pay = (status: string, extra: Record<string, unknown> = {}) => ({
    status,
    totalAmount: 30000,
    orderId: "toss-order-1",
    method: "카드",
    ...extra,
  });

  it("DONE + 동일 결제 → cancel", () => {
    expect(evaluateTossPaymentForRefund(order, pay("DONE"))).toEqual({ kind: "cancel" });
  });

  it("CANCELED → already_canceled (취소 호출 없이 상태만 수렴)", () => {
    expect(evaluateTossPaymentForRefund(order, pay("CANCELED"))).toEqual({
      kind: "already_canceled",
    });
  });

  it("PARTIAL_CANCELED → 거부 (부분 환불 모델 없음)", () => {
    expect(evaluateTossPaymentForRefund(order, pay("PARTIAL_CANCELED"))).toMatchObject({
      kind: "blocked",
      code: "PARTIAL_CANCELED_PAYMENT",
    });
  });

  it.each(["READY", "IN_PROGRESS", "WAITING_FOR_DEPOSIT", "ABORTED", "EXPIRED"])(
    "%s → PAYMENT_NOT_CANCELABLE",
    (status) => {
      expect(evaluateTossPaymentForRefund(order, pay(status))).toMatchObject({
        code: "PAYMENT_NOT_CANCELABLE",
      });
    },
  );

  it("금액 불일치 → AMOUNT_MISMATCH (CANCELED 여도 수렴하지 않음)", () => {
    expect(
      evaluateTossPaymentForRefund(order, pay("CANCELED", { totalAmount: 29000 })),
    ).toMatchObject({ code: "AMOUNT_MISMATCH" });
  });

  it("토스 orderId 불일치 → PAYMENT_MISMATCH", () => {
    expect(
      evaluateTossPaymentForRefund(order, pay("DONE", { orderId: "other" })),
    ).toMatchObject({ code: "PAYMENT_MISMATCH" });
  });

  it("주문에 toss_order_id 가 없으면 orderId 비교는 생략", () => {
    expect(
      evaluateTossPaymentForRefund({ ...order, tossOrderId: null }, pay("DONE", { orderId: "x" })),
    ).toEqual({ kind: "cancel" });
  });

  it("가상계좌 결제 → 환불 계좌 필요로 거부", () => {
    expect(
      evaluateTossPaymentForRefund(order, pay("DONE", { method: "가상계좌" })),
    ).toMatchObject({ code: "VIRTUAL_ACCOUNT_REFUND_UNSUPPORTED" });
    expect(
      evaluateTossPaymentForRefund(order, pay("DONE", { virtualAccount: { bank: "88" } })),
    ).toMatchObject({ code: "VIRTUAL_ACCOUNT_REFUND_UNSUPPORTED" });
  });
});

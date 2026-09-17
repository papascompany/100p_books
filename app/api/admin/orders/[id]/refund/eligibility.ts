/**
 * 관리자 전액 환불 판정 — 순수 함수 (DB·네트워크 없음, vitest 로 고정).
 *
 * 정책 (app/(legal)/refund/page.tsx §2):
 *   - paid(제작 전): 사유 무관 전액 환불.
 *   - in_production 이후: 단순 변심 환불 불가. 인쇄 불량·배송 사고 등 회사 귀책일 때만
 *     → 관리자 force 확인 + 사유 필수 (발주 게이트 VALIDATION_BLOCKED 의 force 관례와 동일).
 *   - pending/cancelled: 캡처된 결제가 없어 환불 대상이 아님. refunded: 종착.
 *   - 토스 결제는 DONE 만 전액 취소한다. 이미 CANCELED 면 취소 호출 없이 상태만 수렴.
 *     PARTIAL_CANCELED 는 부분 환불 모델이 없어 거부(포인트·할인 전액 복원과 어긋남).
 */

import type { OrderStatus } from "@/lib/db/types";
import { ALL_ORDER_STATUSES, canTransition } from "@/lib/orders/state";

/** 상태 머신상 refunded 로 갈 수 있는 상태 — 조건부 클레임의 IN 목록. */
export const REFUNDABLE_FROM_STATUSES: OrderStatus[] = ALL_ORDER_STATUSES.filter(
  (s) => canTransition(s, "refunded"),
);

/** 관리자 입력 사유 최대 길이 — 토스 cancelReason 한도(200자)와 동일. */
export const REFUND_REASON_MAX = 200;

export const DEFAULT_CANCEL_REASON = "고객 요청 전액 환불";

export interface RefundBlock {
  kind: "blocked";
  code: string;
  message: string;
  httpStatus: number;
}

export type RefundOrderGate =
  | { kind: "allowed"; requiresForce: boolean }
  | { kind: "already_refunded" }
  | RefundBlock;

/** 주문 상태 + 결제 키 존재만으로 판정 (force·사유는 별도). */
export function evaluateRefundOrderGate(input: {
  status: OrderStatus;
  hasPaymentKey: boolean;
}): RefundOrderGate {
  const { status } = input;
  if (status === "refunded") return { kind: "already_refunded" };
  if (!canTransition(status, "refunded")) {
    return {
      kind: "blocked",
      code: "ORDER_NOT_REFUNDABLE",
      message: `환불할 수 없는 주문 상태입니다 (현재: ${status}).`,
      httpStatus: 409,
    };
  }
  if (!input.hasPaymentKey) {
    return {
      kind: "blocked",
      code: "NO_PAYMENT_KEY",
      message:
        "토스 결제 키가 없어 자동 환불할 수 없습니다. 토스 콘솔에서 결제를 확인하세요.",
      httpStatus: 409,
    };
  }
  return { kind: "allowed", requiresForce: status !== "paid" };
}

/** 제작 시작 이후 환불은 force 확인 + 사유가 있어야 진행. */
export function checkForceAndReason(input: {
  requiresForce: boolean;
  force: boolean;
  reason: string;
}): RefundBlock | null {
  if (!input.requiresForce) return null;
  if (!input.force) {
    return {
      kind: "blocked",
      code: "REFUND_REQUIRES_FORCE",
      message:
        "제작이 시작된 주문입니다. 환불 정책상 인쇄 불량·배송 사고 등 회사 귀책일 때만 " +
        "전액 환불합니다. 확인 후 강제 환불(force)로 진행하세요.",
      httpStatus: 409,
    };
  }
  if (!input.reason.trim()) {
    return {
      kind: "blocked",
      code: "REFUND_REASON_REQUIRED",
      message: "제작 시작 이후 환불은 사유를 입력해야 합니다.",
      httpStatus: 400,
    };
  }
  return null;
}

/** 토스 cancelReason — 비었으면 기본 문구, 200자 절단. */
export function buildCancelReason(reason: string | undefined): string {
  const r = (reason ?? "").trim();
  return (r || DEFAULT_CANCEL_REASON).slice(0, REFUND_REASON_MAX);
}

export interface TossPaymentSnapshot {
  status: string;
  totalAmount: number;
  orderId?: string;
  method?: string;
  virtualAccount?: unknown;
}

export type TossRefundGate =
  | { kind: "cancel" }
  | { kind: "already_canceled" }
  | RefundBlock;

/** 토스 조회 결과가 이 주문의 결제인지, 전액 취소 가능한 상태인지 판정. */
export function evaluateTossPaymentForRefund(
  order: { amount: number; tossOrderId: string | null },
  payment: TossPaymentSnapshot,
): TossRefundGate {
  // 결제 동일성 — 다른 결제를 취소하는 사고를 막는다 (웹훅 AMOUNT_MISMATCH 와 같은 기준).
  if (order.tossOrderId && payment.orderId && payment.orderId !== order.tossOrderId) {
    return {
      kind: "blocked",
      code: "PAYMENT_MISMATCH",
      message: "토스 결제의 주문 식별자가 이 주문과 다릅니다. 토스 콘솔에서 확인하세요.",
      httpStatus: 409,
    };
  }
  if (payment.totalAmount !== order.amount) {
    return {
      kind: "blocked",
      code: "AMOUNT_MISMATCH",
      message: `토스 결제 금액(${payment.totalAmount})이 주문 금액(${order.amount})과 다릅니다.`,
      httpStatus: 409,
    };
  }

  switch (payment.status) {
    case "CANCELED":
      return { kind: "already_canceled" };
    case "PARTIAL_CANCELED":
      return {
        kind: "blocked",
        code: "PARTIAL_CANCELED_PAYMENT",
        message:
          "부분 취소된 결제입니다. 부분 환불은 앱에서 지원하지 않으니 토스 콘솔에서 처리하세요.",
        httpStatus: 409,
      };
    case "DONE":
      break;
    default:
      return {
        kind: "blocked",
        code: "PAYMENT_NOT_CANCELABLE",
        message: `취소할 수 없는 토스 결제 상태입니다 (현재: ${payment.status}).`,
        httpStatus: 409,
      };
  }

  // 가상계좌는 환불 계좌(refundReceiveAccount)가 필요 — 이 경로는 카드 결제 전용.
  if (payment.virtualAccount || payment.method === "가상계좌") {
    return {
      kind: "blocked",
      code: "VIRTUAL_ACCOUNT_REFUND_UNSUPPORTED",
      message: "가상계좌 결제는 환불 계좌 정보가 필요해 토스 콘솔에서 처리해야 합니다.",
      httpStatus: 409,
    };
  }
  return { kind: "cancel" };
}

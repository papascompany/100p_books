import "server-only";

import { probeTossOrder, type TossOrderProbe } from "@/lib/orders/toss-order-probe";
import {
  classifyTossPaymentStatus,
  fetchTossPayment,
  findTossPaymentMismatch,
  isTossLookupNotFound,
  TossError,
  type TossConfirmResponse,
} from "@/lib/payments/toss";

/**
 * 관리자 pending → cancelled 전이 전 토스 확인 — "돈은 빠졌는데 주문은 취소" 를 만들지 않는다.
 *
 * 결제 confirm 은 캡처 **전에** toss_payment_key 를 바인딩한다(0033). 그래서
 *   - 키가 묶인 pending  = 결제 승인 진행 중이거나, 캡처됐는데 확정 반영이 실패한 주문일 수 있다.
 *   - 키가 없는 pending  = 승인 시도 전(또는 캡처 안 됨이 확정돼 해제된) 주문 — 원칙적으로 미결제.
 * 사용자 취소·만료 cron 은 키 없는 주문만 토스 확인 뒤 취소한다. 관리자는 키가 묶인 주문을 정리해야
 * 할 때가 있으므로(토스에서 취소·만료된 결제) 막지 않되, 토스가 캡처·진행 중이라고 답하면 거부한다.
 *
 *   키 있음 → GET /v1/payments/{paymentKey}
 *     - 404(승인된 결제 없음) · ABORTED · EXPIRED · CANCELED → 허용
 *       (404 인데 confirm 이 그 사이 캡처하면, confirm 이 취소된 주문을 보고 결제를 전액 취소한다)
 *     - DONE · READY · IN_PROGRESS · WAITING_FOR_DEPOSIT · PARTIAL_CANCELED · 미지 상태 → 409
 *     - 다른 주문의 결제(paymentKey·orderId 불일치) → 409 (데이터 확인 필요)
 *     - 조회 실패 → 503 (fail-closed)
 *   키 없음 → GET /v1/payments/orders/{toss_order_id} (lib/orders/toss-order-probe.ts, 사용자 취소와 같은 판정)
 *     - no_payment → 허용 · payment_found → 409 · unavailable → 503
 */

export type AdminPendingCancelVerdict =
  | { kind: "allow" }
  | {
      kind: "block";
      status: 409 | 503;
      code: "PAYMENT_CAPTURED_OR_IN_PROGRESS" | "PAYMENT_MISMATCH" | "PAYMENT_STATUS_UNAVAILABLE";
      message: string;
      tossStatus?: string;
    };

export type BoundPaymentLookup =
  | { kind: "not_found" }
  | { kind: "failed"; code: string }
  | { kind: "found"; payment: Pick<TossConfirmResponse, "paymentKey" | "orderId" | "totalAmount" | "status"> };

const UNAVAILABLE_MESSAGE =
  "토스 결제 상태를 확인하지 못해 주문을 취소하지 않았습니다. 잠시 후 다시 시도하세요.";

function capturedOrInProgress(tossStatus: string): AdminPendingCancelVerdict {
  return {
    kind: "block",
    status: 409,
    code: "PAYMENT_CAPTURED_OR_IN_PROGRESS",
    message:
      `토스 결제가 승인됐거나 진행 중입니다(${tossStatus}). 주문을 취소하면 결제만 남습니다 — ` +
      "결제 반영(고객 새로고침·웹훅)을 기다리거나, 토스 콘솔에서 결제를 먼저 취소한 뒤 다시 시도하세요.",
    tossStatus,
  };
}

/** 결제 키가 묶인 pending — 결제 키 조회 결과 → 판정. 순수 함수. */
export function decideBoundPendingCancel(
  lookup: BoundPaymentLookup,
  expected: { paymentKey: string; tossOrderId: string | null; amount: number },
): AdminPendingCancelVerdict {
  if (lookup.kind === "not_found") return { kind: "allow" };
  if (lookup.kind === "failed") {
    return {
      kind: "block",
      status: 503,
      code: "PAYMENT_STATUS_UNAVAILABLE",
      message: `${UNAVAILABLE_MESSAGE} (${lookup.code})`,
    };
  }
  const mismatch = findTossPaymentMismatch(lookup.payment, {
    paymentKey: expected.paymentKey,
    orderId: expected.tossOrderId,
    amount: expected.amount,
  });
  if (mismatch.includes("paymentKey") || mismatch.includes("orderId")) {
    return {
      kind: "block",
      status: 409,
      code: "PAYMENT_MISMATCH",
      message: `주문에 묶인 결제 키가 이 주문의 토스 결제와 일치하지 않습니다(${mismatch.join(", ")}). 데이터를 확인하세요.`,
      tossStatus: lookup.payment.status,
    };
  }
  switch (classifyTossPaymentStatus(lookup.payment.status)) {
    case "not_captured":
    case "canceled":
      return { kind: "allow" };
    default:
      return capturedOrInProgress(lookup.payment.status);
  }
}

/** 결제 키가 없는 pending — 토스 주문번호 조회(probe) → 판정. 순수 함수. */
export function decideUnboundPendingCancel(probe: TossOrderProbe): AdminPendingCancelVerdict {
  if (probe.kind === "no_payment") return { kind: "allow" };
  if (probe.kind === "payment_found") return capturedOrInProgress(probe.tossStatus);
  return {
    kind: "block",
    status: 503,
    code: "PAYMENT_STATUS_UNAVAILABLE",
    message: `${UNAVAILABLE_MESSAGE} (${probe.code})`,
  };
}

export async function checkAdminPendingCancel(order: {
  toss_payment_key: string | null;
  toss_order_id: string | null;
  amount: number;
}): Promise<AdminPendingCancelVerdict> {
  if (order.toss_payment_key === null) {
    return decideUnboundPendingCancel(await probeTossOrder(order.toss_order_id));
  }
  let lookup: BoundPaymentLookup;
  try {
    lookup = { kind: "found", payment: await fetchTossPayment(order.toss_payment_key) };
  } catch (e) {
    lookup = isTossLookupNotFound(e)
      ? { kind: "not_found" }
      : { kind: "failed", code: e instanceof TossError ? e.code : "TOSS_LOOKUP_FAILED" };
  }
  return decideBoundPendingCancel(lookup, {
    paymentKey: order.toss_payment_key,
    tossOrderId: order.toss_order_id,
    amount: order.amount,
  });
}

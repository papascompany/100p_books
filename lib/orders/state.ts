/**
 * 주문 상태 머신.
 *
 * 허용된 전이:
 *   pending → paid | cancelled
 *   paid → in_production | refunded
 *   in_production → shipped | refunded
 *   shipped → delivered | refunded
 *   delivered → refunded   (배송 완료 후에도 환불 가능)
 *   cancelled / refunded — 종착 상태 (전이 없음)
 *
 * `assertTransition(from, to)` 는 invalid 시 throw — admin 페이지/관리자 API 도
 * 동일 함수를 호출하여 상태 일관성을 유지한다.
 */

import type { OrderStatus } from "@/lib/db/types";

const TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  pending: ["paid", "cancelled"],
  paid: ["in_production", "refunded"],
  in_production: ["shipped", "refunded"],
  shipped: ["delivered", "refunded"],
  delivered: ["refunded"],
  cancelled: [],
  refunded: [],
};

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  if (from === to) return false;
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export class InvalidStateTransitionError extends Error {
  status = 400;
  code = "INVALID_STATE_TRANSITION";
  constructor(public from: OrderStatus, public to: OrderStatus) {
    super(`주문 상태 전이 불가: ${from} → ${to}`);
    this.name = "InvalidStateTransitionError";
  }
}

export function assertTransition(from: OrderStatus, to: OrderStatus): void {
  if (!canTransition(from, to)) {
    throw new InvalidStateTransitionError(from, to);
  }
}

/**
 * 결제 키(toss_payment_key)가 바인딩돼 있는가.
 * 빈 문자열도 "있음" 으로 본다 — 모르는 값이면 취소하지 않는 쪽(보수적)으로 판정한다.
 * DB 조건부 UPDATE 의 `toss_payment_key is null` 과 정확히 같은 기준이다.
 *
 * 의미: payments/confirm 은 토스 승인(캡처) **전에** 크레딧 선점과 함께 키를 바인딩한다
 * (0033 reserve_order_credits, 폴백 경로도 같다). 그래서 pending 인데 키가 있으면
 *   - 결제 승인이 진행 중이거나,
 *   - 캡처 결과를 모르는 채 새로고침·웹훅을 기다리거나,
 *   - 캡처됐는데 확정(paid) 반영이 실패해 복구를 기다리는 주문일 수 있다.
 * 돈이 캡처됐을 수 있으므로 사용자 취소·자동 만료 대상이 아니다. 캡처되지 않음이 확정되면
 * (토스 거절·ABORTED·EXPIRED) confirm·웹훅이 선점과 함께 키를 해제한다.
 * 반대로 키 없는 pending 은 원칙적으로 미결제지만, 바인딩 도입 이전 주문·해제 경합에 대비해
 * 취소 직전 토스 원장 조회(lib/orders/toss-order-probe.ts)를 한 번 더 거친다.
 */
export function hasPaymentKey(tossPaymentKey: string | null | undefined): boolean {
  return tossPaymentKey !== null && tossPaymentKey !== undefined;
}

/**
 * 사용자 취소 **후보** 인가 (DEBT-6) — UI 버튼 노출 판정용.
 *
 * pending 이면서 결제 키가 없는 주문만 후보다. 결제 키가 바인딩된 pending 은 결제 승인 진행 중이거나
 * 캡처 뒤 복구를 기다리는 주문일 수 있어(hasPaymentKey 참고) 제외한다. true 여도 실제 취소는 서버가
 * 토스 원장에 승인된 결제가 없음을 확인한 뒤에만 한다(POST /api/orders/[id]/cancel).
 */
export function isUserCancellable(
  status: OrderStatus,
  tossPaymentKey: string | null | undefined,
): boolean {
  return (
    status === "pending" &&
    !hasPaymentKey(tossPaymentKey) &&
    canTransition("pending", "cancelled")
  );
}

export type UserCancelDecision =
  | { kind: "cancel" }
  /** 이미 취소됨 — 재요청(더블클릭·재시도)은 성공으로 응답한다(멱등). */
  | { kind: "already_cancelled" }
  | {
      kind: "reject";
      status: 409;
      code: "PAYMENT_IN_PROGRESS" | "ORDER_NOT_CANCELLABLE";
      message: string;
    };

/**
 * POST /api/orders/[id]/cancel 의 DB 상태 판정 (소유권 검증 이후 단계).
 * 라우트는 이 결과가 `cancel` 일 때만 토스 원장 확인을 거쳐 조건부 UPDATE 를 시도하고,
 * 경합으로 UPDATE 가 빗나가면 최신 행으로 이 함수를 다시 호출한다.
 * (`cancel` 은 "취소해도 된다" 가 아니라 "토스 확인으로 넘어가도 된다" 는 뜻이다.)
 */
export function decideUserCancel(order: {
  status: OrderStatus;
  toss_payment_key: string | null | undefined;
}): UserCancelDecision {
  if (order.status === "cancelled") return { kind: "already_cancelled" };
  if (order.status === "pending") {
    if (isUserCancellable(order.status, order.toss_payment_key)) {
      return { kind: "cancel" };
    }
    return {
      kind: "reject",
      status: 409,
      code: "PAYMENT_IN_PROGRESS",
      message:
        "결제 승인을 확인하고 있는 주문이라 지금은 취소할 수 없어요. 잠시 후 주문 내역을 새로고침해 주시고, 계속 이 상태라면 고객센터로 문의해 주세요.",
    };
  }
  return {
    kind: "reject",
    status: 409,
    code: "ORDER_NOT_CANCELLABLE",
    message:
      order.status === "refunded"
        ? "이미 환불된 주문이에요."
        : "결제가 완료된 주문은 직접 취소할 수 없어요. 취소·환불은 고객센터로 문의해 주세요.",
  };
}

/** 한국어 상태 라벨 — UI 표시용. */
export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  pending: "결제 대기",
  paid: "결제 완료",
  in_production: "제작 중",
  shipped: "배송 중",
  delivered: "배송 완료",
  cancelled: "취소됨",
  refunded: "환불됨",
};

/** UI 배지 색상 — Tailwind 클래스. */
export const ORDER_STATUS_BADGE: Record<OrderStatus, string> = {
  pending: "bg-amber-100 text-amber-800",
  paid: "bg-sky-100 text-sky-800",
  in_production: "bg-violet-100 text-violet-800",
  shipped: "bg-indigo-100 text-indigo-800",
  delivered: "bg-emerald-100 text-emerald-800",
  cancelled: "bg-zinc-200 text-zinc-700",
  refunded: "bg-rose-100 text-rose-800",
};

/** 본 상태가 PDF 다운로드 가능한지 (paid 이후). */
export function canDownloadPdfs(status: OrderStatus): boolean {
  return (
    status === "paid" ||
    status === "in_production" ||
    status === "shipped" ||
    status === "delivered"
  );
}

export const ALL_ORDER_STATUSES: OrderStatus[] = [
  "pending",
  "paid",
  "in_production",
  "shipped",
  "delivered",
  "cancelled",
  "refunded",
];

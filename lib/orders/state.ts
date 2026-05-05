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

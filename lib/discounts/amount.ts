/**
 * 할인 코드 순수 계산 — 클라이언트(주문서 가격 표시)·서버(주문 생성·결제 시점 재검증)
 * 공용. DB 접근이 없으므로 `server-only` 가 아니다(lib/orders/pricing.ts 가 import).
 */

import type { DiscountCode } from "@/lib/db/types";

/** 코드 자체 상태로 판정 가능한 사용 불가 사유 (1인 1회·금액 조건 제외). */
export type DiscountCodeStateReason = "inactive" | "expired" | "limit_reached";

/**
 * 코드 정책 + subtotal 로 실제 할인 금액 계산. (KRW 정수, subtotal 캡)
 */
export function computeDiscountAmount(
  code: Pick<DiscountCode, "type" | "value">,
  subtotal: number,
): number {
  const safeSubtotal = Math.max(0, Math.floor(subtotal));
  if (safeSubtotal <= 0) return 0;
  if (code.type === "percent") {
    const ratio = Math.max(0, Math.min(100, Number(code.value))) / 100;
    return Math.min(safeSubtotal, Math.round(safeSubtotal * ratio));
  }
  // amount
  const v = Math.max(0, Math.floor(Number(code.value)));
  return Math.min(safeSubtotal, v);
}

/**
 * active·expires_at·max_uses 판정 — validateDiscount(주문 생성)와 결제 confirm 재검증이
 * 같은 규칙을 쓰도록 한 곳에 둔다. (0033 reserve_order_credits 의 SQL 판정과 동일 순서.)
 *
 * @returns 사용 가능하면 null, 아니면 사유.
 */
export function checkDiscountCodeState(
  code: Pick<DiscountCode, "active" | "expires_at" | "max_uses" | "used_count">,
  nowMs: number = Date.now(),
): DiscountCodeStateReason | null {
  if (!code.active) return "inactive";
  if (code.expires_at) {
    const expiresAt = new Date(code.expires_at).getTime();
    if (Number.isFinite(expiresAt) && expiresAt <= nowMs) return "expired";
  }
  if (code.max_uses !== null && code.used_count >= code.max_uses) {
    return "limit_reached";
  }
  return null;
}

/**
 * 주문 금액 내역 — 주문서·결제 완료·주문 상세가 **같은 줄 구성**으로 보여 주기 위한 정본(UX P15).
 *
 * 표시 규칙(위에서 아래로 더하면 최종 결제 금액이 된다):
 *   상품 금액(수량 할인 전) → 수량 할인 → 소계 → 배송비(무료) → 할인 코드 → 포인트 → 최종 결제 금액
 *
 * 주문 행에는 수량 할인 전 금액이 저장되지 않는다. 저장값만 있을 때는
 * `소계 = amount + discount_amount + points_used` 로 역산한다 — finalAmount 의 정의
 * (`subtotal - discount - points`, pricing.ts clampPointsForMinPayment)와 같은 식이라 합계가 항상 맞는다.
 */

export interface AmountLinesInput {
  /** 수량 할인 반영 후 소계 (KRW). */
  subtotal: number;
  /** 수량 할인 정보 — 알 수 있을 때만(주문서). 주문 행 기반 화면은 null. */
  qtyDiscount: { ratio: number; amount: number } | null;
  /** 할인 코드 차감액 (KRW, 양수). */
  discountAmount: number;
  /** 적용된 할인 코드 — 라벨용. */
  discountCode?: string | null;
  /** 사용 포인트 (1P = 1원). */
  pointsUsed: number;
  /** 최종 결제 금액 (KRW). */
  finalAmount: number;
}

export type AmountLineKind = "base" | "minus" | "subtotal" | "total";

export interface AmountLine {
  key: string;
  label: string;
  /** 표시 문자열 ("12,000원", "-1,000원", "무료"). */
  value: string;
  kind: AmountLineKind;
}

const KRW = new Intl.NumberFormat("ko-KR");

export function formatKrw(n: number): string {
  return `${KRW.format(n)}원`;
}

export function buildAmountLines(input: AmountLinesInput): AmountLine[] {
  const lines: AmountLine[] = [];
  const qd = input.qtyDiscount;
  if (qd && qd.amount > 0) {
    lines.push({
      key: "product",
      label: "상품 금액",
      value: formatKrw(input.subtotal + qd.amount),
      kind: "base",
    });
    lines.push({
      key: "qty-discount",
      label: `수량 할인 (${Math.round(qd.ratio * 100)}%)`,
      value: `-${formatKrw(qd.amount)}`,
      kind: "minus",
    });
  }
  lines.push({ key: "subtotal", label: "상품 소계", value: formatKrw(input.subtotal), kind: "subtotal" });
  lines.push({ key: "shipping", label: "배송비", value: "무료", kind: "base" });
  if (input.discountAmount > 0) {
    lines.push({
      key: "coupon",
      label: input.discountCode ? `할인 코드 (${input.discountCode})` : "할인 코드",
      value: `-${formatKrw(input.discountAmount)}`,
      kind: "minus",
    });
  }
  if (input.pointsUsed > 0) {
    lines.push({
      key: "points",
      label: "포인트 사용",
      value: `-${formatKrw(input.pointsUsed)}`,
      kind: "minus",
    });
  }
  lines.push({
    key: "total",
    label: "최종 결제 금액",
    value: formatKrw(input.finalAmount),
    kind: "total",
  });
  return lines;
}

/** 주문 행 저장값 → 금액 내역 입력. */
export function amountInputFromOrder(order: {
  amount: number;
  discount_amount: number | null;
  points_used: number | null;
}): AmountLinesInput {
  const discountAmount = Math.max(0, order.discount_amount ?? 0);
  const pointsUsed = Math.max(0, order.points_used ?? 0);
  return {
    subtotal: order.amount + discountAmount + pointsUsed,
    qtyDiscount: null,
    discountAmount,
    pointsUsed,
    finalAmount: order.amount,
  };
}

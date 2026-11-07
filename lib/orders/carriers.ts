/**
 * 배송사 식별자 ↔ 표시 라벨 — 관리자 송장 입력(OrderActions)과 사용자 주문 상세가 함께 쓴다.
 * `orders.tracking_carrier` 에는 value 가 저장된다(0008_orders_tracking.sql).
 */
export const CARRIER_OPTIONS = [
  { value: "cj", label: "CJ대한통운" },
  { value: "hanjin", label: "한진택배" },
  { value: "lotte", label: "롯데택배" },
  { value: "post", label: "우체국택배" },
  { value: "logen", label: "로젠택배" },
  { value: "etc", label: "기타" },
] as const;

export type CarrierValue = (typeof CARRIER_OPTIONS)[number]["value"];

/** 저장된 배송사 값 → 라벨. 모르는 값은 원문, 비어 있으면 빈 문자열. */
export function carrierLabel(value: string | null | undefined): string {
  if (!value) return "";
  return CARRIER_OPTIONS.find((c) => c.value === value)?.label ?? value;
}

/**
 * 고객센터 연락처 — 단일 정본. 사이트 푸터(components/layout/Footer.tsx)와
 * 주문 화면(상세 안내 배너 등)이 함께 쓴다.
 */
export const CUSTOMER_CENTER_TEL = "02-2273-5131";

/** `tel:` 링크용 — 하이픈 제거. */
export const CUSTOMER_CENTER_TEL_HREF = `tel:${CUSTOMER_CENTER_TEL.replace(/-/g, "")}`;

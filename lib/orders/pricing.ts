/**
 * 주문 가격 계산.
 *
 * 단가 정책 (KRW):
 *   - 책 사이즈별 기본 단가 (A5, 14.5×14.5, 20×20).
 *   - 50p 이상부터 페이지당 200원 추가.
 *   - 수량 할인: 2개+ 5%, 5개+ 10%.
 *
 * 입력은 신뢰할 수 없으므로 호출 전 zod 검증을 하고, 계산 자체는
 * 클라/서버 모두 같은 결과가 나오도록 순수 함수로 유지한다.
 *
 * (관리자 페이지에서 향후 조정 가능하도록 DB 테이블로 이전 예정 — 본 단계는 상수.)
 */

/** 책 사이즈별 단가 (KRW) — book_sizes.name 기반 매칭. */
export const BASE_PRICE_BY_SIZE: Record<string, number> = {
  A5: 18000,
  "14.5×14.5cm": 20000,
  "20×20cm": 25000,
};

/** book_sizes.name 매칭이 실패할 때 사용할 기본 단가. */
export const FALLBACK_BASE_PRICE = 20000;

/** 페이지 추가 단가 임계 페이지 수 (이상부터 surcharge 발생). */
export const SURCHARGE_PAGE_THRESHOLD = 50;

/** 페이지 추가 단가 (per page, KRW). */
export const SURCHARGE_PER_PAGE = 200;

/** 수량 할인 — qty >= n 이면 ratio. */
export interface QtyDiscount {
  minQty: number;
  ratio: number;
}
export const QTY_DISCOUNT_TIERS: QtyDiscount[] = [
  { minQty: 5, ratio: 0.1 },
  { minQty: 2, ratio: 0.05 },
];

export interface CalcOrderAmountArgs {
  /** book_sizes.name. */
  bookSize: string;
  /** 내지 페이지 수 (>=1). */
  pageCount: number;
  /** 1~10. */
  qty: number;
}

export interface CalcOrderAmountResult {
  /** 책 사이즈 단가 (1권 기준, surcharge 미포함). */
  unit: number;
  /** 페이지 추가 단가 (1권 기준). */
  surcharge: number;
  /** 수량 할인 ratio (0..1). */
  discountRatio: number;
  /** 수량 할인 금액 (총액 기준, 양수). */
  discount: number;
  /** 최종 총액 (KRW, 정수). */
  total: number;
}

/**
 * 가격 계산 — 결과 통화 단위는 항상 정수 KRW (round).
 *
 *   subtotal = (unit + surcharge) × qty
 *   discount = subtotal × discountRatio (round)
 *   total    = subtotal - discount
 */
export function calcOrderAmount(
  args: CalcOrderAmountArgs,
): CalcOrderAmountResult {
  const unit =
    BASE_PRICE_BY_SIZE[args.bookSize] ?? FALLBACK_BASE_PRICE;

  const extraPages = Math.max(0, args.pageCount - SURCHARGE_PAGE_THRESHOLD);
  const surcharge = extraPages * SURCHARGE_PER_PAGE;

  const qty = clamp(args.qty, 1, 10);
  const subtotal = (unit + surcharge) * qty;

  const tier = QTY_DISCOUNT_TIERS.find((t) => qty >= t.minQty);
  const discountRatio = tier?.ratio ?? 0;
  const discount = Math.round(subtotal * discountRatio);
  const total = subtotal - discount;

  return { unit, surcharge, discountRatio, discount, total };
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

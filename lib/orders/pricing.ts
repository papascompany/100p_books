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

import type { DiscountCode } from "@/lib/db/types";
import { computeDiscountAmount } from "@/lib/discounts/amount";

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

/** 토스페이먼츠 최소 결제 금액 (KRW) — 이 금액 미만은 결제 요청 자체가 불가하다. */
export const MIN_PAYMENT_AMOUNT = 100;

/** 포인트 사용 단위 (100P 단위로만 사용 가능). */
export const POINTS_UNIT = 100;

export interface ClampPointsForMinPaymentArgs {
  /** 수량 할인 반영 후 소계 — calcOrderAmount().total (KRW). */
  subtotal: number;
  /** 할인 코드 차감액 (KRW, >= 0). */
  discountAmount: number;
  /** 사용 요청 포인트 (1P = 1원). */
  requestedPoints: number;
}

export interface ClampPointsForMinPaymentResult {
  /** 실제 사용할 포인트 — 100P 단위 내림 + 최소 결제 금액 확보 클램프. */
  pointsUsed: number;
  /** 클램프 반영 후 최종 결제 금액 (= 할인 후 소계 - pointsUsed). */
  finalAmount: number;
}

/**
 * 최종 결제 금액이 토스 최소 결제 금액(100원) 미만이 되지 않도록 사용 포인트를
 * 클램프한다. 클라이언트 표시 금액과 서버 주문 금액이 항상 일치하도록
 * 양쪽에서 이 함수 하나만 사용한다.
 *
 *   - 요청 포인트는 100P 단위로 내림.
 *   - 사용 가능 상한 = (할인 후 소계 - 100원)을 100P 단위로 내림.
 *   - 할인만으로 이미 100원 미만이면 포인트는 0 (주문 가능 여부는 호출측 판단).
 */
export function clampPointsForMinPayment(
  args: ClampPointsForMinPaymentArgs,
): ClampPointsForMinPaymentResult {
  const subtotalAfterDiscount = Math.max(
    0,
    Math.floor(args.subtotal) - Math.max(0, Math.floor(args.discountAmount)),
  );
  const requested =
    Math.max(0, Math.floor(args.requestedPoints / POINTS_UNIT)) * POINTS_UNIT;
  const cap =
    Math.floor(
      Math.max(0, subtotalAfterDiscount - MIN_PAYMENT_AMOUNT) / POINTS_UNIT,
    ) * POINTS_UNIT;
  const pointsUsed = Math.min(requested, cap);
  return { pointsUsed, finalAmount: subtotalAfterDiscount - pointsUsed };
}

export interface QuoteOrderArgs {
  /** book_sizes.name. */
  bookSize: string;
  /** 내지 페이지 수. */
  pageCount: number;
  /** 1~10. */
  qty: number;
  /** 적용할 할인 코드 정책 (null = 미적용). 유효성(active·만료·한도)은 호출측 책임. */
  discount: Pick<DiscountCode, "type" | "value"> | null;
  /** 사용 요청 포인트 (1P = 1원). */
  requestedPoints: number;
}

export interface OrderQuote {
  breakdown: CalcOrderAmountResult;
  /** 할인 코드 차감액 (KRW). */
  discountAmount: number;
  /** 클램프 반영 후 실제 사용 포인트. */
  pointsUsed: number;
  /** 최종 결제 금액 (KRW). */
  finalAmount: number;
}

/**
 * 주문 금액 정본 — 주문 생성(orders/create)과 결제 시점 재검증(payments/confirm)이
 * **같은 함수**로 계산해야 "생성 때와 결제 때 금액 규칙이 다르다"는 드리프트가 없다.
 *
 *   breakdown    = calcOrderAmount(책 사이즈·페이지 수·수량)
 *   discount     = computeDiscountAmount(code, breakdown.total)
 *   points/final = clampPointsForMinPayment(...)
 */
export function quoteOrder(args: QuoteOrderArgs): OrderQuote {
  const breakdown = calcOrderAmount({
    bookSize: args.bookSize,
    pageCount: args.pageCount,
    qty: args.qty,
  });
  const discountAmount = args.discount
    ? computeDiscountAmount(args.discount, breakdown.total)
    : 0;
  const { pointsUsed, finalAmount } = clampPointsForMinPayment({
    subtotal: breakdown.total,
    discountAmount,
    requestedPoints: args.requestedPoints,
  });
  return { breakdown, discountAmount, pointsUsed, finalAmount };
}

/** 주문 행에 저장된 가격 스냅샷 (orders 컬럼). */
export interface StoredOrderPricing {
  qty: number;
  amount: number;
  discount_amount: number;
  points_used: number;
}

export type OrderPricingDriftField = "amount" | "discount_amount" | "points_used";

export interface OrderPricingDrift {
  fields: OrderPricingDriftField[];
  expected: Record<OrderPricingDriftField, number>;
  stored: Record<OrderPricingDriftField, number>;
}

/**
 * 결제 시점 재검증 (DEBT-2) — 주문 생성 이후 페이지 수·책 사이즈·할인 정책이 바뀌어
 * 현재 기준 금액이 주문 행과 달라졌는지 판정한다. 드리프트가 있으면 캡처하지 않는다.
 *
 * 포인트는 주문 행의 points_used 를 "요청값"으로 다시 클램프한다 — 페이지가 줄어
 * 최소 결제 금액 확보 상한이 내려가면 points_used 도 달라져 드리프트로 잡힌다.
 *
 * @returns 드리프트 없으면 null.
 */
export function detectOrderPricingDrift(args: {
  order: StoredOrderPricing;
  bookSize: string;
  pageCount: number;
  discount: Pick<DiscountCode, "type" | "value"> | null;
}): OrderPricingDrift | null {
  const quote = quoteOrder({
    bookSize: args.bookSize,
    pageCount: args.pageCount,
    qty: args.order.qty,
    discount: args.discount,
    requestedPoints: args.order.points_used,
  });
  const expected: Record<OrderPricingDriftField, number> = {
    amount: quote.finalAmount,
    discount_amount: quote.discountAmount,
    points_used: quote.pointsUsed,
  };
  const stored: Record<OrderPricingDriftField, number> = {
    amount: args.order.amount,
    discount_amount: args.order.discount_amount,
    points_used: args.order.points_used,
  };
  const fields = (Object.keys(expected) as OrderPricingDriftField[]).filter(
    (k) => expected[k] !== stored[k],
  );
  return fields.length > 0 ? { fields, expected, stored } : null;
}

import { describe, expect, it } from "vitest";

import {
  calcOrderAmount,
  clampPointsForMinPayment,
  MIN_PAYMENT_AMOUNT,
  POINTS_UNIT,
} from "./pricing";

describe("calcOrderAmount — 단가", () => {
  it("A5 50p 1권 — 기본 단가 18000, surcharge 0", () => {
    const r = calcOrderAmount({ bookSize: "A5", pageCount: 50, qty: 1 });
    expect(r.unit).toBe(18000);
    expect(r.surcharge).toBe(0);
    expect(r.discountRatio).toBe(0);
    expect(r.total).toBe(18000);
  });

  it("14.5×14.5cm 30p 1권 — surcharge 0 (임계 미만)", () => {
    const r = calcOrderAmount({
      bookSize: "14.5×14.5cm",
      pageCount: 30,
      qty: 1,
    });
    expect(r.unit).toBe(20000);
    expect(r.surcharge).toBe(0);
    expect(r.total).toBe(20000);
  });

  it("20×20cm 100p 1권 — 25000 + (100-50)*200 = 35000", () => {
    const r = calcOrderAmount({ bookSize: "20×20cm", pageCount: 100, qty: 1 });
    expect(r.unit).toBe(25000);
    expect(r.surcharge).toBe(50 * 200);
    expect(r.total).toBe(25000 + 10000);
  });

  it("미등록 사이즈 — fallback 단가 20000", () => {
    const r = calcOrderAmount({
      bookSize: "unknown-size",
      pageCount: 50,
      qty: 1,
    });
    expect(r.unit).toBe(20000);
  });
});

describe("calcOrderAmount — 수량 할인", () => {
  it("2권 — 5% 할인", () => {
    const r = calcOrderAmount({ bookSize: "A5", pageCount: 50, qty: 2 });
    expect(r.discountRatio).toBe(0.05);
    expect(r.discount).toBe(Math.round(18000 * 2 * 0.05));
    expect(r.total).toBe(18000 * 2 - r.discount);
  });

  it("4권 — 5% 할인 (5개 미만)", () => {
    const r = calcOrderAmount({ bookSize: "A5", pageCount: 50, qty: 4 });
    expect(r.discountRatio).toBe(0.05);
  });

  it("5권 — 10% 할인", () => {
    const r = calcOrderAmount({ bookSize: "A5", pageCount: 50, qty: 5 });
    expect(r.discountRatio).toBe(0.1);
    expect(r.discount).toBe(Math.round(18000 * 5 * 0.1));
    expect(r.total).toBe(18000 * 5 - r.discount);
  });

  it("10권 — 10% 할인", () => {
    const r = calcOrderAmount({ bookSize: "A5", pageCount: 50, qty: 10 });
    expect(r.discountRatio).toBe(0.1);
  });

  it("1권 — 할인 없음", () => {
    const r = calcOrderAmount({ bookSize: "A5", pageCount: 50, qty: 1 });
    expect(r.discountRatio).toBe(0);
    expect(r.discount).toBe(0);
  });
});

describe("calcOrderAmount — 페이지 surcharge + 할인 결합", () => {
  it("A5 80p 5권 = (18000 + 6000) × 5 × 0.9 = 108000", () => {
    const r = calcOrderAmount({ bookSize: "A5", pageCount: 80, qty: 5 });
    expect(r.unit).toBe(18000);
    expect(r.surcharge).toBe(30 * 200);
    const subtotal = (18000 + 6000) * 5;
    expect(r.discount).toBe(Math.round(subtotal * 0.1));
    expect(r.total).toBe(subtotal - r.discount);
  });

  it("총액은 항상 정수", () => {
    const r = calcOrderAmount({
      bookSize: "20×20cm",
      pageCount: 73,
      qty: 3,
    });
    expect(Number.isInteger(r.total)).toBe(true);
    expect(Number.isInteger(r.discount)).toBe(true);
  });
});

describe("calcOrderAmount — 입력 클램프", () => {
  it("qty 11 → 10 으로 처리", () => {
    const r10 = calcOrderAmount({ bookSize: "A5", pageCount: 50, qty: 10 });
    const r11 = calcOrderAmount({ bookSize: "A5", pageCount: 50, qty: 11 });
    expect(r11.total).toBe(r10.total);
  });

  it("qty 0 → 1", () => {
    const r0 = calcOrderAmount({ bookSize: "A5", pageCount: 50, qty: 0 });
    const r1 = calcOrderAmount({ bookSize: "A5", pageCount: 50, qty: 1 });
    expect(r0.total).toBe(r1.total);
  });

  it("페이지 수 음수 → 0 surcharge", () => {
    const r = calcOrderAmount({ bookSize: "A5", pageCount: -10, qty: 1 });
    expect(r.surcharge).toBe(0);
  });
});

describe("clampPointsForMinPayment — 토스 최소 결제 금액 확보", () => {
  it("여유가 충분하면 요청 포인트 그대로 사용", () => {
    const r = clampPointsForMinPayment({
      subtotal: 18000,
      discountAmount: 0,
      requestedPoints: 5000,
    });
    expect(r.pointsUsed).toBe(5000);
    expect(r.finalAmount).toBe(13000);
  });

  it("요청 포인트는 100P 단위로 내림", () => {
    const r = clampPointsForMinPayment({
      subtotal: 18000,
      discountAmount: 0,
      requestedPoints: 1234,
    });
    expect(r.pointsUsed).toBe(1200);
    expect(r.finalAmount).toBe(16800);
  });

  it("전액 포인트 요청 — 최소 결제 금액 100원이 남도록 클램프", () => {
    const r = clampPointsForMinPayment({
      subtotal: 18000,
      discountAmount: 0,
      requestedPoints: 18000,
    });
    // 상한 = floor((18000-100)/100)*100 = 17900 → 최종 정확히 100원.
    expect(r.pointsUsed).toBe(17900);
    expect(r.finalAmount).toBe(MIN_PAYMENT_AMOUNT);
  });

  it("할인 반영 후 잔액 기준으로 클램프", () => {
    const r = clampPointsForMinPayment({
      subtotal: 18000,
      discountAmount: 17000,
      requestedPoints: 10000,
    });
    // 할인 후 소계 1000 → 상한 = floor((1000-100)/100)*100 = 900 → 최종 100원.
    expect(r.pointsUsed).toBe(900);
    expect(r.finalAmount).toBe(MIN_PAYMENT_AMOUNT);
  });

  it("할인만으로 이미 100원 미만이면 포인트 0", () => {
    const r = clampPointsForMinPayment({
      subtotal: 18000,
      discountAmount: 17950,
      requestedPoints: 500,
    });
    expect(r.pointsUsed).toBe(0);
    expect(r.finalAmount).toBe(50);
  });

  it("할인이 소계 초과 — 소계 0 클램프, 포인트 0", () => {
    const r = clampPointsForMinPayment({
      subtotal: 18000,
      discountAmount: 99999,
      requestedPoints: 1000,
    });
    expect(r.pointsUsed).toBe(0);
    expect(r.finalAmount).toBe(0);
  });

  it("음수/소수 입력 방어 — 음수 요청은 0, 소수는 내림", () => {
    expect(
      clampPointsForMinPayment({
        subtotal: 18000,
        discountAmount: -500,
        requestedPoints: -1000,
      }),
    ).toEqual({ pointsUsed: 0, finalAmount: 18000 });
    const r = clampPointsForMinPayment({
      subtotal: 18000.9,
      discountAmount: 0.9,
      requestedPoints: 199.9,
    });
    expect(r.pointsUsed).toBe(100);
    expect(r.finalAmount).toBe(17900);
  });

  it("결과는 항상 100P 단위·정수·최소금액 불변식 유지", () => {
    for (const subtotal of [100, 150, 999, 18000, 35000]) {
      for (const discount of [0, 99, 100, 5000]) {
        for (const requested of [0, 50, 100, 12345, 100000]) {
          const r = clampPointsForMinPayment({
            subtotal,
            discountAmount: discount,
            requestedPoints: requested,
          });
          expect(r.pointsUsed % POINTS_UNIT).toBe(0);
          expect(Number.isInteger(r.finalAmount)).toBe(true);
          expect(r.pointsUsed).toBeGreaterThanOrEqual(0);
          // 포인트를 실제로 사용했다면 최소 결제 금액은 항상 확보된다.
          if (r.pointsUsed > 0) {
            expect(r.finalAmount).toBeGreaterThanOrEqual(MIN_PAYMENT_AMOUNT);
          }
        }
      }
    }
  });
});

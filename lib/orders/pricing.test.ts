import { describe, expect, it } from "vitest";

import { calcOrderAmount } from "./pricing";

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

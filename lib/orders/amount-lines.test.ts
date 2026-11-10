import { describe, expect, it } from "vitest";

import { amountInputFromOrder, buildAmountLines } from "./amount-lines";
import { quoteOrder } from "./pricing";

function parse(v: string): number {
  if (v === "무료") return 0;
  return Number(v.replace(/[^0-9-]/g, ""));
}

/** 소계 줄부터 최종 직전까지 더하면 최종 금액과 같아야 한다. */
function sumFromSubtotal(lines: ReturnType<typeof buildAmountLines>): number {
  const start = lines.findIndex((l) => l.key === "subtotal");
  return lines
    .slice(start, -1)
    .reduce((acc, l) => acc + parse(l.value), 0);
}

describe("buildAmountLines", () => {
  it("주문서 — 수량 할인·할인 코드·포인트가 모두 있을 때 합계가 맞는다", () => {
    const q = quoteOrder({
      bookSize: "A5",
      pageCount: 40,
      qty: 5,
      discount: { type: "amount", value: 3000 },
      requestedPoints: 1200,
    });
    const lines = buildAmountLines({
      subtotal: q.breakdown.total,
      qtyDiscount: { ratio: q.breakdown.discountRatio, amount: q.breakdown.discount },
      discountAmount: q.discountAmount,
      discountCode: "WELCOME",
      pointsUsed: q.pointsUsed,
      finalAmount: q.finalAmount,
    });
    expect(lines.map((l) => l.key)).toEqual([
      "product",
      "qty-discount",
      "subtotal",
      "shipping",
      "coupon",
      "points",
      "total",
    ]);
    expect(parse(lines[0]!.value) + parse(lines[1]!.value)).toBe(q.breakdown.total);
    expect(sumFromSubtotal(lines)).toBe(q.finalAmount);
    expect(lines.find((l) => l.key === "coupon")?.label).toBe("할인 코드 (WELCOME)");
  });

  it("할인이 없으면 상품 금액·할인 줄을 만들지 않는다", () => {
    const lines = buildAmountLines({
      subtotal: 20000,
      qtyDiscount: { ratio: 0, amount: 0 },
      discountAmount: 0,
      pointsUsed: 0,
      finalAmount: 20000,
    });
    expect(lines.map((l) => l.key)).toEqual(["subtotal", "shipping", "total"]);
  });

  it("주문 행 저장값으로도 합계가 맞는다(주문 상세·완료)", () => {
    const input = amountInputFromOrder({ amount: 15800, discount_amount: 3000, points_used: 1200 });
    expect(input.subtotal).toBe(20000);
    const lines = buildAmountLines(input);
    expect(sumFromSubtotal(lines)).toBe(15800);
    expect(lines.at(-1)?.value).toBe("15,800원");
  });

  it("null 할인·포인트는 0 으로 본다", () => {
    const input = amountInputFromOrder({ amount: 20000, discount_amount: null, points_used: null });
    expect(buildAmountLines(input).map((l) => l.key)).toEqual(["subtotal", "shipping", "total"]);
  });
});

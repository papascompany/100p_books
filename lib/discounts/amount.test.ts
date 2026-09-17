import { describe, expect, it } from "vitest";

import { checkDiscountCodeState, computeDiscountAmount } from "./amount";

/**
 * 할인 코드 순수 판정 — 주문 생성(validateDiscount)과 결제 confirm 폴백 재검증이
 * 같은 규칙을 쓰는지 고정한다 (DEBT-7 b).
 */

const NOW = Date.parse("2026-09-17T12:00:00Z");
const base = { active: true, expires_at: null, max_uses: null, used_count: 0 };

describe("checkDiscountCodeState", () => {
  it("활성·무기한·무제한 → 사용 가능", () => {
    expect(checkDiscountCodeState(base, NOW)).toBeNull();
  });

  it("비활성 → inactive", () => {
    expect(checkDiscountCodeState({ ...base, active: false }, NOW)).toBe("inactive");
  });

  it("만료 시각이 지났거나 같음 → expired, 미래면 사용 가능", () => {
    expect(
      checkDiscountCodeState({ ...base, expires_at: "2026-09-17T12:00:00Z" }, NOW),
    ).toBe("expired");
    expect(
      checkDiscountCodeState({ ...base, expires_at: "2026-09-18T00:00:00Z" }, NOW),
    ).toBeNull();
  });

  it("used_count 가 max_uses 에 도달 → limit_reached", () => {
    expect(
      checkDiscountCodeState({ ...base, max_uses: 3, used_count: 3 }, NOW),
    ).toBe("limit_reached");
    expect(
      checkDiscountCodeState({ ...base, max_uses: 3, used_count: 2 }, NOW),
    ).toBeNull();
  });
});

describe("computeDiscountAmount", () => {
  it("정률은 반올림 + subtotal 캡", () => {
    expect(computeDiscountAmount({ type: "percent", value: 15 }, 18999)).toBe(2850);
    expect(computeDiscountAmount({ type: "percent", value: 150 }, 10000)).toBe(10000);
  });

  it("정액은 subtotal 캡", () => {
    expect(computeDiscountAmount({ type: "amount", value: 3000 }, 2000)).toBe(2000);
  });
});

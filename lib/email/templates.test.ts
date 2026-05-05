import { describe, expect, it } from "vitest";

import {
  renderEmailTemplate,
  TEMPLATE_BY_ORDER_STATUS,
  type OrderContext,
  type UserContext,
} from "./templates";

const orderCtx: OrderContext = {
  kind: "order",
  orderId: "00000000-0000-0000-0000-000000000001",
  tossOrderId: "ord_local_test_abc",
  customerName: "윤한솔",
  bookSizeName: "A5 정사각",
  pageCount: 100,
  qty: 2,
  amount: 38000,
  trackingNo: "1234567890",
  trackingCarrier: "CJ대한통운",
  shippedAt: "2026-05-01T03:00:00.000Z",
};

const userCtx: UserContext = {
  kind: "user",
  email: "user@example.com",
  displayName: "Sora",
};

describe("renderEmailTemplate — order.*", () => {
  for (const t of [
    "order.paid",
    "order.in_production",
    "order.shipped",
    "order.delivered",
    "order.cancelled",
    "order.refunded",
  ] as const) {
    it(`${t} — subject/text 비어있지 않고 컨텍스트 변수 포함`, () => {
      const out = renderEmailTemplate(t, orderCtx);
      expect(out.subject.length).toBeGreaterThan(0);
      expect(out.text.length).toBeGreaterThan(0);
      expect(out.subject).toContain("100p Books");
      // 본문에 고객명 또는 책 정보가 포함되어야 함
      expect(out.text).toMatch(/(윤한솔|A5|100p|38,000원)/);
      // HTML 도 만들어졌는지
      expect(out.html).toBeTruthy();
      expect(out.html?.startsWith("<!doctype html>")).toBe(true);
    });
  }

  it("order.shipped — 송장번호와 추적 URL 포함", () => {
    const out = renderEmailTemplate("order.shipped", orderCtx);
    expect(out.text).toContain("1234567890");
    expect(out.text).toContain("CJ대한통운");
    // CJ대한통운은 trace.cjlogistics.com 으로 매핑
    expect(out.text).toMatch(/trace\.cjlogistics\.com/);
  });
});

describe("renderEmailTemplate — user.*", () => {
  it("user.welcome — displayName 포함", () => {
    const out = renderEmailTemplate("user.welcome", userCtx);
    expect(out.subject).toContain("100p Books");
    expect(out.text).toContain("Sora");
  });

  it("user.account_deleted — displayName 포함", () => {
    const out = renderEmailTemplate("user.account_deleted", userCtx);
    expect(out.subject).toContain("탈퇴");
    expect(out.text).toContain("Sora");
  });
});

describe("kind mismatch 가드", () => {
  it("order 템플릿에 user 컨텍스트 → throw", () => {
    expect(() =>
      renderEmailTemplate("order.paid", userCtx),
    ).toThrowError(/OrderContext/);
  });

  it("user 템플릿에 order 컨텍스트 → throw", () => {
    expect(() =>
      renderEmailTemplate("user.welcome", orderCtx),
    ).toThrowError(/UserContext/);
  });
});

describe("TEMPLATE_BY_ORDER_STATUS 매핑", () => {
  it("pending 은 null (메일 안 보냄)", () => {
    expect(TEMPLATE_BY_ORDER_STATUS.pending).toBeNull();
  });
  it("paid → order.paid", () => {
    expect(TEMPLATE_BY_ORDER_STATUS.paid).toBe("order.paid");
  });
  it("shipped → order.shipped", () => {
    expect(TEMPLATE_BY_ORDER_STATUS.shipped).toBe("order.shipped");
  });
  it("refunded → order.refunded", () => {
    expect(TEMPLATE_BY_ORDER_STATUS.refunded).toBe("order.refunded");
  });
});

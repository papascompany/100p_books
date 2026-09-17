import { describe, expect, it } from "vitest";

import type { OrderStatus } from "@/lib/db/types";

import {
  ALL_ORDER_STATUSES,
  assertTransition,
  canDownloadPdfs,
  canTransition,
  decideUserCancel,
  hasPaymentKey,
  InvalidStateTransitionError,
  isUserCancellable,
} from "./state";

const ALLOWED: Array<[OrderStatus, OrderStatus]> = [
  ["pending", "paid"],
  ["pending", "cancelled"],
  ["paid", "in_production"],
  ["paid", "refunded"],
  ["in_production", "shipped"],
  ["in_production", "refunded"],
  ["shipped", "delivered"],
  ["shipped", "refunded"],
  ["delivered", "refunded"],
];

describe("canTransition — 허용 전이 표 전수", () => {
  for (const [from, to] of ALLOWED) {
    it(`${from} → ${to} 허용`, () => {
      expect(canTransition(from, to)).toBe(true);
    });
  }
});

describe("canTransition — 거부 전이", () => {
  it("동일 상태 — 항상 false", () => {
    for (const s of ALL_ORDER_STATUSES) {
      expect(canTransition(s, s)).toBe(false);
    }
  });

  it("cancelled / refunded 는 종착 상태", () => {
    for (const to of ALL_ORDER_STATUSES) {
      if (to === "cancelled") continue;
      expect(canTransition("cancelled", to)).toBe(false);
    }
    for (const to of ALL_ORDER_STATUSES) {
      if (to === "refunded") continue;
      expect(canTransition("refunded", to)).toBe(false);
    }
  });

  it("pending → in_production / shipped / delivered / refunded 는 거부", () => {
    expect(canTransition("pending", "in_production")).toBe(false);
    expect(canTransition("pending", "shipped")).toBe(false);
    expect(canTransition("pending", "delivered")).toBe(false);
    expect(canTransition("pending", "refunded")).toBe(false);
  });

  it("역방향 전이 (paid → pending 등) 거부", () => {
    expect(canTransition("paid", "pending")).toBe(false);
    expect(canTransition("in_production", "paid")).toBe(false);
    expect(canTransition("shipped", "in_production")).toBe(false);
    expect(canTransition("delivered", "shipped")).toBe(false);
  });

  it("paid → cancelled 는 거부 (환불은 refunded 로만)", () => {
    expect(canTransition("paid", "cancelled")).toBe(false);
  });

  it("delivered → cancelled 는 거부", () => {
    expect(canTransition("delivered", "cancelled")).toBe(false);
  });
});

describe("assertTransition — invalid 시 throw", () => {
  it("invalid 전이는 InvalidStateTransitionError", () => {
    expect(() => assertTransition("pending", "shipped")).toThrow(
      InvalidStateTransitionError,
    );
    try {
      assertTransition("pending", "shipped");
    } catch (e) {
      expect(e).toBeInstanceOf(InvalidStateTransitionError);
      const err = e as InvalidStateTransitionError;
      expect(err.status).toBe(400);
      expect(err.code).toBe("INVALID_STATE_TRANSITION");
    }
  });

  it("valid 전이는 통과", () => {
    expect(() => assertTransition("pending", "paid")).not.toThrow();
    expect(() => assertTransition("paid", "in_production")).not.toThrow();
  });
});

describe("canDownloadPdfs", () => {
  it("paid / in_production / shipped / delivered 만 true", () => {
    expect(canDownloadPdfs("pending")).toBe(false);
    expect(canDownloadPdfs("paid")).toBe(true);
    expect(canDownloadPdfs("in_production")).toBe(true);
    expect(canDownloadPdfs("shipped")).toBe(true);
    expect(canDownloadPdfs("delivered")).toBe(true);
    expect(canDownloadPdfs("cancelled")).toBe(false);
    expect(canDownloadPdfs("refunded")).toBe(false);
  });
});

describe("hasPaymentKey — DB 조건(toss_payment_key is null)과 같은 기준", () => {
  it("null·undefined 만 '없음', 빈 문자열을 포함한 문자열은 '있음'(보수적)", () => {
    expect(hasPaymentKey(null)).toBe(false);
    expect(hasPaymentKey(undefined)).toBe(false);
    expect(hasPaymentKey("")).toBe(true);
    expect(hasPaymentKey("tgen_20260917abc")).toBe(true);
  });
});

describe("isUserCancellable — 사용자 주문 취소 버튼 노출 (DEBT-6)", () => {
  it("pending + 결제 키 없음만 true", () => {
    expect(isUserCancellable("pending", null)).toBe(true);
  });

  it("pending 이어도 결제 키가 있으면 false — 토스 승인 반영 대기일 수 있음", () => {
    expect(isUserCancellable("pending", "tgen_key")).toBe(false);
    expect(isUserCancellable("pending", "")).toBe(false);
  });

  it("pending 외 모든 상태는 결제 키와 무관하게 false", () => {
    for (const s of ALL_ORDER_STATUSES) {
      if (s === "pending") continue;
      expect(isUserCancellable(s, null)).toBe(false);
      expect(isUserCancellable(s, "tgen_key")).toBe(false);
    }
  });
});

describe("decideUserCancel — POST /api/orders/[id]/cancel 판정", () => {
  it("pending + 결제 키 없음 → cancel", () => {
    expect(decideUserCancel({ status: "pending", toss_payment_key: null })).toEqual({
      kind: "cancel",
    });
  });

  it("이미 cancelled → already_cancelled (멱등 성공)", () => {
    expect(decideUserCancel({ status: "cancelled", toss_payment_key: null })).toEqual({
      kind: "already_cancelled",
    });
  });

  it("pending + 결제 키 있음 → 409 PAYMENT_IN_PROGRESS", () => {
    const d = decideUserCancel({ status: "pending", toss_payment_key: "tgen_key" });
    expect(d).toMatchObject({ kind: "reject", status: 409, code: "PAYMENT_IN_PROGRESS" });
  });

  it("결제 이후 상태(paid~delivered·refunded)는 409 ORDER_NOT_CANCELLABLE", () => {
    const after: OrderStatus[] = ["paid", "in_production", "shipped", "delivered", "refunded"];
    for (const status of after) {
      const d = decideUserCancel({ status, toss_payment_key: "tgen_key" });
      expect(d, status).toMatchObject({
        kind: "reject",
        status: 409,
        code: "ORDER_NOT_CANCELLABLE",
      });
    }
  });

  it("cancel 판정은 상태 머신의 pending → cancelled 허용과 일치", () => {
    expect(canTransition("pending", "cancelled")).toBe(true);
    for (const s of ALL_ORDER_STATUSES) {
      const d = decideUserCancel({ status: s, toss_payment_key: null });
      if (d.kind === "cancel") expect(canTransition(s, "cancelled")).toBe(true);
    }
  });
});

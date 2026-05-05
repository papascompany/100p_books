import { describe, expect, it } from "vitest";

import type { OrderStatus } from "@/lib/db/types";

import {
  ALL_ORDER_STATUSES,
  assertTransition,
  canDownloadPdfs,
  canTransition,
  InvalidStateTransitionError,
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

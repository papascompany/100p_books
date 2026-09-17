// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

import type { TossOrderProbe } from "@/lib/orders/toss-order-probe";
import type * as TossModule from "@/lib/payments/toss";
import { TossError } from "@/lib/payments/toss";

/**
 * 관리자 pending → cancelled 토스 확인 판정 (순수 함수 + 조회 분기).
 */

const lookup = vi.hoisted(() => ({
  fetch: null as null | ((paymentKey: string) => Promise<unknown>),
  probe: null as null | ((tossOrderId: string | null) => Promise<TossOrderProbe>),
}));

vi.mock("@/lib/payments/toss", async (importOriginal) => {
  const actual = await importOriginal<typeof TossModule>();
  return {
    ...actual,
    fetchTossPayment: vi.fn((paymentKey: string) => lookup.fetch!(paymentKey)),
  };
});
vi.mock("@/lib/orders/toss-order-probe", () => ({
  probeTossOrder: vi.fn((tossOrderId: string | null) => lookup.probe!(tossOrderId)),
}));

import {
  checkAdminPendingCancel,
  decideBoundPendingCancel,
  decideUnboundPendingCancel,
} from "./pending-cancel";

const EXPECTED = { paymentKey: "pk-1", tossOrderId: "100p-t1", amount: 30000 };
const payment = (status: string, over: Record<string, unknown> = {}) => ({
  kind: "found" as const,
  payment: { paymentKey: "pk-1", orderId: "100p-t1", totalAmount: 30000, status, ...over },
});

describe("decideBoundPendingCancel — 결제 키가 묶인 pending", () => {
  it.each(["ABORTED", "EXPIRED", "CANCELED"])("%s 는 캡처된 돈이 없어 취소 허용", (status) => {
    expect(decideBoundPendingCancel(payment(status), EXPECTED)).toEqual({ kind: "allow" });
  });

  it("승인된 결제 없음(404) 은 허용", () => {
    expect(decideBoundPendingCancel({ kind: "not_found" }, EXPECTED)).toEqual({ kind: "allow" });
  });

  it.each(["DONE", "READY", "IN_PROGRESS", "WAITING_FOR_DEPOSIT", "PARTIAL_CANCELED", "SOMETHING_NEW"])(
    "%s 는 409 PAYMENT_CAPTURED_OR_IN_PROGRESS",
    (status) => {
      expect(decideBoundPendingCancel(payment(status), EXPECTED)).toMatchObject({
        kind: "block",
        status: 409,
        code: "PAYMENT_CAPTURED_OR_IN_PROGRESS",
        tossStatus: status,
      });
    },
  );

  it("조회 실패는 503 (fail-closed)", () => {
    expect(decideBoundPendingCancel({ kind: "failed", code: "TOSS_TIMEOUT" }, EXPECTED)).toMatchObject({
      kind: "block",
      status: 503,
      code: "PAYMENT_STATUS_UNAVAILABLE",
    });
  });

  it("다른 주문번호·결제 키의 결제면 상태와 무관하게 409 PAYMENT_MISMATCH", () => {
    expect(decideBoundPendingCancel(payment("CANCELED", { orderId: "100p-other" }), EXPECTED)).toMatchObject({
      kind: "block",
      code: "PAYMENT_MISMATCH",
    });
    expect(decideBoundPendingCancel(payment("ABORTED", { paymentKey: "pk-x" }), EXPECTED)).toMatchObject({
      kind: "block",
      code: "PAYMENT_MISMATCH",
    });
  });
});

describe("decideUnboundPendingCancel — 결제 키 없는 pending (사용자 취소와 같은 probe)", () => {
  it("no_payment 허용 · payment_found 409 · unavailable 503", () => {
    expect(decideUnboundPendingCancel({ kind: "no_payment", reason: "not_found" })).toEqual({ kind: "allow" });
    expect(decideUnboundPendingCancel({ kind: "payment_found", tossStatus: "DONE" })).toMatchObject({
      status: 409,
      code: "PAYMENT_CAPTURED_OR_IN_PROGRESS",
    });
    expect(
      decideUnboundPendingCancel({ kind: "unavailable", code: "TOSS_HTTP_503", message: "down" }),
    ).toMatchObject({ status: 503, code: "PAYMENT_STATUS_UNAVAILABLE" });
  });
});

describe("checkAdminPendingCancel — 조회 분기", () => {
  it("키가 있으면 결제 키로 조회(404 → 허용, 그 외 TossError → 503), probe 는 부르지 않음", async () => {
    const probe = vi.fn(async (): Promise<TossOrderProbe> => ({ kind: "no_payment", reason: "not_found" }));
    lookup.probe = probe;
    lookup.fetch = async () => {
      throw new TossError({ code: "NOT_FOUND_PAYMENT", message: "없음", status: 404 });
    };
    const order = { toss_payment_key: "pk-1", toss_order_id: "100p-t1", amount: 30000 };
    expect(await checkAdminPendingCancel(order)).toEqual({ kind: "allow" });

    lookup.fetch = async () => {
      throw new TossError({ code: "TOSS_TIMEOUT", message: "시간 초과", status: 504 });
    };
    expect(await checkAdminPendingCancel(order)).toMatchObject({ status: 503 });

    lookup.fetch = async () => payment("DONE").payment;
    expect(await checkAdminPendingCancel(order)).toMatchObject({ status: 409 });
    expect(probe).not.toHaveBeenCalled();
  });

  it("키가 없으면 토스 주문번호로 probe", async () => {
    const calls: Array<string | null> = [];
    lookup.fetch = async () => {
      throw new Error("must not fetch by payment key");
    };
    lookup.probe = async (id) => {
      calls.push(id);
      return { kind: "payment_found", tossStatus: "DONE" };
    };
    expect(
      await checkAdminPendingCancel({ toss_payment_key: null, toss_order_id: "100p-t9", amount: 1 }),
    ).toMatchObject({ status: 409 });
    expect(calls).toEqual(["100p-t9"]);
  });
});

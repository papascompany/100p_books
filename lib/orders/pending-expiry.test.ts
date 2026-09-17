import { describe, expect, it, vi } from "vitest";

import {
  expirePendingOrders,
  PENDING_ORDER_EXPIRY_BATCH_DEFAULT,
  PENDING_ORDER_EXPIRY_HOURS,
  pendingExpiryCutoff,
  planPendingExpiry,
  probeCandidates,
  type PendingExpiryPort,
  type PendingOrderCandidate,
} from "./pending-expiry";
import type { TossOrderProbe } from "./toss-order-probe";

const NOW = new Date("2026-09-17T12:00:00.000Z");
const HOUR = 3_600_000;

function iso(msAgo: number): string {
  return new Date(NOW.getTime() - msAgo).toISOString();
}

function row(over: Partial<PendingOrderCandidate> & { id: string }): PendingOrderCandidate {
  return {
    status: "pending",
    toss_payment_key: null,
    toss_order_id: `toss-${over.id}`,
    created_at: iso(25 * HOUR),
    ...over,
  };
}

describe("pendingExpiryCutoff", () => {
  it("기본 임계는 24시간 — 토스 결제 유효시간(30분)보다 충분히 길다", () => {
    expect(PENDING_ORDER_EXPIRY_HOURS).toBe(24);
    expect(PENDING_ORDER_EXPIRY_HOURS * 60).toBeGreaterThan(30);
    // 후보마다 토스 조회가 붙으므로 배치는 작게 둔다.
    expect(PENDING_ORDER_EXPIRY_BATCH_DEFAULT).toBeLessThanOrEqual(50);
    expect(pendingExpiryCutoff(NOW).toISOString()).toBe("2026-09-16T12:00:00.000Z");
  });
});

describe("planPendingExpiry — 조회 결과 이중 검증", () => {
  it("결제 키 없는 24시간 초과 pending 만 취소 대상", () => {
    const plan = planPendingExpiry(
      [
        row({ id: "old-no-key" }),
        row({ id: "old-with-key", toss_payment_key: "tgen_key" }),
        row({ id: "old-empty-key", toss_payment_key: "" }),
        row({ id: "recent", created_at: iso(23 * HOUR) }),
        row({ id: "paid", status: "paid" }),
      ],
      NOW,
    );
    expect(plan.expireIds).toEqual(["old-no-key"]);
    expect(plan.skippedWithPaymentKey).toBe(2);
    expect(plan.skippedNotExpired).toBe(1);
    expect(plan.skippedNotPending).toBe(1);
  });

  it("경계값(정확히 24시간)과 해석 불가 시각은 취소하지 않는다", () => {
    const plan = planPendingExpiry(
      [
        row({ id: "boundary", created_at: iso(24 * HOUR) }),
        row({ id: "garbage", created_at: "not-a-date" }),
        row({ id: "just-over", created_at: iso(24 * HOUR + 1) }),
      ],
      NOW,
    );
    expect(plan.expireIds).toEqual(["just-over"]);
    expect(plan.skippedNotExpired).toBe(2);
  });
});

const NO_PAYMENT: TossOrderProbe = { kind: "no_payment", reason: "not_found" };

function fakePort(
  rows: PendingOrderCandidate[],
  opts: { staleWithKey?: number; probes?: Record<string, TossOrderProbe | Error> } = {},
) {
  const cancelExpired = vi.fn(async ({ ids }: { ids: string[]; before: string }) => ids);
  const listExpirable = vi.fn(async () => rows);
  const countStaleWithPaymentKey = vi.fn(async () => opts.staleWithKey ?? 0);
  const probePayment = vi.fn(async (c: PendingOrderCandidate) => {
    const p = opts.probes?.[c.id] ?? NO_PAYMENT;
    if (p instanceof Error) throw p;
    return p;
  });
  const port: PendingExpiryPort = {
    listExpirable,
    countStaleWithPaymentKey,
    probePayment,
    cancelExpired,
  };
  return { port, cancelExpired, listExpirable, countStaleWithPaymentKey, probePayment };
}

describe("expirePendingOrders — 오케스트레이션", () => {
  it("조회·갱신에 같은 cutoff 를 넘기고, 규칙을 통과한 id 만 취소한다", async () => {
    const { port, cancelExpired, listExpirable, probePayment } = fakePort([
      row({ id: "a" }),
      // 쿼리 필터가 잘못돼 섞여 들어와도 결제 키가 있는 주문은 취소하지 않는다.
      row({ id: "b", toss_payment_key: "tgen_key" }),
    ]);
    const result = await expirePendingOrders(port, { now: NOW, dryRun: false, limit: 50 });

    const cutoff = "2026-09-16T12:00:00.000Z";
    expect(listExpirable).toHaveBeenCalledWith({ before: cutoff, limit: 50 });
    // 규칙에서 걸러진 주문은 토스 조회도 하지 않는다.
    expect(probePayment).toHaveBeenCalledTimes(1);
    expect(probePayment.mock.calls[0]?.[0]).toMatchObject({ id: "a", toss_order_id: "toss-a" });
    expect(cancelExpired).toHaveBeenCalledWith({ ids: ["a"], before: cutoff });
    expect(result).toMatchObject({
      dryRun: false,
      cutoff,
      scanned: 2,
      orderIds: ["a"],
      truncated: false,
    });
  });

  it("토스에 결제 기록이 있거나 조회가 실패한 후보는 취소하지 않고 보고한다 (fail-closed)", async () => {
    const { port, cancelExpired } = fakePort(
      [row({ id: "paid-in-toss" }), row({ id: "clean" }), row({ id: "toss-down" }), row({ id: "threw" })],
      {
        probes: {
          "paid-in-toss": { kind: "payment_found", tossStatus: "DONE" },
          "toss-down": { kind: "unavailable", code: "TOSS_HTTP_503", message: "down" },
          threw: new Error("boom"),
        },
      },
    );
    const result = await expirePendingOrders(port, { now: NOW, dryRun: false });
    expect(cancelExpired).toHaveBeenCalledWith({ ids: ["clean"], before: expect.any(String) });
    expect(result.orderIds).toEqual(["clean"]);
    expect(result.paymentFound).toEqual([{ orderId: "paid-in-toss", tossStatus: "DONE" }]);
    expect(result.probeFailed).toEqual([
      { orderId: "toss-down", code: "TOSS_HTTP_503" },
      { orderId: "threw", code: "PROBE_THREW" },
    ]);
  });

  it("모든 후보가 결제 기록/조회 실패면 UPDATE 를 부르지 않는다", async () => {
    const { port, cancelExpired } = fakePort([row({ id: "a" })], {
      probes: { a: { kind: "payment_found", tossStatus: "DONE" } },
    });
    const result = await expirePendingOrders(port, { now: NOW, dryRun: false });
    expect(cancelExpired).not.toHaveBeenCalled();
    expect(result.orderIds).toEqual([]);
  });

  it("dryRun 은 상태를 바꾸지 않고 예정 id 를 돌려준다", async () => {
    const { port, cancelExpired } = fakePort([row({ id: "a" }), row({ id: "b" })], {
      staleWithKey: 3,
      probes: { b: { kind: "payment_found", tossStatus: "DONE" } },
    });
    const result = await expirePendingOrders(port, { now: NOW, dryRun: true });
    expect(cancelExpired).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      dryRun: true,
      orderIds: ["a"],
      paymentFound: [{ orderId: "b", tossStatus: "DONE" }],
      staleWithPaymentKey: 3,
    });
  });

  it("실제로 바뀐 id 만 보고한다 — 그 사이 결제된 주문은 조건부 UPDATE 가 빗나간다", async () => {
    const { port, cancelExpired } = fakePort([row({ id: "a" }), row({ id: "b" })]);
    cancelExpired.mockResolvedValueOnce(["b"]);
    const result = await expirePendingOrders(port, { now: NOW, dryRun: false });
    expect(result.orderIds).toEqual(["b"]);
  });

  it("대상이 없으면 UPDATE 를 부르지 않고, limit 에 걸리면 truncated", async () => {
    const empty = fakePort([]);
    await expirePendingOrders(empty.port, { now: NOW, dryRun: false });
    expect(empty.cancelExpired).not.toHaveBeenCalled();

    const full = fakePort([row({ id: "a" }), row({ id: "b" })]);
    const result = await expirePendingOrders(full.port, { now: NOW, dryRun: false, limit: 2 });
    expect(result.truncated).toBe(true);
  });
});

describe("probeCandidates — 동시성·시간 예산", () => {
  it("동시 실행 수를 넘지 않고, 결과는 후보 순서를 유지한다", async () => {
    let active = 0;
    let peak = 0;
    const rows = ["a", "b", "c", "d", "e"].map((id) => row({ id }));
    const outcome = await probeCandidates(
      rows,
      async (c) => {
        active += 1;
        peak = Math.max(peak, active);
        // 뒤 후보가 먼저 끝나게 해 순서 유지 여부를 본다.
        await new Promise((r) => setTimeout(r, c.id === "a" ? 5 : 1));
        active -= 1;
        return c.id === "c" ? { kind: "payment_found", tossStatus: "DONE" } : NO_PAYMENT;
      },
      { concurrency: 2, deadlineMs: Number.POSITIVE_INFINITY, clock: () => 0 },
    );
    expect(peak).toBe(2);
    expect(outcome.noPaymentIds).toEqual(["a", "b", "d", "e"]);
    expect(outcome.paymentFound).toEqual([{ orderId: "c", tossStatus: "DONE" }]);
    expect(outcome.deferred).toBe(0);
  });

  it("예산이 지나면 새 조회를 시작하지 않고 남은 후보를 deferred 로 남긴다", async () => {
    let now = 0;
    const probe = vi.fn(async () => {
      now += 10;
      return NO_PAYMENT;
    });
    const rows = ["a", "b", "c", "d"].map((id) => row({ id }));
    const outcome = await probeCandidates(rows, probe, {
      concurrency: 1,
      deadlineMs: 20,
      clock: () => now,
    });
    expect(probe).toHaveBeenCalledTimes(2);
    expect(outcome.noPaymentIds).toEqual(["a", "b"]);
    expect(outcome.deferred).toBe(2);
  });

  it("예산 초과로 조회하지 못한 후보는 취소하지 않고 truncated", async () => {
    let now = 0;
    const { port, cancelExpired } = fakePort([row({ id: "a" }), row({ id: "b" })]);
    port.probePayment = async () => {
      now += 100;
      return NO_PAYMENT;
    };
    const result = await expirePendingOrders(port, {
      now: NOW,
      dryRun: false,
      concurrency: 1,
      probeBudgetMs: 50,
      clock: () => now,
    });
    expect(cancelExpired).toHaveBeenCalledWith({ ids: ["a"], before: expect.any(String) });
    expect(result).toMatchObject({ probeDeferred: 1, truncated: true });
  });
});

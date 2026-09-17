import { describe, expect, it, vi } from "vitest";

import {
  expirePendingOrders,
  keysetAfterFilter,
  mayHoldCredits,
  PENDING_ORDER_EXPIRY_BATCH_DEFAULT,
  PENDING_ORDER_EXPIRY_HOURS,
  pendingExpiryCutoff,
  planPendingExpiry,
  probeCandidates,
  type PendingExpiryCursor,
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
    user_id: "user-1",
    points_used: 0,
    discount_code_id: null,
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

/** (created_at, id) 사전순 비교 — DB 의 ORDER BY created_at, id 와 같은 규칙. */
function afterCursor(r: PendingOrderCandidate, c: PendingExpiryCursor): boolean {
  const dt = Date.parse(r.created_at) - Date.parse(c.createdAt);
  return dt > 0 || (dt === 0 && r.id > c.id);
}

function fakePort(
  rows: PendingOrderCandidate[],
  opts: {
    staleWithKey?: number;
    probes?: Record<string, TossOrderProbe | Error>;
    restoreFails?: string[];
  } = {},
) {
  const cancelExpired = vi.fn(async ({ ids }: { ids: string[]; before: string }) => ids);
  // keyset 페이지: 커서 뒤 행을 (created_at, id) 순으로 limit 건.
  const listExpirable = vi.fn(
    async ({ limit, after }: { before: string; limit: number; after: PendingExpiryCursor | null }) =>
      [...rows]
        .sort((x, y) => Date.parse(x.created_at) - Date.parse(y.created_at) || (x.id < y.id ? -1 : 1))
        .filter((r) => after === null || afterCursor(r, after))
        .slice(0, limit),
  );
  const restoreCredits = vi.fn(async (cs: PendingOrderCandidate[]) => ({
    failedIds: cs.map((c) => c.id).filter((id) => opts.restoreFails?.includes(id)),
  }));
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
    restoreCredits,
  };
  return { port, cancelExpired, listExpirable, countStaleWithPaymentKey, probePayment, restoreCredits };
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
    expect(listExpirable).toHaveBeenCalledWith({ before: cutoff, limit: 50, after: null });
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
    // 조회 순서 = (created_at, id) — 생성 시각이 같으면 id 순.
    expect(result.probeFailed).toEqual([
      { orderId: "threw", code: "PROBE_THREW" },
      { orderId: "toss-down", code: "TOSS_HTTP_503" },
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

  it("대상이 없으면 UPDATE 를 부르지 않고, 페이지 상한에 걸리면 truncated", async () => {
    const empty = fakePort([]);
    await expirePendingOrders(empty.port, { now: NOW, dryRun: false });
    expect(empty.cancelExpired).not.toHaveBeenCalled();

    // 페이지가 꽉 차면 다음 페이지를 확인한다 — 비어 있으면 끝까지 본 것(truncated 아님).
    const full = fakePort([row({ id: "a" }), row({ id: "b" })]);
    const done = await expirePendingOrders(full.port, { now: NOW, dryRun: false, limit: 2 });
    expect(done).toMatchObject({ pages: 2, truncated: false, orderIds: ["a", "b"] });

    const capped = fakePort([row({ id: "a" }), row({ id: "b" }), row({ id: "c" })]);
    const partial = await expirePendingOrders(capped.port, {
      now: NOW,
      dryRun: false,
      limit: 2,
      maxPages: 1,
    });
    expect(partial).toMatchObject({ pages: 1, truncated: true, orderIds: ["a", "b"] });
  });

  it("head-of-line: 앞 페이지가 전부 취소 불가(결제 기록·조회 실패)여도 커서가 뒤로 진행해 만료 대상을 처리", async () => {
    const stuck = ["s1", "s2", "s3", "s4"].map((id, i) => row({ id, created_at: iso(90 * HOUR - i) }));
    const tail = ["t1", "t2"].map((id, i) => row({ id, created_at: iso(30 * HOUR - i) }));
    const { port, listExpirable, cancelExpired } = fakePort([...tail, ...stuck], {
      probes: {
        s1: { kind: "payment_found", tossStatus: "DONE" },
        s2: { kind: "payment_found", tossStatus: "DONE" },
        s3: { kind: "unavailable", code: "TOSS_ORDER_ID_MISMATCH", message: "x" },
        s4: { kind: "payment_found", tossStatus: "WAITING_FOR_DEPOSIT" },
      },
    });

    const result = await expirePendingOrders(port, { now: NOW, dryRun: false, limit: 2 });

    expect(result.orderIds).toEqual(["t1", "t2"]);
    expect(cancelExpired).toHaveBeenCalledTimes(1);
    expect(result.paymentFound.map((p) => p.orderId)).toEqual(["s1", "s2", "s4"]);
    expect(result.probeFailed).toEqual([{ orderId: "s3", code: "TOSS_ORDER_ID_MISMATCH" }]);
    // 커서는 직전 페이지의 마지막 (created_at, id)
    const cursors = listExpirable.mock.calls.map((c) => c[0].after);
    expect(cursors).toEqual([
      null,
      { createdAt: stuck[1]!.created_at, id: "s2" },
      { createdAt: stuck[3]!.created_at, id: "s4" },
      { createdAt: tail[1]!.created_at, id: "t2" },
    ]);
    expect(result).toMatchObject({ pages: 4, scanned: 6, truncated: false });
  });

  it("시간 예산이 지나면 다음 페이지로 넘어가지 않고 truncated", async () => {
    let now = 0;
    const rows = ["a", "b", "c", "d"].map((id, i) => row({ id, created_at: iso(40 * HOUR - i) }));
    const { port, listExpirable } = fakePort(rows);
    port.probePayment = async () => {
      now += 30;
      return NO_PAYMENT;
    };
    const result = await expirePendingOrders(port, {
      now: NOW,
      dryRun: false,
      limit: 2,
      concurrency: 1,
      probeBudgetMs: 60,
      clock: () => now,
    });
    expect(listExpirable).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ orderIds: ["a", "b"], pages: 1, truncated: true, probeDeferred: 0 });
  });

  it("취소한 주문 중 크레딧이 있을 수 있는 것만 복원하고, 실패 id 를 보고한다 (dryRun 은 복원 안 함)", async () => {
    const rows = [
      row({ id: "plain" }),
      row({ id: "points", points_used: 1000 }),
      row({ id: "coupon", discount_code_id: "dc-1" }),
      row({ id: "lost-race", points_used: 500 }),
    ];
    const { port, cancelExpired, restoreCredits } = fakePort(rows, { restoreFails: ["coupon"] });
    // lost-race 는 조건부 UPDATE 가 빗나간 주문(그 사이 결제 진행) — 복원 대상 아님
    cancelExpired.mockImplementationOnce(async ({ ids }) => ids.filter((id) => id !== "lost-race"));

    const result = await expirePendingOrders(port, { now: NOW, dryRun: false });
    expect(restoreCredits).toHaveBeenCalledTimes(1);
    expect(restoreCredits.mock.calls[0]?.[0].map((c) => c.id)).toEqual(["coupon", "points"]);
    expect(result.creditRestoreFailed).toEqual(["coupon"]);

    const dry = fakePort(rows);
    await expirePendingOrders(dry.port, { now: NOW, dryRun: true });
    expect(dry.restoreCredits).not.toHaveBeenCalled();
  });
});

describe("keysetAfterFilter — PostgREST (created_at, id) 커서", () => {
  const id = "0c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f";

  it("(created_at > c) OR (created_at = c AND id > i), 타임스탬프는 큰따옴표로 감싼다", () => {
    expect(keysetAfterFilter({ createdAt: "2026-09-16T11:59:59.123456+00:00", id })).toBe(
      `created_at.gt."2026-09-16T11:59:59.123456+00:00",and(created_at.eq."2026-09-16T11:59:59.123456+00:00",id.gt.${id})`,
    );
  });

  it("필터 문법을 깨는 값은 throw — 커서 없이 처음부터 다시 읽지 않는다", () => {
    expect(() => keysetAfterFilter({ createdAt: "2026-09-16T11:59:59Z", id: "a,b" })).toThrow();
    expect(() => keysetAfterFilter({ createdAt: 'x"),id.gt.(', id })).toThrow();
    expect(() => keysetAfterFilter({ createdAt: "2026-09-16T11:59:59Z,or(id.eq.1)", id })).toThrow();
    expect(() => keysetAfterFilter({ createdAt: "not-a-date", id })).toThrow();
  });
});

describe("mayHoldCredits", () => {
  it("사용 포인트나 할인 코드가 있을 때만 복원 대상", () => {
    expect(mayHoldCredits({ points_used: 0, discount_code_id: null })).toBe(false);
    expect(mayHoldCredits({ points_used: 100, discount_code_id: null })).toBe(true);
    expect(mayHoldCredits({ points_used: 0, discount_code_id: "dc-1" })).toBe(true);
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

// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 결제 키가 묶인 pending 주문의 관리자 수렴 (lib/orders/reconcile-pending.ts).
 *   - planPendingReconcile: 토스 결과 → 계획 표 전 분기.
 *   - executeReconcilePlan: 조건부 클레임 · 경합(다른 경로가 먼저 확정) · 해제 실패 처리.
 */

vi.mock("server-only", () => ({}));

const finalizeMock = vi.hoisted(() => vi.fn());
const releaseMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/orders/finalize-paid", () => ({
  finalizePaidOrder: finalizeMock,
}));
vi.mock("@/lib/orders/refund", () => ({
  releaseOrderCredits: releaseMock,
}));

import {
  executeReconcilePlan,
  isActionablePlan,
  planPendingReconcile,
  type BoundPaymentResult,
  type ReconcileOrderRow,
} from "./reconcile-pending";

const KEY = "pay_key_1";
const NOW_DATE = new Date("2026-10-05T12:00:00.000Z");
/** 결제 키가 묶인 지 2시간 — 404 해제 최소 경과(30분)를 넘긴 주문. */
const ORDER: ReconcileOrderRow = {
  id: "order-1",
  status: "pending",
  amount: 30000,
  toss_payment_key: KEY,
  toss_order_id: "toss-order-1",
  updated_at: "2026-10-05T10:00:00.000Z",
};
const CTX = { now: NOW_DATE };
const plan = (
  order: ReconcileOrderRow,
  lookup: BoundPaymentResult | null,
  ctx: Parameters<typeof planPendingReconcile>[2] = CTX,
) => planPendingReconcile(order, lookup, ctx);

function found(status: string, over: Partial<{ paymentKey: string; orderId: string; totalAmount: number }> = {}): BoundPaymentResult {
  return {
    kind: "found",
    payment: { paymentKey: KEY, orderId: "toss-order-1", totalAmount: 30000, status, ...over },
  };
}

describe("planPendingReconcile", () => {
  it("pending 이 아니거나 결제 키가 없으면 not_applicable", () => {
    expect(plan({ ...ORDER, status: "paid" }, found("DONE"))).toEqual({
      kind: "not_applicable",
      reason: "not_pending",
    });
    expect(plan({ ...ORDER, toss_payment_key: null }, null)).toEqual({
      kind: "not_applicable",
      reason: "no_payment_key",
    });
  });

  it("토스 DONE + 식별자·금액 일치 → finalize (승인 시각 전달)", () => {
    expect(plan(ORDER, found("DONE"))).toEqual({ kind: "finalize", tossStatus: "DONE", approvedAt: null });
    const withApproved: BoundPaymentResult = {
      kind: "found",
      payment: { paymentKey: KEY, orderId: "toss-order-1", totalAmount: 30000, status: "DONE", approvedAt: "2026-10-01T03:00:00+09:00" },
    };
    expect(plan(ORDER, withApproved)).toMatchObject({ kind: "finalize", approvedAt: "2026-10-01T03:00:00+09:00" });
  });

  it("ABORTED·EXPIRED → release (토스가 캡처 안 됨을 확정)", () => {
    expect(plan(ORDER, found("ABORTED")).kind).toBe("release");
    expect(plan(ORDER, found("EXPIRED")).kind).toBe("release");
  });

  describe("결제 키 조회 404 — confirm 승인 대기 중 경합 방지 (적대 리뷰 HIGH)", () => {
    const noPayment = { kind: "no_payment", reason: "not_found" } as const;

    it("바인딩 30분 경과 + 주문번호 조회도 결제 없음 → release", () => {
      expect(plan(ORDER, { kind: "not_found" }, { ...CTX, orderProbe: noPayment })).toEqual({
        kind: "release",
        tossStatus: null,
      });
    });

    it("바인딩 30분 미만이면 주문번호 결과와 무관하게 wait (confirm 이 승인 응답을 기다릴 수 있다)", () => {
      const fresh = { ...ORDER, updated_at: "2026-10-05T11:45:00.000Z" };
      expect(plan(fresh, { kind: "not_found" }, { ...CTX, orderProbe: noPayment }).kind).toBe("wait");
    });

    it("주문번호 조회에 결제가 있으면 manual, 조회 실패·누락이면 unavailable", () => {
      expect(
        plan(ORDER, { kind: "not_found" }, { ...CTX, orderProbe: { kind: "payment_found", tossStatus: "DONE" } }).kind,
      ).toBe("manual");
      expect(
        plan(ORDER, { kind: "not_found" }, { ...CTX, orderProbe: { kind: "unavailable", code: "TOSS_TIMEOUT", message: "t" } }),
      ).toEqual({ kind: "unavailable", code: "TOSS_TIMEOUT", message: "t" });
      expect(plan(ORDER, { kind: "not_found" }).kind).toBe("unavailable");
    });

    it("updated_at 해석 불가면 경과 0 으로 보고 wait (보수적)", () => {
      expect(
        plan({ ...ORDER, updated_at: "garbage" }, { kind: "not_found" }, { ...CTX, orderProbe: noPayment }).kind,
      ).toBe("wait");
    });
  });

  it("CANCELED → cancel (캡처 후 토스 전액 취소)", () => {
    expect(plan(ORDER, found("CANCELED"))).toEqual({ kind: "cancel", tossStatus: "CANCELED" });
  });

  it("READY·IN_PROGRESS → wait, PARTIAL_CANCELED·WAITING_FOR_DEPOSIT·미지 → manual", () => {
    expect(plan(ORDER, found("IN_PROGRESS")).kind).toBe("wait");
    expect(plan(ORDER, found("READY")).kind).toBe("wait");
    expect(plan(ORDER, found("PARTIAL_CANCELED")).kind).toBe("manual");
    expect(plan(ORDER, found("WAITING_FOR_DEPOSIT")).kind).toBe("manual");
    expect(plan(ORDER, found("SOMETHING_NEW")).kind).toBe("manual");
  });

  it("DONE 이어도 금액·주문번호·결제 키가 다르면 manual (남의 결제로 확정 금지)", () => {
    for (const over of [{ totalAmount: 1000 }, { orderId: "other" }, { paymentKey: "other-key" }]) {
      const p = plan(ORDER, found("DONE", over));
      expect(p.kind).toBe("manual");
    }
    // toss_order_id 가 없는 주문은 대조 불가 → manual
    expect(plan({ ...ORDER, toss_order_id: null }, found("DONE")).kind).toBe("manual");
  });

  it("조회 실패 → unavailable (fail-closed)", () => {
    expect(
      plan(ORDER, { kind: "failed", code: "TOSS_TIMEOUT", message: "timeout" }),
    ).toEqual({ kind: "unavailable", code: "TOSS_TIMEOUT", message: "timeout" });
  });

  it("isActionablePlan 은 finalize·release·cancel 만", () => {
    expect(isActionablePlan({ kind: "finalize", tossStatus: "DONE", approvedAt: null })).toBe(true);
    expect(isActionablePlan({ kind: "release", tossStatus: null })).toBe(true);
    expect(isActionablePlan({ kind: "cancel", tossStatus: "CANCELED" })).toBe(true);
    expect(isActionablePlan({ kind: "wait", tossStatus: "READY" })).toBe(false);
    expect(isActionablePlan({ kind: "manual", tossStatus: null, reason: "x" })).toBe(false);
  });
});

// ── 실행 ──────────────────────────────────────────────────────────────

type Filter = [string, unknown];

/** orders 단일 행 인메모리 테이블 — update/select + eq + maybeSingle. */
function fakeAdmin(row: Record<string, unknown>, opts: { updateError?: string } = {}) {
  const updates: Array<{ patch: Record<string, unknown>; filters: Filter[]; matched: boolean }> = [];
  const admin = {
    from: (table: string) => {
      expect(table).toBe("orders");
      let patch: Record<string, unknown> | null = null;
      const filters: Filter[] = [];
      const q = {
        update(p: Record<string, unknown>) {
          patch = p;
          return q;
        },
        select() {
          return q;
        },
        eq(col: string, v: unknown) {
          filters.push([col, v]);
          return q;
        },
        async maybeSingle() {
          const matched = filters.every(([c, v]) => row[c] === v);
          if (patch) {
            if (opts.updateError) return { data: null, error: { message: opts.updateError } };
            updates.push({ patch, filters: [...filters], matched });
            if (!matched) return { data: null, error: null };
            Object.assign(row, patch);
            return { data: { id: row.id }, error: null };
          }
          return { data: matched ? { ...row } : null, error: null };
        },
      };
      return q;
    },
  };
  return { admin: admin as never, updates, row };
}

const sendEmail = vi.fn(async () => ({ ok: true }));
const NOW = () => new Date("2026-10-05T00:00:00.000Z");

beforeEach(() => {
  finalizeMock.mockReset();
  releaseMock.mockReset();
  finalizeMock.mockResolvedValue({
    outcome: "finalized",
    leaseMode: "column",
    pdfJobId: "job-1",
    pdfError: null,
    issues: [],
    retryable: [],
  });
  releaseMock.mockResolvedValue({ ok: true, mode: "atomic", pointsRestored: 500, discountUsesRestored: 1 });
});

describe("executeReconcilePlan — finalize", () => {
  it("pending·같은 키·같은 금액일 때만 paid 로 클레임하고 claimed=true 로 finalize", async () => {
    const { admin, updates, row } = fakeAdmin({ ...ORDER });
    const r = await executeReconcilePlan(
      admin,
      { ...ORDER, toss_payment_key: KEY },
      { kind: "finalize", tossStatus: "DONE", approvedAt: null },
      { sendEmail, now: NOW },
    );
    expect(r).toMatchObject({ done: true, plan: "finalize", claimed: true });
    expect(row.status).toBe("paid");
    expect(row.paid_at).toBe("2026-10-05T00:00:00.000Z");
    expect(updates[0]?.filters).toEqual([
      ["id", "order-1"],
      ["status", "pending"],
      ["toss_payment_key", KEY],
      ["amount", 30000],
      ["toss_order_id", "toss-order-1"],
    ]);
    expect(finalizeMock).toHaveBeenCalledTimes(1);
    expect(finalizeMock.mock.calls[0]?.[2]).toMatchObject({ claimed: true, trigger: "admin_reconcile" });
  });

  it("paid_at 은 토스 승인 시각(approvedAt) — 없거나 해석 불가면 지금", async () => {
    const { admin, row } = fakeAdmin({ ...ORDER });
    await executeReconcilePlan(
      admin,
      { ...ORDER, toss_payment_key: KEY },
      { kind: "finalize", tossStatus: "DONE", approvedAt: "2026-10-01T03:00:00+09:00" },
      { sendEmail, now: NOW },
    );
    expect(row.paid_at).toBe("2026-09-30T18:00:00.000Z");
  });

  it("toss_order_id 가 없는 주문은 확정하지 않는다", async () => {
    const { admin, updates } = fakeAdmin({ ...ORDER, toss_order_id: null });
    const r = await executeReconcilePlan(
      admin,
      { ...ORDER, toss_order_id: null, toss_payment_key: KEY },
      { kind: "finalize", tossStatus: "DONE", approvedAt: null },
      { sendEmail, now: NOW },
    );
    expect(r).toMatchObject({ done: false, code: "STATE_CHANGED" });
    expect(updates).toHaveLength(0);
    expect(finalizeMock).not.toHaveBeenCalled();
  });

  it("그 사이 confirm·웹훅이 같은 결제로 확정했으면 클레임 없이 finalize 만(claimed=false)", async () => {
    const { admin, row } = fakeAdmin({ ...ORDER, status: "paid" });
    const r = await executeReconcilePlan(
      admin,
      { ...ORDER, toss_payment_key: KEY },
      { kind: "finalize", tossStatus: "DONE", approvedAt: null },
      { sendEmail, now: NOW },
    );
    expect(r).toMatchObject({ done: true, plan: "finalize", claimed: false });
    expect(row.status).toBe("paid");
    expect(finalizeMock.mock.calls[0]?.[2]).toMatchObject({ claimed: false });
  });

  it("그 사이 취소됐거나 다른 결제로 묶였으면 STATE_CHANGED — finalize 하지 않음", async () => {
    for (const changed of [{ status: "cancelled" }, { status: "paid", toss_payment_key: "other" }]) {
      finalizeMock.mockClear();
      const { admin } = fakeAdmin({ ...ORDER, ...changed });
      const r = await executeReconcilePlan(
        admin,
        { ...ORDER, toss_payment_key: KEY },
        { kind: "finalize", tossStatus: "DONE", approvedAt: null },
        { sendEmail, now: NOW },
      );
      expect(r).toMatchObject({ done: false, code: "STATE_CHANGED" });
      expect(finalizeMock).not.toHaveBeenCalled();
    }
  });

  it("클레임 UPDATE 오류는 DB_ERROR", async () => {
    const { admin } = fakeAdmin({ ...ORDER }, { updateError: "boom" });
    const r = await executeReconcilePlan(
      admin,
      { ...ORDER, toss_payment_key: KEY },
      { kind: "finalize", tossStatus: "DONE", approvedAt: null },
      { sendEmail, now: NOW },
    );
    expect(r).toMatchObject({ done: false, code: "DB_ERROR" });
    expect(finalizeMock).not.toHaveBeenCalled();
  });
});

describe("executeReconcilePlan — release", () => {
  it("선점 해제 + 결제 키 해제(clearPaymentKey=true), 상태는 pending 유지", async () => {
    const { admin, updates } = fakeAdmin({ ...ORDER });
    const r = await executeReconcilePlan(
      admin,
      { ...ORDER, toss_payment_key: KEY },
      { kind: "release", tossStatus: "EXPIRED" },
      { sendEmail },
    );
    expect(r).toMatchObject({ done: true, plan: "release" });
    expect(releaseMock).toHaveBeenCalledWith(admin, { orderId: "order-1", paymentKey: KEY, clearPaymentKey: true });
    expect(updates).toHaveLength(0);
  });

  it("RPC 가 NOT_PENDING 등으로 거부하면 STATE_CHANGED, RELEASE_FAILED 면 CREDITS_RELEASE_FAILED", async () => {
    const { admin } = fakeAdmin({ ...ORDER });
    releaseMock.mockResolvedValueOnce({ ok: false, mode: "atomic", code: "NOT_PENDING" });
    expect(
      await executeReconcilePlan(admin, { ...ORDER, toss_payment_key: KEY }, { kind: "release", tossStatus: null }, { sendEmail }),
    ).toMatchObject({ done: false, code: "STATE_CHANGED" });
    releaseMock.mockResolvedValueOnce({ ok: false, mode: "atomic", code: "RELEASE_FAILED", message: "x" });
    expect(
      await executeReconcilePlan(admin, { ...ORDER, toss_payment_key: KEY }, { kind: "release", tossStatus: null }, { sendEmail }),
    ).toMatchObject({ done: false, code: "CREDITS_RELEASE_FAILED" });
  });
});

describe("executeReconcilePlan — cancel", () => {
  it("선점 해제(키 유지) 후 pending→cancelled 조건부 전이", async () => {
    const { admin, row, updates } = fakeAdmin({ ...ORDER });
    const r = await executeReconcilePlan(
      admin,
      { ...ORDER, toss_payment_key: KEY },
      { kind: "cancel", tossStatus: "CANCELED" },
      { sendEmail },
    );
    expect(r).toMatchObject({ done: true, plan: "cancel", cancelled: true });
    expect(releaseMock).toHaveBeenCalledWith(admin, { orderId: "order-1", paymentKey: KEY, clearPaymentKey: false });
    expect(row.status).toBe("cancelled");
    expect(row.toss_payment_key).toBe(KEY);
    expect(updates[0]?.filters).toEqual([
      ["id", "order-1"],
      ["status", "pending"],
      ["toss_payment_key", KEY],
    ]);
  });

  it("해제가 거부되면 상태를 바꾸지 않는다", async () => {
    const { admin, row, updates } = fakeAdmin({ ...ORDER });
    releaseMock.mockResolvedValueOnce({ ok: false, mode: "atomic", code: "PAYMENT_KEY_MISMATCH" });
    const r = await executeReconcilePlan(
      admin,
      { ...ORDER, toss_payment_key: KEY },
      { kind: "cancel", tossStatus: "CANCELED" },
      { sendEmail },
    );
    expect(r).toMatchObject({ done: false, code: "STATE_CHANGED" });
    expect(row.status).toBe("pending");
    expect(updates).toHaveLength(0);
  });
});

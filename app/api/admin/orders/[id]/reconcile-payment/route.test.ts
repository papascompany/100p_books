// @vitest-environment node
import type { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type * as ReconcileModule from "@/lib/orders/reconcile-pending";

/**
 * /api/admin/orders/:id/reconcile-payment 라우트 흐름 — 판정·실행 자체는 lib 테스트가 덮고,
 * 여기서는 라우트의 게이트만 고정한다.
 *   - 권한: requireAdmin 실패 → 토스·DB 무접촉.
 *   - GET: 쓰기 없이 계획만 돌려준다.
 *   - POST: 실행 직전 재조회 계획이 expect 와 다르면 409 PLAN_CHANGED(실행 안 함),
 *           실행 불가 계획이면 409/503 NOT_ACTIONABLE, 성공·실패 모두 감사 로그.
 */

vi.mock("server-only", () => ({}));

const state = vi.hoisted(() => ({
  adminError: null as null | Error,
  order: null as null | Record<string, unknown>,
  lookup: { kind: "found", payment: { paymentKey: "k", orderId: "t", totalAmount: 1000, status: "DONE" } } as unknown,
  execResult: { done: true, plan: "finalize", claimed: true, finalize: { outcome: "finalized" } } as unknown,
  audits: [] as Array<{ action: string; details?: Record<string, unknown> }>,
  lookups: 0,
  executes: 0,
}));

vi.mock("@/lib/auth/session", () => ({
  requireAdmin: vi.fn(async () => {
    if (state.adminError) throw state.adminError;
    return { id: "admin-1", email: "admin@example.com" };
  }),
}));

vi.mock("@/lib/admin/audit", () => ({
  logAdminAction: vi.fn(async (a: { action: string; details?: Record<string, unknown> }) => {
    state.audits.push(a);
  }),
}));

vi.mock("@/lib/email/queue", () => ({ enqueueEmail: vi.fn(async () => ({ ok: true })) }));

vi.mock("@/lib/db/admin", () => ({
  createAdminSupabase: () => ({
    from: () => {
      const q = {
        select: () => q,
        eq: () => q,
        maybeSingle: async () => ({ data: state.order, error: null }),
      };
      return q;
    },
  }),
}));

vi.mock("@/lib/orders/reconcile-pending", async (importOriginal) => {
  const real = await importOriginal<typeof ReconcileModule>();
  return {
    ...real,
    lookupBoundPayment: vi.fn(async () => {
      state.lookups += 1;
      return state.lookup;
    }),
    executeReconcilePlan: vi.fn(async () => {
      state.executes += 1;
      return state.execResult;
    }),
  };
});

import { GET, POST } from "./route";

const ORDER_ID = "11111111-2222-3333-4444-555555555555";
const ctx = { params: Promise.resolve({ id: ORDER_ID }) };

function req(method: "GET" | "POST", body?: unknown): NextRequest {
  return new Request(`http://localhost/api/admin/orders/${ORDER_ID}/reconcile-payment`, {
    method,
    ...(body !== undefined ? { body: JSON.stringify(body), headers: { "content-type": "application/json" } } : {}),
  }) as unknown as NextRequest;
}

beforeEach(() => {
  state.adminError = null;
  state.order = {
    id: ORDER_ID,
    status: "pending",
    amount: 1000,
    toss_payment_key: "k",
    toss_order_id: "t",
    updated_at: "2026-01-01T00:00:00.000Z",
  };
  state.lookup = { kind: "found", payment: { paymentKey: "k", orderId: "t", totalAmount: 1000, status: "DONE" } };
  state.execResult = { done: true, plan: "finalize", claimed: true, finalize: { outcome: "finalized" } };
  state.audits = [];
  state.lookups = 0;
  state.executes = 0;
});

describe("reconcile-payment route", () => {
  it("관리자가 아니면 토스 조회·실행 없이 거부", async () => {
    state.adminError = Object.assign(new Error("forbidden"), { status: 403, code: "FORBIDDEN" });
    const g = await GET(req("GET"), ctx);
    const p = await POST(req("POST", { expect: "finalize" }), ctx);
    expect(g.status).toBe(403);
    expect(p.status).toBe(403);
    expect(state.lookups).toBe(0);
    expect(state.executes).toBe(0);
  });

  it("GET 은 계획만 돌려주고 실행하지 않는다", async () => {
    const r = await GET(req("GET"), ctx);
    const j = await r.json();
    expect(r.status).toBe(200);
    expect(j.data.plan).toEqual({ kind: "finalize", tossStatus: "DONE", approvedAt: null });
    expect(j.data.actionable).toBe(true);
    expect(state.executes).toBe(0);
    expect(state.audits).toHaveLength(0);
  });

  it("POST — 재조회 계획이 expect 와 다르면 409 PLAN_CHANGED, 실행 안 함", async () => {
    state.lookup = { kind: "found", payment: { paymentKey: "k", orderId: "t", totalAmount: 1000, status: "CANCELED" } };
    const r = await POST(req("POST", { expect: "finalize" }), ctx);
    const j = await r.json();
    expect(r.status).toBe(409);
    expect(j.error.code).toBe("PLAN_CHANGED");
    expect(state.executes).toBe(0);
    expect(state.audits.map((a) => a.action)).toEqual(["order.payment_reconcile_rejected"]);
  });

  it("POST — 실행 불가(진행 중 409, 조회 실패 503)면 실행 안 함", async () => {
    state.lookup = { kind: "found", payment: { paymentKey: "k", orderId: "t", totalAmount: 1000, status: "IN_PROGRESS" } };
    expect((await POST(req("POST", { expect: "finalize" }), ctx)).status).toBe(409);
    state.lookup = { kind: "failed", code: "TOSS_TIMEOUT", message: "t" };
    expect((await POST(req("POST", { expect: "finalize" }), ctx)).status).toBe(503);
    state.order = { ...state.order, status: "paid" };
    expect((await POST(req("POST", { expect: "finalize" }), ctx)).status).toBe(409);
    expect(state.executes).toBe(0);
  });

  it("POST — 잘못된 expect 는 400", async () => {
    expect((await POST(req("POST", { expect: "wait" }), ctx)).status).toBe(400);
    expect((await POST(req("POST", {}), ctx)).status).toBe(400);
    expect(state.executes).toBe(0);
  });

  it("POST 성공 — 실행 1회 + 감사 로그 order.payment_reconciled", async () => {
    const r = await POST(req("POST", { expect: "finalize" }), ctx);
    expect(r.status).toBe(200);
    expect(state.executes).toBe(1);
    expect(state.audits.map((a) => a.action)).toEqual(["order.payment_reconciled"]);
  });

  it("POST 실행 중 예외 — 500 + 실패 감사 로그", async () => {
    const { executeReconcilePlan } = await import("@/lib/orders/reconcile-pending");
    vi.mocked(executeReconcilePlan).mockImplementationOnce(async () => {
      throw new Error("boom");
    });
    const r = await POST(req("POST", { expect: "finalize" }), ctx);
    expect(r.status).toBe(500);
    expect(state.audits.map((a) => a.action)).toEqual(["order.payment_reconcile_failed"]);
  });

  it("POST 실행 실패 — STATE_CHANGED 409 + 실패 감사 로그", async () => {
    state.execResult = { done: false, code: "STATE_CHANGED", message: "changed" };
    const r = await POST(req("POST", { expect: "finalize" }), ctx);
    expect(r.status).toBe(409);
    expect(state.audits.map((a) => a.action)).toEqual(["order.payment_reconcile_failed"]);
  });
});

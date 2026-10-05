import "server-only";

import { z } from "zod";

import { fail, ok } from "@/app/api/_lib/response";
import { withAdmin } from "@/lib/admin/auth";
import { logAdminAction } from "@/lib/admin/audit";
import { createAdminSupabase } from "@/lib/db/admin";
import { enqueueEmail } from "@/lib/email/queue";
import {
  executeReconcilePlan,
  isActionablePlan,
  lookupBoundPayment,
  planPendingReconcile,
  RECONCILE_ORDER_COLUMNS,
  type ReconcileOrderRow,
  type ReconcilePlan,
} from "@/lib/orders/reconcile-pending";
import { probeTossOrder } from "@/lib/orders/toss-order-probe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// finalize 가 PDF 빌드를 waitUntil 로 실행한다 — confirm·rebuild-pdf 와 같은 한도(vercel.json 메모리 포함).
export const maxDuration = 300;

/**
 * /api/admin/orders/:id/reconcile-payment — 결제 키가 묶인 pending 주문의 토스 기준 수렴.
 * 판정·실행 규칙은 lib/orders/reconcile-pending.ts.
 *
 *   GET  : 토스 재조회 → 계획 미리보기(쓰기 없음).
 *   POST : { expect } — 실행 직전에 토스를 **다시** 조회해 계획을 만들고, 미리보기 때와 같은
 *          종류일 때만 실행한다(그 사이 토스 상태가 바뀌었으면 409 PLAN_CHANGED). 감사 로그 기록.
 */

const BodySchema = z.object({
  expect: z.enum(["finalize", "release", "cancel"]),
});

async function loadOrder(id: string) {
  const admin = createAdminSupabase();
  const { data, error } = await admin
    .from("orders")
    .select(RECONCILE_ORDER_COLUMNS)
    .eq("id", id)
    .maybeSingle();
  return {
    admin,
    order: (data as ReconcileOrderRow | null) ?? null,
    error: error?.message ?? null,
  };
}

async function buildPlan(order: ReconcileOrderRow): Promise<ReconcilePlan> {
  const now = new Date();
  if (order.status !== "pending" || order.toss_payment_key === null) {
    return planPendingReconcile(order, null, { now });
  }
  const lookup = await lookupBoundPayment(order.toss_payment_key);
  // 결제 키 조회 404 일 때만 주문번호로 한 번 더 확인한다(키 해제 전 이중 확인 — lib 주석 참조).
  const orderProbe = lookup.kind === "not_found" ? await probeTossOrder(order.toss_order_id) : null;
  return planPendingReconcile(order, lookup, { now, orderProbe });
}

export const GET = withAdmin<{ id: string }>(async (_req, ctx) => {
  const { order, error } = await loadOrder(ctx.params.id);
  if (error) return fail("ORDER_QUERY_FAILED", error, 500);
  if (!order) return fail("NOT_FOUND", "주문을 찾을 수 없습니다.", 404);
  const plan = await buildPlan(order);
  return ok({ orderId: order.id, status: order.status, plan, actionable: isActionablePlan(plan) });
});

export const POST = withAdmin<{ id: string }>(async (req, ctx, user) => {
  const raw: unknown = await req.json().catch(() => null);
  const body = BodySchema.safeParse(raw);
  if (!body.success) {
    return fail("INVALID_BODY", "expect(finalize|release|cancel) 가 필요합니다.", 400);
  }

  const { admin, order, error } = await loadOrder(ctx.params.id);
  if (error) return fail("ORDER_QUERY_FAILED", error, 500);
  if (!order) return fail("NOT_FOUND", "주문을 찾을 수 없습니다.", 404);

  const plan = await buildPlan(order);
  const audit = (action: string, details: Record<string, unknown>) =>
    logAdminAction({
      actor: { id: user.id, email: user.email },
      action,
      targetType: "order",
      targetId: order.id,
      details: { from: order.status, amount: order.amount, expect: body.data.expect, plan, ...details },
      request: req,
    });

  if (!isActionablePlan(plan) || order.toss_payment_key === null) {
    await audit("order.payment_reconcile_rejected", { code: "NOT_ACTIONABLE" });
    const status = plan.kind === "unavailable" ? 503 : 409;
    return fail("NOT_ACTIONABLE", "지금은 자동 수렴할 수 없는 주문입니다.", status, { plan });
  }
  if (plan.kind !== body.data.expect) {
    await audit("order.payment_reconcile_rejected", { code: "PLAN_CHANGED" });
    return fail(
      "PLAN_CHANGED",
      "미리보기 이후 토스 결제 상태가 바뀌었습니다. 다시 확인한 뒤 실행하세요.",
      409,
      { plan },
    );
  }

  let result: Awaited<ReturnType<typeof executeReconcilePlan>>;
  try {
    result = await executeReconcilePlan(
      admin,
      { ...order, toss_payment_key: order.toss_payment_key },
      plan,
      { sendEmail: enqueueEmail },
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await audit("order.payment_reconcile_failed", { code: "EXCEPTION", message });
    return fail("RECONCILE_FAILED", `결제 수렴 중 오류: ${message}`, 500, { plan });
  }

  if (!result.done) {
    await audit("order.payment_reconcile_failed", { code: result.code, message: result.message });
    const status = result.code === "STATE_CHANGED" ? 409 : 500;
    return fail(result.code, result.message, status, { plan });
  }

  await audit("order.payment_reconciled", { result });
  return ok({ orderId: order.id, plan, result });
});

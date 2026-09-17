import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { fail, ok } from "@/app/api/_lib/response";
import { withAdmin } from "@/lib/admin/auth";
import { logAdminAction } from "@/lib/admin/audit";
import { createAdminSupabase } from "@/lib/db/admin";
import type { Database, OrderStatus } from "@/lib/db/types";
import { enqueueEmail } from "@/lib/email/queue";
import { enqueueOrderRefundedEmail } from "@/lib/orders/order-emails";
import { restoreOrderCredits } from "@/lib/orders/refund";
import { TossError } from "@/lib/payments/toss";
import {
  cancelTossPaymentFully,
  getTossPayment,
  refundIdempotencyKey,
  type TossFullCancelOutcome,
  type TossPayment,
} from "@/lib/payments/toss-cancel";

import {
  buildCancelReason,
  checkForceAndReason,
  evaluateRefundOrderGate,
  evaluateTossPaymentForRefund,
  REFUND_REASON_MAX,
  REFUNDABLE_FROM_STATUSES,
} from "./eligibility";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// 토스 조회(10s) + 취소(20s) + 재조회(10s) 최악 경로를 덮는다.
export const maxDuration = 60;

const BodySchema = z.object({
  /** 제작 시작 이후(in_production·shipped·delivered) 환불의 정책 예외 확인. */
  force: z.boolean().optional(),
  /** 토스 cancelReason + 감사 로그. 제작 이후 환불은 필수. */
  reason: z.string().trim().max(REFUND_REASON_MAX).optional(),
});

const ORDER_COLUMNS =
  "id, status, amount, user_id, qty, project_id, address, points_used, discount_code_id, discount_amount, toss_payment_key, toss_order_id";

interface RefundOrderRow {
  id: string;
  status: OrderStatus;
  amount: number;
  user_id: string;
  qty: number;
  project_id: string;
  address: { name?: string } | null;
  points_used: number;
  discount_code_id: string | null;
  discount_amount: number;
  toss_payment_key: string | null;
  toss_order_id: string | null;
}

type AdminClient = SupabaseClient<Database>;

async function loadOrder(
  admin: AdminClient,
  id: string,
): Promise<{ row: RefundOrderRow | null; error: string | null }> {
  const { data, error } = await admin
    .from("orders")
    .select(ORDER_COLUMNS)
    .eq("id", id)
    .maybeSingle();
  if (error) return { row: null, error: error.message };
  return { row: (data as RefundOrderRow | null) ?? null, error: null };
}

function tossSummary(p: TossPayment) {
  return {
    status: p.status,
    method: p.method ?? null,
    totalAmount: p.totalAmount,
    balanceAmount: typeof p.balanceAmount === "number" ? p.balanceAmount : null,
    approvedAt: p.approvedAt ?? null,
  };
}

/**
 * GET /api/admin/orders/:id/refund — 환불 확인 다이얼로그용 미리보기 (읽기 전용).
 *
 *   주문 금액·복원 대상(포인트·할인)과 토스 결제 실제 상태(금액·결제수단)를 보여주고,
 *   POST 와 같은 판정으로 차단 사유·force 필요 여부를 돌려준다.
 *   토스 조회 실패는 200 + tossError 로 싣는다(다이얼로그는 떠야 한다).
 */
export const GET = withAdmin<{ id: string }>(async (_req, ctx) => {
  const admin = createAdminSupabase();
  const { row: order, error } = await loadOrder(admin, ctx.params.id);
  if (error) return fail("ORDER_QUERY_FAILED", error, 500);
  if (!order) return fail("NOT_FOUND", "주문을 찾을 수 없습니다.", 404);

  const gate = evaluateRefundOrderGate({
    status: order.status,
    hasPaymentKey: !!order.toss_payment_key,
  });

  let toss: ReturnType<typeof tossSummary> | null = null;
  let tossError: string | null = null;
  let block: { code: string; message: string } | null = null;
  let tossAlreadyCanceled = false;

  if (gate.kind === "blocked") {
    block = { code: gate.code, message: gate.message };
  } else if (gate.kind === "already_refunded") {
    block = { code: "ALREADY_REFUNDED", message: "이미 환불된 주문입니다." };
  } else if (order.toss_payment_key) {
    try {
      const payment = await getTossPayment(order.toss_payment_key);
      toss = tossSummary(payment);
      const tg = evaluateTossPaymentForRefund(
        { amount: order.amount, tossOrderId: order.toss_order_id },
        payment,
      );
      if (tg.kind === "blocked") block = { code: tg.code, message: tg.message };
      tossAlreadyCanceled = tg.kind === "already_canceled";
    } catch (e) {
      tossError = e instanceof Error ? e.message : "토스 결제 조회 실패";
    }
  }

  return ok({
    order: {
      id: order.id,
      status: order.status,
      amount: order.amount,
      pointsUsed: order.points_used ?? 0,
      discountAmount: order.discount_amount ?? 0,
      hasDiscountCode: !!order.discount_code_id,
    },
    refundable: gate.kind === "allowed" && !block,
    requiresForce: gate.kind === "allowed" && gate.requiresForce,
    block,
    toss,
    tossError,
    tossAlreadyCanceled,
  });
});

/**
 * POST /api/admin/orders/:id/refund — 관리자 **전액** 환불 실행.
 *
 *   body: { force?: boolean, reason?: string }
 *
 *   1. 주문 판정: refundable 상태 + toss_payment_key. 제작 이후는 force + 사유.
 *   2. 토스 조회로 결제 동일성(orderId·금액)과 상태 확인. PARTIAL_CANCELED·미완료 결제는 거부.
 *   3. DONE → 전액 취소(주문 id 멱등 키) → 재조회로 CANCELED 확인.
 *      이미 CANCELED(콘솔 취소·동시 요청) → 취소 호출 없이 4로.
 *      **토스 단계가 실패하면 주문은 그대로 둔다.**
 *   4. 조건부 클레임 UPDATE(status IN refundable) → 승자만 restoreOrderCredits + 고객 메일.
 *      패자(동시 요청·웹훅 선반영)는 재조회해 refunded 면 성공으로 수렴(복원·메일은 승자 1회 —
 *      웹훅이 이기면 웹훅이 환불 메일을 보낸다, lib/orders/order-emails.ts).
 *   5. 감사 로그 order.refund (실패 시 order.refund_failed — 토스 사전 조회 실패·결제 불일치 차단 포함).
 *      복원량은 restoreOrderCredits 반환값(실제로 되돌린 포인트·할인 사용 수)으로 남긴다.
 */
export const POST = withAdmin<{ id: string }>(async (req, ctx, user) => {
  const raw = (await req.json().catch(() => ({}))) as unknown;
  const parsed = BodySchema.safeParse(raw ?? {});
  if (!parsed.success) {
    return fail(
      "INVALID_BODY",
      "요청 본문이 올바르지 않습니다.",
      400,
      parsed.error.flatten(),
    );
  }
  const force = parsed.data.force === true;
  const reason = parsed.data.reason ?? "";

  const admin = createAdminSupabase();
  const orderId = ctx.params.id;

  const { row: order, error: loadErr } = await loadOrder(admin, orderId);
  if (loadErr) return fail("ORDER_QUERY_FAILED", loadErr, 500);
  if (!order) return fail("NOT_FOUND", "주문을 찾을 수 없습니다.", 404);

  // 1) 주문 판정
  const gate = evaluateRefundOrderGate({
    status: order.status,
    hasPaymentKey: !!order.toss_payment_key,
  });
  if (gate.kind === "already_refunded") {
    return fail("ALREADY_REFUNDED", "이미 환불된 주문입니다.", 409);
  }
  if (gate.kind === "blocked") {
    return fail(gate.code, gate.message, gate.httpStatus);
  }
  const forceBlock = checkForceAndReason({
    requiresForce: gate.requiresForce,
    force,
    reason,
  });
  if (forceBlock) {
    return fail(forceBlock.code, forceBlock.message, forceBlock.httpStatus, {
      status: order.status,
    });
  }
  const paymentKey = order.toss_payment_key as string;

  const audit = (action: string, details: Record<string, unknown>) =>
    logAdminAction({
      actor: { id: user.id, email: user.email },
      action,
      targetType: "order",
      targetId: orderId,
      details: {
        from: order.status,
        amount: order.amount,
        ...(gate.requiresForce ? { force: true } : {}),
        ...(reason ? { reason } : {}),
        ...details,
      },
      request: req,
    });

  // 2) 토스 사전 조회 — 실패하면 아무것도 바꾸지 않는다. 조회 실패·결제 불일치 차단도 감사에 남긴다
  //    (식별자·금액 불일치는 보안·정산 신호).
  let prefetched: TossPayment;
  try {
    prefetched = await getTossPayment(paymentKey);
  } catch (e) {
    const te = toTossError(e);
    await audit("order.refund_failed", {
      stage: "toss_precheck",
      code: te.code,
      message: te.message,
    });
    return fail(te.code, `토스 결제 조회 실패: ${te.message}`, te.status);
  }
  const tossGate = evaluateTossPaymentForRefund(
    { amount: order.amount, tossOrderId: order.toss_order_id },
    prefetched,
  );
  if (tossGate.kind === "blocked") {
    await audit("order.refund_failed", {
      stage: "toss_precheck",
      code: tossGate.code,
      tossStatus: prefetched.status,
      tossTotalAmount: prefetched.totalAmount,
    });
    return fail(tossGate.code, tossGate.message, tossGate.httpStatus, {
      tossStatus: prefetched.status,
    });
  }

  // 3) 토스 전액 취소 (또는 이미 취소 수렴)
  let outcome: TossFullCancelOutcome;
  let payment: TossPayment;
  if (tossGate.kind === "already_canceled") {
    outcome = "already_canceled";
    payment = prefetched;
  } else {
    try {
      const res = await cancelTossPaymentFully({
        paymentKey,
        cancelReason: buildCancelReason(reason),
        idempotencyKey: refundIdempotencyKey(order.id),
      });
      outcome = res.outcome;
      payment = res.payment;
    } catch (e) {
      const te = toTossError(e);
      await audit("order.refund_failed", {
        stage: "toss_cancel",
        code: te.code,
        message: te.message,
      });
      if (te.code === "IDEMPOTENT_REQUEST_PROCESSING") {
        return fail(
          "REFUND_IN_PROGRESS",
          "같은 주문의 환불 요청이 이미 처리 중입니다. 잠시 후 새로고침해 결과를 확인하세요.",
          409,
        );
      }
      // TOSS_* = 우리 쪽에서 만든 코드(타임아웃·네트워크·재조회 불일치 등) → 결과 미확정, 재시도 안전.
      // 그 외 = 토스가 돌려준 에러 → 같은 멱등 키 재요청은 15일간 같은 에러를 재생한다.
      const hint = te.code.startsWith("TOSS_")
        ? " 결과가 확정되지 않았을 수 있습니다 — 다시 시도해도 이중 취소되지 않습니다."
        : " 같은 주문의 재요청은 토스가 첫 응답을 그대로 돌려주므로, 원인을 토스 콘솔에서 확인하세요.";
      return fail(te.code, `토스 결제 취소 실패: ${te.message}${hint}`, te.status);
    }
  }

  // 4) 조건부 클레임 — refundable 상태일 때만 refunded 로. 동시 요청·웹훅 중 1명만 승자.
  const { data: claimed, error: updErr } = await admin
    .from("orders")
    .update({ status: "refunded" })
    .eq("id", order.id)
    .in("status", REFUNDABLE_FROM_STATUSES)
    .select("id, status")
    .maybeSingle();
  if (updErr) {
    await audit("order.refund_failed", {
      stage: "order_update",
      tossOutcome: outcome,
      message: updErr.message,
    });
    return fail(
      "ORDER_UPDATE_FAILED",
      "토스 결제는 취소됐지만 주문 상태 반영에 실패했습니다. 다시 시도하면 상태만 반영됩니다.",
      500,
    );
  }

  let alreadyRefunded = false;
  let creditRestoreError: string | null = null;
  let creditsRestored: { pointsRestored: number; discountUsesRestored: number } | null = null;
  if (claimed) {
    // 클레임 승자만 1회 — 사용 포인트·할인 복원 (refunded 전이 **뒤** 호출 — P1 계약).
    // restoreOrderCredits 는 실패를 throw 하지 않고 ok=false 로 돌려준다. 이 시점엔 결제 취소·refunded
    // 전이가 이미 끝났으므로 500 으로 뒤집지 않고 경고·감사로 남긴다(재요청은 ALREADY_REFUNDED →
    // 수동 보정 필요). 방어적으로 throw 도 같은 경고로 처리한다.
    try {
      const restored = await restoreOrderCredits(admin, {
        id: order.id,
        user_id: order.user_id,
        points_used: order.points_used,
        discount_code_id: order.discount_code_id,
      });
      if (restored.ok) {
        creditsRestored = {
          pointsRestored: restored.pointsRestored,
          discountUsesRestored: restored.discountUsesRestored,
        };
      } else {
        creditRestoreError = `${restored.code}${restored.message ? `: ${restored.message}` : ""}`;
        console.warn("[admin/refund] restoreOrderCredits not ok:", order.id, creditRestoreError);
      }
    } catch (e) {
      creditRestoreError = e instanceof Error ? e.message : String(e);
      console.warn("[admin/refund] restoreOrderCredits failed:", creditRestoreError);
    }
  } else {
    const { data: current } = await admin
      .from("orders")
      .select("id, status")
      .eq("id", order.id)
      .maybeSingle();
    const currentStatus = (current as { status?: OrderStatus } | null)?.status;
    if (currentStatus !== "refunded") {
      await audit("order.refund_failed", {
        stage: "order_claim",
        tossOutcome: outcome,
        currentStatus: currentStatus ?? null,
      });
      return fail(
        "ORDER_STATE_CONFLICT",
        `토스 결제는 취소됐지만 주문 상태(${currentStatus ?? "알 수 없음"})를 환불로 바꾸지 못했습니다. 주문을 확인하세요.`,
        409,
      );
    }
    // 다른 요청 또는 웹훅이 먼저 전이 + 복원까지 끝냈다.
    alreadyRefunded = true;
  }

  // 5) 감사 로그
  await audit("order.refund", {
    to: "refunded",
    method: payment.method ?? null,
    tossStatus: payment.status,
    tossOutcome: outcome,
    claimed: !!claimed,
    ...(claimed
      ? creditRestoreError
        ? { creditRestoreFailed: true, creditRestoreError }
        : {
            pointsRestored: creditsRestored?.pointsRestored ?? 0,
            discountRestored: (creditsRestored?.discountUsesRestored ?? 0) > 0,
          }
      : {}),
  });

  if (claimed) {
    await enqueueOrderRefundedEmail(admin, order, enqueueEmail);
  }

  return ok({
    item: { id: order.id, status: "refunded" as OrderStatus },
    toss: tossSummary(payment),
    tossOutcome: outcome,
    claimed: !!claimed,
    alreadyRefunded,
    creditRestoreError,
  });
});

function toTossError(e: unknown): TossError {
  if (e instanceof TossError) return e;
  return new TossError({
    code: "TOSS_UNKNOWN_ERROR",
    message: e instanceof Error ? e.message : "토스 호출 실패",
    status: 502,
  });
}


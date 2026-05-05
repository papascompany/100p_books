import "server-only";

import { z } from "zod";

import { fail, failFromError, ok } from "@/app/api/_lib/response";
import { requireUser } from "@/lib/auth/session";
import { createAdminSupabase } from "@/lib/db/admin";
import { createServerSupabase } from "@/lib/db/server";
import { assertTransition } from "@/lib/orders/state";
import { confirmTossPayment, TossError } from "@/lib/payments/toss";
import { enqueueAndRunPdfJob } from "@/lib/pdf/job-runner";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// 결제 확정 → PDF 빌드 인라인 처리. 큰 책(100p)은 60s 초과 가능 → 300s.
export const maxDuration = 300;

const BodySchema = z.object({
  orderId: z.string().uuid(),
  paymentKey: z.string().min(1),
  amount: z.number().int().positive(),
  tossOrderId: z.string().min(1),
});

/**
 * POST /api/payments/confirm
 *
 *   body: { orderId, paymentKey, amount, tossOrderId }
 *
 *   1. requireUser + orders 소유권 + status === "pending" + 자체 amount 일치.
 *   2. 토스 confirm API 호출 (Authorization Basic).
 *   3. 토스 응답 amount 도 검증 → orders UPDATE: status='paid', toss_payment_key, paid_at=now().
 *   4. PDF 빌드 잡 (인라인) — `pdfs/${userId}/${orderId}/cover.pdf`, `interior.pdf`.
 *      성공 시 orders UPDATE: cover_pdf_key, interior_pdf_key.
 *      실패 시 status='paid' 유지하고 에러를 응답에 별도 표기 (재시도는 사용자/관리자가).
 *   5. 응답: { orderId, status, redirectUrl }.
 *
 * 멱등성:
 *   - 동일 paymentKey 로 재호출 시 이미 paid 라면 기존 응답을 그대로 반환 (성공으로 간주).
 *   - 토스 confirm 은 동일 (paymentKey, orderId, amount) 조합에 대해 idempotent.
 */
export async function POST(req: Request) {
  try {
    const user = await requireUser();

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
    const { orderId, paymentKey, amount, tossOrderId } = parsed.data;

    const supabase = createServerSupabase();
    const admin = createAdminSupabase();

    // 1) 소유권 + 상태 + amount 검증
    const { data: order, error: orderErr } = await supabase
      .from("orders")
      .select(
        "id, project_id, user_id, qty, amount, address, status, toss_payment_key, toss_order_id, cover_pdf_key, interior_pdf_key, paid_at, created_at, updated_at",
      )
      .eq("id", orderId)
      .maybeSingle();
    if (orderErr) return fail("ORDER_QUERY_FAILED", orderErr.message, 500);
    if (!order) return fail("NOT_FOUND", "주문을 찾을 수 없습니다.", 404);
    if (order.user_id !== user.id) {
      return fail("FORBIDDEN", "해당 주문에 대한 권한이 없습니다.", 403);
    }

    // 멱등 — 이미 결제된 주문 + 동일 paymentKey 면 정상 응답
    if (order.status !== "pending") {
      if (
        order.toss_payment_key === paymentKey &&
        order.amount === amount &&
        (order.status === "paid" ||
          order.status === "in_production" ||
          order.status === "shipped" ||
          order.status === "delivered")
      ) {
        return ok({
          orderId: order.id,
          status: order.status,
          redirectUrl: `/order/${order.id}/success`,
          idempotent: true,
        });
      }
      return fail(
        "ORDER_NOT_PENDING",
        `이미 처리된 주문입니다 (현재 상태: ${order.status}).`,
        409,
      );
    }

    if (order.toss_order_id !== tossOrderId) {
      return fail(
        "TOSS_ORDER_ID_MISMATCH",
        "주문 식별자가 일치하지 않습니다.",
        400,
      );
    }
    if (order.amount !== amount) {
      return fail(
        "AMOUNT_MISMATCH",
        "결제 금액이 일치하지 않습니다.",
        400,
        { expected: order.amount, received: amount },
      );
    }

    // 2) 토스 결제 승인
    let tossRes;
    try {
      tossRes = await confirmTossPayment({
        paymentKey,
        orderId: tossOrderId,
        amount,
      });
    } catch (e) {
      if (e instanceof TossError) {
        return fail("PAYMENT_VERIFY_FAILED", e.message, e.status, {
          tossCode: e.code,
        });
      }
      throw e;
    }

    // 3) 토스 응답 amount 추가 검증
    if (tossRes.totalAmount !== amount) {
      return fail(
        "AMOUNT_MISMATCH",
        "토스 응답의 결제 금액이 일치하지 않습니다.",
        400,
        { expected: amount, toss: tossRes.totalAmount },
      );
    }
    // 정상 승인 상태 — DONE 만 허용
    if (tossRes.status !== "DONE") {
      return fail(
        "PAYMENT_NOT_DONE",
        `토스 결제 상태가 정상이 아닙니다: ${tossRes.status}`,
        400,
      );
    }

    // 4) orders UPDATE — pending → paid (상태 머신 점검)
    assertTransition("pending", "paid");
    const { error: upErr } = await admin
      .from("orders")
      .update({
        status: "paid",
        toss_payment_key: paymentKey,
        paid_at: new Date().toISOString(),
      })
      .eq("id", order.id);
    if (upErr) {
      return fail("ORDER_UPDATE_FAILED", upErr.message, 500);
    }

    // projects.status = 'ordered' 로 마킹 (선택 — 사용자 마이페이지 표시용).
    await admin
      .from("projects")
      .update({ status: "ordered" })
      .eq("id", order.project_id);

    // 5) PDF 빌드 잡 — 영속 큐(pdf_build_jobs) 에 등록 후 즉시 실행.
    //    실패해도 결제는 살려둠. 잡 행이 남아있어 관리자가 재시도 가능.
    const buildResult = await enqueueAndRunPdfJob(
      {
        orderId: order.id,
        projectId: order.project_id,
        userId: order.user_id,
        target: "all",
      },
      {
        signUrls: false,
        uploadPath: (key) => `${order.user_id}/${order.id}/${key}`,
        meta: { author: "100p_books" },
        onSuccess: async ({ coverKey, interiorKey }) => {
          if (!coverKey && !interiorKey) return;
          const patch: Record<string, unknown> = {};
          if (coverKey) patch.cover_pdf_key = coverKey;
          if (interiorKey) patch.interior_pdf_key = interiorKey;
          await admin.from("orders").update(patch).eq("id", order.id);
        },
      },
    );

    if (!buildResult.ok) {
      console.error(
        "[payments/confirm] PDF build failed for order",
        order.id,
        buildResult.error,
      );
    }

    return ok({
      orderId: order.id,
      status: "paid" as const,
      redirectUrl: `/order/${order.id}/success`,
      pdfError: buildResult.ok ? null : buildResult.error ?? "PDF 빌드 실패",
      pdfJobId: buildResult.jobId || null,
    });
  } catch (err) {
    return failFromError(err);
  }
}

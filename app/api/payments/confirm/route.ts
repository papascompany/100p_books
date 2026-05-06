import "server-only";

import { z } from "zod";

import { fail, failFromError, ok } from "@/app/api/_lib/response";
import { requireUser } from "@/lib/auth/session";
import { createAdminSupabase } from "@/lib/db/admin";
import { createServerSupabase } from "@/lib/db/server";
import { enqueueEmail } from "@/lib/email/queue";
import { assertTransition } from "@/lib/orders/state";
import { confirmTossPayment, TossError } from "@/lib/payments/toss";
import { enqueueAndRunPdfJob } from "@/lib/pdf/job-runner";
import { REFERRAL_REWARD } from "@/lib/referrals/code";

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
        "id, project_id, user_id, qty, amount, address, status, toss_payment_key, toss_order_id, cover_pdf_key, interior_pdf_key, paid_at, discount_code_id, discount_amount, points_used, created_at, updated_at",
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

    // 4) 포인트 차감 (atomic) — order.points_used > 0 인 경우에만.
    //    Toss 결제는 이미 성공했으므로 차감 실패 시에도 결제는 살린다 (관리자 보정).
    if (order.points_used && order.points_used > 0) {
      const { data: newBalance, error: dedErr } = await admin.rpc(
        "deduct_user_points",
        { p_user_id: order.user_id, p_amount: order.points_used },
      );
      if (dedErr) {
        console.warn(
          "[payments/confirm] deduct_user_points 호출 실패:",
          dedErr.message,
        );
      } else if (typeof newBalance === "number" && newBalance < 0) {
        // 잔액 부족이지만 결제는 이미 성공 — 0 으로 표시(충전 0원) + 경고
        console.warn(
          "[payments/confirm] 포인트 잔액 부족이나 결제는 진행됨",
          { orderId: order.id, requested: order.points_used },
        );
      }
    }

    // 5) orders UPDATE — pending → paid (상태 머신 점검)
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

    // 5-1) 친구 추천 보상 (M16-4) — 이번 결제가 본 사용자의 첫 결제(paid+)인 경우에만.
    //   현재 주문(order.id) 외에 status != 'pending' 이고 paid_at IS NOT NULL 인 다른 주문이 없으면 첫 결제.
    //   referrals 에 referee_id = user 인 pending 행이 있으면 award_referral_reward RPC 로 atomic 처리.
    //   실패해도 결제는 살림.
    try {
      const { count: priorPaidCount, error: cntErr } = await admin
        .from("orders")
        .select("id", { count: "exact", head: true })
        .eq("user_id", order.user_id)
        .neq("status", "pending")
        .neq("id", order.id)
        .not("paid_at", "is", null);

      if (cntErr) {
        console.warn(
          "[payments/confirm] 첫 결제 카운트 실패:",
          cntErr.message,
        );
      } else if ((priorPaidCount ?? 0) === 0) {
        // 첫 결제 — referrals.pending 이 있으면 보상 지급.
        const { data: referrerId, error: rwdErr } = await admin.rpc(
          "award_referral_reward",
          { p_referee_id: order.user_id, p_reward: REFERRAL_REWARD },
        );
        if (rwdErr) {
          console.warn(
            "[payments/confirm] award_referral_reward 실패:",
            rwdErr.message,
          );
        } else if (referrerId) {
          console.info(
            `[payments/confirm] 추천 보상 +${REFERRAL_REWARD}P 지급`,
            { referrerId, refereeId: order.user_id, orderId: order.id },
          );
        }
      }
    } catch (e) {
      console.warn(
        "[payments/confirm] 추천 보상 처리 예외:",
        e instanceof Error ? e.message : String(e),
      );
    }

    // 4-1) 할인 코드 사용 마킹 — 결제 성공 후에만 기록.
    //   - discount_uses INSERT (UNIQUE(code_id, user_id) 로 중복 방지 — 멱등 호출 안전)
    //   - discount_codes.used_count += 1
    //   실패해도 결제는 살림 (관리자 보정 가능). console.warn 로 추적.
    if (order.discount_code_id) {
      const { error: useErr } = await admin.from("discount_uses").insert({
        code_id: order.discount_code_id,
        user_id: order.user_id,
        order_id: order.id,
      });
      if (useErr && (useErr as { code?: string }).code !== "23505") {
        console.warn(
          "[payments/confirm] discount_uses insert failed:",
          useErr.message,
        );
      } else if (!useErr) {
        // 신규 사용 기록 — used_count 증가
        const { data: dc, error: rdErr } = await admin
          .from("discount_codes")
          .select("used_count")
          .eq("id", order.discount_code_id)
          .maybeSingle();
        if (!rdErr && dc) {
          const { error: incErr } = await admin
            .from("discount_codes")
            .update({ used_count: (dc.used_count ?? 0) + 1 })
            .eq("id", order.discount_code_id);
          if (incErr) {
            console.warn(
              "[payments/confirm] discount used_count update failed:",
              incErr.message,
            );
          }
        }
      }
    }

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

    // 6) order.paid 이메일 enqueue — 실패해도 confirm 응답은 그대로 성공.
    try {
      const [{ data: profile }, { data: project }, { count: pageCount }] =
        await Promise.all([
          admin
            .from("profiles")
            .select("email, display_name")
            .eq("id", order.user_id)
            .maybeSingle(),
          admin
            .from("projects")
            .select("title, book_size_id")
            .eq("id", order.project_id)
            .maybeSingle(),
          admin
            .from("pages")
            .select("id", { count: "exact", head: true })
            .eq("project_id", order.project_id),
        ]);

      const { data: bookSize } = project?.book_size_id
        ? await admin
            .from("book_sizes")
            .select("name")
            .eq("id", project.book_size_id)
            .maybeSingle()
        : { data: null };

      const recipientEmail = profile?.email ?? user.email ?? "";
      const addr = (order.address ?? {}) as { name?: string };
      const customerName =
        addr?.name ??
        profile?.display_name ??
        (recipientEmail ? recipientEmail.split("@")[0]! : "고객");

      if (recipientEmail) {
        await enqueueEmail({
          template: "order.paid",
          to: { email: recipientEmail, name: customerName },
          context: {
            kind: "order",
            orderId: order.id,
            tossOrderId: tossOrderId,
            customerName,
            bookSizeName: bookSize?.name ?? "포토북",
            pageCount: pageCount ?? 0,
            qty: order.qty,
            amount: order.amount,
          },
          relatedType: "order",
          relatedId: order.id,
        });
      }
    } catch (e) {
      console.warn(
        "[payments/confirm] enqueue order.paid email failed:",
        e instanceof Error ? e.message : String(e),
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

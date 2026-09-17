import "server-only";

import { z } from "zod";

import { fail, ok } from "@/app/api/_lib/response";
import { withAdmin } from "@/lib/admin/auth";
import { logAdminAction } from "@/lib/admin/audit";
import { createAdminSupabase } from "@/lib/db/admin";
import type { OrderStatus } from "@/lib/db/types";
import { enqueueEmail } from "@/lib/email/queue";
import { restoreOrderCredits } from "@/lib/orders/refund";
import { TEMPLATE_BY_ORDER_STATUS } from "@/lib/email/templates";
import {
  ALL_ORDER_STATUSES,
  assertTransition,
  InvalidStateTransitionError,
} from "@/lib/orders/state";
import {
  formatValidationBlocks,
  getValidationBlocks,
} from "@/lib/orders/validation-gate";
import type { StorigeValidationCache } from "@/lib/db/types";

import { checkAdminPendingCancel } from "./pending-cancel";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z.object({
  to: z.enum(ALL_ORDER_STATUSES as [string, ...string[]]),
  trackingNo: z.string().trim().max(60).optional(),
  trackingCarrier: z.string().trim().max(40).optional(),
  /** 인쇄 검증(FIXABLE/FAILED) 보류를 관리자가 확인 후 강제 진행. */
  force: z.boolean().optional(),
});

/**
 * POST /api/admin/orders/:id/transition
 *
 *   body: { to: OrderStatus, trackingNo?, trackingCarrier? }
 *
 *   - assertTransition 으로 상태 머신 검증.
 *   - in_production → shipped 시 trackingNo + trackingCarrier 필수, shipped_at 타임스탬프.
 *   - shipped → delivered 시 delivered_at 타임스탬프.
 *   - paid → in_production 으로 갈 때 별도 메타 없음.
 *   - pending → cancelled 는 토스 확인 뒤에만(./pending-cancel.ts) — 캡처됐거나 승인 진행 중인
 *     결제가 있으면 409, 조회 실패면 503. 조건부 UPDATE 는 확인한 결제 키가 그대로일 때만 전이한다.
 *   - cancelled·refunded 전이 클레임 승자는 restoreOrderCredits — pending 도 캡처 전에 크레딧을
 *     선점하므로(0033) 결제 대기 주문 취소에서도 잡힌 포인트·할인을 돌려준다(잡힌 것만, 멱등).
 */
export const POST = withAdmin<{ id: string }>(async (req, ctx, user) => {
  const raw = (await req.json().catch(() => ({}))) as unknown;
  const parsed = BodySchema.safeParse(raw);
  if (!parsed.success) {
    return fail(
      "INVALID_BODY",
      "요청 본문이 올바르지 않습니다.",
      400,
      parsed.error.flatten(),
    );
  }
  const { to, trackingNo, trackingCarrier, force } = parsed.data;

  const admin = createAdminSupabase();

  const { data: row, error: getErr } = await admin
    .from("orders")
    .select(
      "id, status, user_id, amount, points_used, discount_code_id, storige_validation, toss_payment_key, toss_order_id",
    )
    .eq("id", ctx.params.id)
    .maybeSingle();
  if (getErr) return fail("ORDER_QUERY_FAILED", getErr.message, 500);
  if (!row) return fail("NOT_FOUND", "주문을 찾을 수 없습니다.", 404);

  const from = row.status as OrderStatus;
  const target = to as OrderStatus;

  try {
    assertTransition(from, target);
  } catch (e) {
    if (e instanceof InvalidStateTransitionError) {
      return fail(e.code, e.message, e.status);
    }
    throw e;
  }

  // 발주 게이트 (2-D Option ②) — 인쇄 검증이 FIXABLE/FAILED 면 in_production
  // 진입을 보류한다. best-effort 특성상 ERROR/PROCESSING/SKIPPED/미검증은 비차단.
  // 관리자가 force 로 오버라이드하면 진행하되 감사 로그에 남긴다(아래 details).
  // 알려진 한계(적대검증 2026-07-14, low): 이 SELECT 판정과 아래 조건부 UPDATE
  // 사이 ms 창에서 빌드 잡이 검증 캐시를 갱신하면 게이트를 비켜갈 수 있다.
  // 자문적 게이트(force 오버라이드 허용) + 관리자 전용 액터라 감수 — jsonb
  // 재가드로 닫으려면 UPDATE 조건 복잡도가 이득을 넘는다.
  const validationBlocks =
    target === "in_production"
      ? getValidationBlocks(
          row.storige_validation as StorigeValidationCache | null,
        )
      : [];
  if (validationBlocks.length > 0 && !force) {
    return fail(
      "VALIDATION_BLOCKED",
      `인쇄 검증 미통과 — ${formatValidationBlocks(validationBlocks)}. ` +
        "PDF 재생성으로 해소하거나, 확인 후 강제 발주(force)로 진행하세요.",
      409,
      { blocks: validationBlocks },
    );
  }

  // 결제 대기 주문 취소 — 토스에 캡처·진행 중인 결제가 없을 때만.
  const cancellingPending = from === "pending" && target === "cancelled";
  if (cancellingPending) {
    const verdict = await checkAdminPendingCancel({
      toss_payment_key: row.toss_payment_key,
      toss_order_id: row.toss_order_id,
      amount: row.amount,
    });
    if (verdict.kind === "block") {
      if (verdict.status === 409) {
        console.error("[admin/transition] 결제 기록이 있는 pending 주문 취소 거부", {
          orderId: row.id,
          code: verdict.code,
          tossStatus: verdict.tossStatus ?? null,
        });
      }
      return fail(verdict.code, verdict.message, verdict.status, {
        ...(verdict.tossStatus ? { tossStatus: verdict.tossStatus } : {}),
      });
    }
  }

  // shipped 전이 시 tracking 정보 필수
  const update: Record<string, unknown> = { status: target };
  const now = new Date().toISOString();
  if (target === "shipped") {
    if (!trackingNo || !trackingCarrier) {
      return fail(
        "MISSING_TRACKING",
        "송장번호와 배송사를 입력하세요.",
        400,
      );
    }
    update.tracking_no = trackingNo;
    update.tracking_carrier = trackingCarrier;
    update.shipped_at = now;
  }
  if (target === "delivered") {
    update.delivered_at = now;
  }

  // 조건부 클레임 — status=from 일 때만 전이. 동시 중복(더블클릭 등) 시 한 번만 승자가
  // 되어 환불 복원 등 side-effect 가 1회만 실행되게 한다.
  // 결제 대기 취소는 확인한 결제 키가 그대로일 때만 — 확인 뒤 다른 결제가 바인딩되면 빗나가 409.
  const claim = admin.from("orders").update(update).eq("id", ctx.params.id).eq("status", from);
  const guardedClaim = !cancellingPending
    ? claim
    : row.toss_payment_key === null
      ? claim.is("toss_payment_key", null)
      : claim.eq("toss_payment_key", row.toss_payment_key);
  const { data: updated, error: updErr } = await guardedClaim
    .select(
      "id, status, tracking_no, tracking_carrier, shipped_at, delivered_at",
    )
    .maybeSingle();
  if (updErr) {
    return fail("ORDER_UPDATE_FAILED", updErr.message, 500);
  }
  if (!updated) {
    return fail("ORDER_NOT_IN_EXPECTED_STATE", "주문 상태가 이미 변경되었습니다.", 409);
  }

  // 환불·취소 전이 시 사용 포인트 + 할인 복원 (클레임 승자만 1회). refunded·cancelled 는 종착 상태라
  // 재진입 불가 + 위 조건부 UPDATE 로 이중 복원 방지. 전이 **뒤** 호출해야 복원된다(refund 모드).
  let creditRestore: { ok: boolean; code?: string } | null = null;
  if (target === "refunded" || target === "cancelled") {
    const restored = await restoreOrderCredits(admin, {
      id: row.id,
      user_id: row.user_id,
      points_used: row.points_used,
      discount_code_id: row.discount_code_id,
    });
    creditRestore = restored.ok ? { ok: true } : { ok: false, code: restored.code };
  }

  // 감사 로그 — 상태 전이 + tracking 메타
  await logAdminAction({
    actor: { id: user.id, email: user.email },
    action: "order.transition",
    targetType: "order",
    targetId: ctx.params.id,
    details: {
      from,
      to: target,
      ...(target === "shipped"
        ? { trackingNo, trackingCarrier }
        : {}),
      // 검증 보류를 강제 통과한 발주는 사유와 함께 감사 추적.
      ...(validationBlocks.length > 0
        ? { validationOverride: true, validationBlocks }
        : {}),
      ...(creditRestore ? { creditRestore } : {}),
    },
    request: req,
  });

  // 알림 이메일 enqueue — 실패해도 전이 응답은 성공 유지.
  try {
    const template = TEMPLATE_BY_ORDER_STATUS[target];
    if (template) {
      // 주문/사용자/프로젝트/사이즈 정보 일괄 조회
      const { data: orderRow } = await admin
        .from("orders")
        .select("id, user_id, qty, amount, address, project_id, toss_order_id")
        .eq("id", ctx.params.id)
        .maybeSingle();

      if (orderRow) {
        const [{ data: profile }, { data: project }, { count: pageCount }] =
          await Promise.all([
            admin
              .from("profiles")
              .select("email, display_name")
              .eq("id", orderRow.user_id)
              .maybeSingle(),
            admin
              .from("projects")
              .select("title, book_size_id")
              .eq("id", orderRow.project_id)
              .maybeSingle(),
            admin
              .from("pages")
              .select("id", { count: "exact", head: true })
              .eq("project_id", orderRow.project_id),
          ]);

        const { data: bookSize } = project?.book_size_id
          ? await admin
              .from("book_sizes")
              .select("name")
              .eq("id", project.book_size_id)
              .maybeSingle()
          : { data: null };

        const recipientEmail = profile?.email ?? "";
        const addr = (orderRow.address ?? {}) as { name?: string };
        const customerName =
          addr?.name ??
          profile?.display_name ??
          (recipientEmail ? recipientEmail.split("@")[0]! : "고객");

        if (recipientEmail) {
          await enqueueEmail({
            template,
            to: { email: recipientEmail, name: customerName },
            context: {
              kind: "order",
              orderId: orderRow.id,
              tossOrderId: orderRow.toss_order_id ?? undefined,
              customerName,
              bookSizeName: bookSize?.name ?? "포토북",
              pageCount: pageCount ?? 0,
              qty: orderRow.qty,
              amount: orderRow.amount,
              ...(target === "shipped"
                ? {
                    trackingNo,
                    trackingCarrier,
                    shippedAt: now,
                  }
                : {}),
            },
            relatedType: "order",
            relatedId: orderRow.id,
          });
        }
      }
    }
  } catch (e) {
    console.warn(
      "[admin/transition] enqueue email failed:",
      e instanceof Error ? e.message : String(e),
    );
  }

  return ok({ item: updated });
});

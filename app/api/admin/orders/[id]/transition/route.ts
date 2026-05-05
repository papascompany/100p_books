import "server-only";

import { z } from "zod";

import { fail, ok } from "@/app/api/_lib/response";
import { withAdmin } from "@/lib/admin/auth";
import { logAdminAction } from "@/lib/admin/audit";
import { createAdminSupabase } from "@/lib/db/admin";
import type { OrderStatus } from "@/lib/db/types";
import {
  ALL_ORDER_STATUSES,
  assertTransition,
  InvalidStateTransitionError,
} from "@/lib/orders/state";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z.object({
  to: z.enum(ALL_ORDER_STATUSES as [string, ...string[]]),
  trackingNo: z.string().trim().max(60).optional(),
  trackingCarrier: z.string().trim().max(40).optional(),
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
  const { to, trackingNo, trackingCarrier } = parsed.data;

  const admin = createAdminSupabase();

  const { data: row, error: getErr } = await admin
    .from("orders")
    .select("id, status")
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

  const { data: updated, error: updErr } = await admin
    .from("orders")
    .update(update)
    .eq("id", ctx.params.id)
    .select(
      "id, status, tracking_no, tracking_carrier, shipped_at, delivered_at",
    )
    .single();
  if (updErr || !updated) {
    return fail("ORDER_UPDATE_FAILED", updErr?.message ?? "갱신 실패", 500);
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
    },
    request: req,
  });

  return ok({ item: updated });
});

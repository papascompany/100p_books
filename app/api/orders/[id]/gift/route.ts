import "server-only";

import { z } from "zod";

import { fail, failFromError, ok } from "@/app/api/_lib/response";
import { requireUser } from "@/lib/auth/session";
import { createAdminSupabase } from "@/lib/db/admin";
import { createServerSupabase } from "@/lib/db/server";
import { enqueueEmail } from "@/lib/email/queue";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteCtx = { params: { id: string } };

const ParamsSchema = z.object({ id: z.string().uuid() });

const BodySchema = z.object({
  recipientEmail: z
    .string()
    .trim()
    .min(3)
    .max(254)
    .email("이메일 형식이 올바르지 않습니다."),
  message: z.string().trim().max(500).optional(),
});

/** 이메일 prefix — 표시명이 없을 때 fallback. */
function emailPrefix(email: string): string {
  const i = email.indexOf("@");
  return i > 0 ? email.slice(0, i) : email;
}

/**
 * POST /api/orders/[id]/gift
 *   body: { recipientEmail, message? }
 *
 *   주문 소유자가 이미 결제 완료된 주문을 다른 사용자에게 선물하는 토큰을 발급한다.
 *
 *   응답:
 *     {
 *       giftId, giftToken, shareUrl, expiresAt
 *     }
 *
 * 흐름:
 *   1. requireUser
 *   2. 주문 로드 (소유권 + status in ['paid','in_production','shipped','delivered'])
 *   3. project + book_size + page count 조회 (이메일 컨텍스트용)
 *   4. gifts INSERT (admin) — sender_id, recipient_email, message, gift_token
 *   5. enqueueEmail("gift.received") — 수신자에게 알림
 */
export async function POST(req: Request, { params }: RouteCtx) {
  try {
    const user = await requireUser();

    const paramsParse = ParamsSchema.safeParse(params);
    if (!paramsParse.success) {
      return fail("INVALID_PARAMS", "주문 id 형식이 올바르지 않습니다.", 400);
    }
    const orderId = paramsParse.data.id;

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
    const { recipientEmail, message } = parsed.data;

    const supabase = createServerSupabase();

    // 1) 주문 로드 (RLS: orders_select_own — 본인 주문만 SELECT 가능)
    const { data: order, error: orderErr } = await supabase
      .from("orders")
      .select("id, user_id, project_id, status")
      .eq("id", orderId)
      .maybeSingle();
    if (orderErr) return fail("ORDER_QUERY_FAILED", orderErr.message, 500);
    if (!order) return fail("NOT_FOUND", "주문을 찾을 수 없습니다.", 404);
    if (order.user_id !== user.id) {
      return fail("FORBIDDEN", "해당 주문에 대한 권한이 없습니다.", 403);
    }

    // 2) 결제 완료 이상만 선물 가능
    const giftableStatuses = new Set([
      "paid",
      "in_production",
      "shipped",
      "delivered",
    ]);
    if (!giftableStatuses.has(order.status)) {
      return fail(
        "ORDER_NOT_GIFTABLE",
        "결제 완료 이후의 주문만 선물할 수 있어요.",
        400,
      );
    }

    // 2-1) 동일 주문 중복 선물 방지 — 1회 결제로 다수에게 무료 복제되는 악용 차단.
    //   주문당 활성(pending/claimed) gift 가 이미 있으면 추가 발급을 거부한다.
    //   (만료/취소된 gift 는 재발급 허용.)
    const adminGiftCheck = createAdminSupabase();
    const { count: existingGiftCount, error: existingGiftErr } =
      await adminGiftCheck
        .from("gifts")
        .select("id", { count: "exact", head: true })
        .eq("order_id", orderId)
        .in("status", ["pending", "claimed"]);
    if (existingGiftErr) {
      return fail("GIFT_QUERY_FAILED", existingGiftErr.message, 500);
    }
    if ((existingGiftCount ?? 0) > 0) {
      return fail(
        "GIFT_ALREADY_EXISTS",
        "이 주문은 이미 선물로 발송되었어요. 주문 1건당 한 번만 선물할 수 있어요.",
        409,
      );
    }

    // 3) 이메일 컨텍스트 — project + book_size + page count
    const { data: project, error: projErr } = await supabase
      .from("projects")
      .select(
        "id, title, book_sizes:book_size_id ( name )",
      )
      .eq("id", order.project_id)
      .maybeSingle();
    if (projErr) return fail("PROJECT_QUERY_FAILED", projErr.message, 500);
    if (!project) return fail("NOT_FOUND", "프로젝트를 찾을 수 없습니다.", 404);

    const bookSizeName =
      (project.book_sizes as unknown as { name?: string } | null)?.name ?? "";

    const { count: pageCount, error: pagesErr } = await supabase
      .from("pages")
      .select("id", { count: "exact", head: true })
      .eq("project_id", order.project_id);
    if (pagesErr) return fail("PAGES_QUERY_FAILED", pagesErr.message, 500);

    // 4) 발신자 표시명 — profiles.display_name → email prefix
    const { data: senderProfile } = await supabase
      .from("profiles")
      .select("display_name, email")
      .eq("id", user.id)
      .maybeSingle();

    const senderName =
      senderProfile?.display_name ||
      (senderProfile?.email ? emailPrefix(senderProfile.email) : null) ||
      (user.email ? emailPrefix(user.email) : "보낸이");

    // 5) gifts INSERT (admin — RLS 우회로 expires_at 기본값 적용 등 일관 처리)
    const admin = adminGiftCheck;
    const { data: inserted, error: giftErr } = await admin
      .from("gifts")
      .insert({
        order_id: orderId,
        sender_id: user.id,
        recipient_email: recipientEmail,
        message: message ?? null,
      })
      .select("id, gift_token, expires_at")
      .single();
    if (giftErr || !inserted) {
      // 부분 유니크 인덱스(gifts_active_order_uniq) 위반 — 동시 발급 레이스에서
      // 이미 활성(pending/claimed) gift 가 존재. 위의 check-then-insert 를 DB 가 보강.
      if ((giftErr as { code?: string } | null)?.code === "23505") {
        return fail(
          "GIFT_ALREADY_EXISTS",
          "이미 이 주문으로 발송된 선물이 있습니다.",
          409,
        );
      }
      return fail(
        "GIFT_INSERT_FAILED",
        giftErr?.message ?? "선물 발송에 실패했습니다.",
        500,
      );
    }

    // 6) 수신자 알림 enqueue (실패해도 선물 자체는 정상 응답)
    const baseUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "");
    const shareUrl = baseUrl
      ? `${baseUrl}/gifts/${inserted.gift_token}`
      : `/gifts/${inserted.gift_token}`;

    await enqueueEmail({
      template: "gift.received",
      to: { email: recipientEmail },
      context: {
        kind: "gift",
        giftToken: inserted.gift_token,
        senderName,
        recipientName: emailPrefix(recipientEmail),
        bookSizeName,
        pageCount: pageCount ?? 0,
        message: message,
        projectTitle: project.title ?? undefined,
      },
      relatedType: "gift",
      relatedId: inserted.id,
    });

    return ok({
      giftId: inserted.id,
      giftToken: inserted.gift_token,
      shareUrl,
      expiresAt: inserted.expires_at,
    });
  } catch (err) {
    return failFromError(err);
  }
}

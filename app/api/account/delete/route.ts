import "server-only";

import { z } from "zod";

import { fail, failFromError, ok } from "@/app/api/_lib/response";
import { requireUser } from "@/lib/auth/session";
import { createAdminSupabase } from "@/lib/db/admin";
import { createServerSupabase } from "@/lib/db/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const BodySchema = z.object({
  /** 본인 이메일 재입력 — 정상 식별이 가능한 사용자만 탈퇴 가능 */
  confirmEmail: z.string().email().max(254),
  /** 탈퇴 사유 (선택) */
  reason: z.string().max(500).optional(),
});

/**
 * 탈퇴를 진행할 수 없는 진행 중 주문 상태.
 * - pending: 결제 진행 중일 수 있음
 * - paid / in_production / shipped: 미배송·인쇄 상태
 */
const BLOCKING_STATUSES = [
  "pending",
  "paid",
  "in_production",
  "shipped",
] as const;

/**
 * POST /api/account/delete
 *
 * body: { confirmEmail: string, reason?: string }
 *
 * 흐름:
 *   1. requireUser
 *   2. confirmEmail 일치 검증 (auth.user.email 기준)
 *   3. 진행 중 주문 존재 검사 → 거부
 *   4. service_role: anonymize_account RPC + auth.users.deleteUser
 *   5. 클라이언트는 응답 후 자체적으로 페이지 이동 + signOut 처리
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

    const { confirmEmail, reason } = parsed.data;

    // 2) 이메일 일치 — auth.user.email 우선, 없으면 profiles.email
    const supabase = createServerSupabase();
    const { data: profile, error: profErr } = await supabase
      .from("profiles")
      .select("id, email, deleted_at")
      .eq("id", user.id)
      .maybeSingle();
    if (profErr) return fail("PROFILE_QUERY_FAILED", profErr.message, 500);

    const ownEmail = (user.email ?? profile?.email ?? "").trim().toLowerCase();
    if (
      !ownEmail ||
      ownEmail !== confirmEmail.trim().toLowerCase()
    ) {
      return fail(
        "EMAIL_MISMATCH",
        "본인의 이메일과 일치하지 않습니다.",
        400,
      );
    }
    if (profile?.deleted_at) {
      return fail("ALREADY_DELETED", "이미 탈퇴된 계정입니다.", 410);
    }

    // 3) 진행 중 주문 검사
    const { count: blockingCount, error: orderErr } = await supabase
      .from("orders")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .in("status", BLOCKING_STATUSES as unknown as string[]);
    if (orderErr) return fail("ORDER_QUERY_FAILED", orderErr.message, 500);

    if ((blockingCount ?? 0) > 0) {
      return fail(
        "ORDERS_IN_PROGRESS",
        "처리 중인 주문이 있어 탈퇴할 수 없습니다. 결제 취소 또는 배송 완료 후 다시 시도해 주세요.",
        409,
        { blockingCount: blockingCount ?? 0 },
      );
    }

    // 4) 익명화 + auth 사용자 삭제 (service_role)
    const admin = createAdminSupabase();
    const { error: rpcErr } = await admin.rpc("anonymize_account", {
      p_user_id: user.id,
      p_reason: reason ?? null,
    });
    if (rpcErr) {
      return fail("ANONYMIZE_FAILED", rpcErr.message, 500);
    }

    const { error: delErr } = await admin.auth.admin.deleteUser(user.id);
    if (delErr) {
      // auth 삭제 실패해도 익명화는 이미 적용됨 — 로그인 차단 효과는 deleted_at 검사로 보장
      // (운영자가 후속 정리)
      return ok({
        ok: true,
        anonymized: true,
        authDeleted: false,
        warning: delErr.message,
      });
    }

    // 클라이언트는 응답 후 supabase.auth.signOut() + 홈 리다이렉트
    return ok({
      ok: true,
      anonymized: true,
      authDeleted: true,
    });
  } catch (err) {
    return failFromError(err);
  }
}

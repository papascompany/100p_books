import "server-only";

import { z } from "zod";

import { fail, failFromError, ok } from "@/app/api/_lib/response";
import { requireActiveUser } from "@/lib/auth/session";
import { createAdminSupabase } from "@/lib/db/admin";
import { createServerSupabase } from "@/lib/db/server";
import { enqueueEmail } from "@/lib/email/queue";
import { enforceRateLimit } from "@/lib/security/rate-limit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** 명시적 의도 확인용 — 정확히 이 문구만 통과. */
const CONFIRM_PHRASE = "회원 탈퇴";

const BodySchema = z.object({
  /** 본인 이메일 재입력 — 정상 식별이 가능한 사용자만 탈퇴 가능 */
  confirmEmail: z.string().email().max(254),
  /** 명시적 의도 확인 문구 — "회원 탈퇴" 정확히 입력해야 통과 */
  confirmText: z
    .string()
    .min(1, `'${CONFIRM_PHRASE}' 문구를 정확히 입력해 주세요.`)
    .max(20),
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
 * body: { confirmEmail: string, confirmText: "회원 탈퇴", reason?: string }
 *
 * 흐름:
 *   1. Rate limit — 시간당 5회 (잔존 세션 brute force 차단)
 *   2. requireActiveUser — deleted_at 가드 (재탈퇴 차단)
 *   3. confirmEmail + confirmText 이중 검증
 *   4. 진행 중 주문 존재 검사 → 거부
 *   5. service_role: anonymize_account RPC + auth.users.deleteUser
 *   6. 클라이언트는 응답 후 자체적으로 페이지 이동 + signOut 처리
 */
export async function POST(req: Request) {
  try {
    const user = await requireActiveUser();

    // 🛡 Rate limit — 시간당 5회 (잔존 세션 brute force 차단)
    const rl = await enforceRateLimit("account-delete", req, user.id);
    if (!rl.success) {
      return fail(
        "RATE_LIMITED",
        "탈퇴 요청이 너무 잦습니다. 잠시 후 다시 시도해 주세요.",
        429,
        { resetAt: rl.reset, limit: rl.limit },
      );
    }

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

    const { confirmEmail, confirmText, reason } = parsed.data;

    // 명시적 의도 — 정확한 문구 강제 (UI 클릭 실수 방지 + 자동화 봇 차단)
    if (confirmText.trim() !== CONFIRM_PHRASE) {
      return fail(
        "CONFIRM_TEXT_MISMATCH",
        `'${CONFIRM_PHRASE}' 문구를 정확히 입력해 주세요.`,
        400,
      );
    }

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

    // 4-pre) 탈퇴 메일 enqueue — anonymize 전에 실제 이메일/이름 캐치.
    //   anonymize 후 profiles.email 은 null, display_name 도 익명화됨.
    try {
      const realEmail = (user.email ?? profile?.email ?? "").trim();
      if (realEmail) {
        const { data: realProfile } = await admin
          .from("profiles")
          .select("display_name")
          .eq("id", user.id)
          .maybeSingle();
        const displayName =
          realProfile?.display_name ?? realEmail.split("@")[0]! ?? "고객";
        await enqueueEmail({
          template: "user.account_deleted",
          to: { email: realEmail, name: displayName },
          context: {
            kind: "user",
            email: realEmail,
            displayName,
          },
          relatedType: "user",
          relatedId: user.id,
        });
      }
    } catch (e) {
      console.warn(
        "[account/delete] enqueue user.account_deleted failed:",
        e instanceof Error ? e.message : String(e),
      );
    }

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

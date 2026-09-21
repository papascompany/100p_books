import "server-only";

import { z } from "zod";

import { fail, failFromError, ok } from "@/app/api/_lib/response";
import { purgeAccountContent } from "@/lib/auth/account-content-purge";
import { createAccountContentStore } from "@/lib/auth/account-content-store";
import {
  decideAccountDeletion,
  executeAccountDeletion,
  toAccountDeletionHttpResult,
} from "@/lib/auth/account-deletion";
import { requireUser } from "@/lib/auth/session";
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
 * 흐름 (결정·실행 로직은 lib/auth/account-deletion.ts):
 *   1. requireUser — getUser() 서버 검증. requireActiveUser 가 아닌 이유: 이전 시도에서
 *      익명화(deleted_at)까지 끝나고 auth 단계가 실패한 사용자가 재시도할 수 있어야 한다.
 *   2. Rate limit — 시간당 5회 (잔존 세션 brute force 차단)
 *   3. confirmEmail + confirmText 이중 검증
 *   4. 진행 중 주문 존재 검사 → 거부
 *   5. service_role: anonymize_account RPC → 개인 콘텐츠 정리(공유 링크 폐기·avatar/oauth 필드·
 *      미주문 프로젝트와 사진 삭제) → auth soft delete(deleteUser(id, true), 세션 전부 삭제)
 *      → 탈퇴 안내 메일(이미 큐에 있으면 생략). 정리·auth 단계 실패는 500
 *      (성공으로 응답하지 않음, 같은 요청 재시도로 완료).
 *   6. 응답에 전역 signOut(쿠키 제거)을 싣고, 클라이언트도 signOut 후 홈으로 이동
 */
export async function POST(req: Request) {
  try {
    const user = await requireUser();

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
    //    (재시도 시 profiles.email 은 이미 null 이지만 auth 쪽 email 은 soft delete 전까지 남아 있다)
    const supabase = await createServerSupabase();
    const { data: profile, error: profErr } = await supabase
      .from("profiles")
      .select("id, email, display_name, deleted_at")
      .eq("id", user.id)
      .maybeSingle();
    if (profErr) {
      console.error("[account/delete] profile query failed:", profErr.message);
      return fail("PROFILE_QUERY_FAILED", "회원 정보를 확인하지 못했습니다.", 500);
    }

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

    // 3) 진행 중 주문 검사
    const { count: blockingCount, error: orderErr } = await supabase
      .from("orders")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .in("status", BLOCKING_STATUSES as unknown as string[]);
    if (orderErr) {
      console.error("[account/delete] order query failed:", orderErr.message);
      return fail("ORDER_QUERY_FAILED", "주문 정보를 확인하지 못했습니다.", 500);
    }

    const decision = decideAccountDeletion({
      profileDeletedAt: profile?.deleted_at ?? null,
      blockingOrderCount: blockingCount ?? 0,
    });
    if (decision.kind === "reject") {
      return fail(
        decision.code,
        decision.message,
        decision.status,
        decision.details,
      );
    }

    // 4) 익명화 → 개인 콘텐츠 정리 → auth soft delete → 안내 메일 (service_role)
    const admin = createAdminSupabase();

    //   안내 메일 수신 정보는 익명화 전에 캡처 (익명화 후 profiles.email=null, display_name='탈퇴회원').
    //   재시도(resumed)면 display_name 이 이미 익명화돼 있으므로 이메일 앞부분으로 대체.
    const realEmail = (user.email ?? profile?.email ?? "").trim();
    const displayName =
      (!decision.resumed ? profile?.display_name : null) ??
      (realEmail.split("@")[0] || "고객");

    const outcome = await executeAccountDeletion({
      anonymizeProfile: async () => {
        const { error } = await admin.rpc("anonymize_account", {
          p_user_id: user.id,
          p_reason: reason ?? null,
        });
        return { error: error ? error.message : null };
      },
      purgePersonalContent: async () => {
        const report = await purgeAccountContent(
          user.id,
          createAccountContentStore(admin, user.id),
        );
        if (report.storageCleanupDeferred) {
          // 행은 이미 지워졌으므로 원본은 orphan-photos cron 이 참조 재확인 후 회수한다.
          console.warn(
            "[account/delete] photo storage cleanup deferred to orphan cron:",
            report.storageCleanupError,
          );
        }
        return { error: null };
      },
      softDeleteAuthUser: async () => {
        // shouldSoftDelete=true — FK(주문 이력)와 무관하게 성공하고, 세션을 모두 삭제한다.
        const { error } = await admin.auth.admin.deleteUser(user.id, true);
        return { error: error ? error.message : null };
      },
      enqueueDeletedNotice: async () => {
        if (!realEmail) return;
        // 이미 큐에 있으면 다시 넣지 않는다. 이전 구현은 익명화 **전에** 메일을 넣었으므로
        // 그 구현이 남긴 중간 상태 계정이 재시도(resumed)할 때 중복 발송을 막는다.
        // 조회 실패 시에는 발송 쪽으로 진행한다 (누락보다 중복이 낫다).
        const { data: existing, error: existingErr } = await admin
          .from("email_jobs")
          .select("id")
          .eq("template", "user.account_deleted")
          .eq("related_type", "user")
          .eq("related_id", user.id)
          .limit(1);
        if (!existingErr && (existing ?? []).length > 0) return;
        // enqueueEmail 은 throw 하지 않고 ok:false 로 알린다 → 결과 기록용으로 throw 변환.
        const queued = await enqueueEmail({
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
        if (!queued.ok) throw new Error(queued.error ?? "enqueue failed");
      },
    });

    if (!outcome.ok) {
      console.error(
        `[account/delete] ${outcome.failedStep} step failed (anonymized=${outcome.anonymized}):`,
        outcome.internalMessage,
      );
    } else if (!outcome.noticeEnqueued) {
      console.warn("[account/delete] enqueue user.account_deleted failed");
    }

    const result = toAccountDeletionHttpResult(outcome, decision.resumed);
    if (!result.ok) {
      return fail(result.code, result.message, result.status, result.details);
    }

    // 세션은 soft delete 가 서버에서 이미 모두 삭제했다(GoTrue adminUserDelete → Logout).
    // 호스팅 버전 차이에 대비해 전역 로그아웃을 한 번 더 요청하고 쿠키도 지운다 (best-effort).
    // - 세션이 이미 없으면 GoTrue 가 403(session_not_found) → auth-js 가 무시하고 로컬 세션만 제거
    // - 세션이 남아 있었다면 /logout?scope=global 이 사용자의 모든 세션을 삭제
    try {
      await supabase.auth.signOut({ scope: "global" });
    } catch {
      /* 무시 — 클라이언트도 signOut 한다 */
    }

    // 클라이언트는 응답 후 supabase.auth.signOut() + 홈 리다이렉트
    return ok({
      ok: true,
      ...result.data,
    });
  } catch (err) {
    return failFromError(err);
  }
}

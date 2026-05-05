import "server-only";

import { fail, failFromError, ok } from "@/app/api/_lib/response";
import { requireUser } from "@/lib/auth/session";
import { createAdminSupabase } from "@/lib/db/admin";
import { enqueueEmail } from "@/lib/email/queue";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/auth/agree
 *
 * 인증된 사용자의 약관 동의 시각을 기록한다.
 *  - profiles.terms_agreed_at, profiles.privacy_agreed_at 가 NULL 인 경우 now() 로 채움.
 *  - 이미 채워져 있으면 no-op (RPC 가 coalesce 처리).
 *
 * 부수효과 (M15):
 *  - 약관 동의가 사실상 가입 완료 시점이므로, terms_agreed_at 가 처음 채워질 때
 *    user.welcome 이메일을 큐에 등록한다. (이미 동의 기록이 있으면 enqueue 생략.)
 *
 * 클라이언트는 매직링크 콜백 직후 또는 로그인 폼에서 체크박스 동의 시 호출.
 */
export async function POST() {
  try {
    const user = await requireUser();
    const admin = createAdminSupabase();

    // 1) 사전 조회 — 이미 동의가 기록되어 있으면 welcome 메일 enqueue 생략.
    const { data: prevProfile } = await admin
      .from("profiles")
      .select("id, email, display_name, terms_agreed_at")
      .eq("id", user.id)
      .maybeSingle();

    const wasFirstAgreement = !prevProfile?.terms_agreed_at;

    // 2) RPC — terms/privacy_agreed_at coalesce 채움.
    const { error } = await admin.rpc("record_agreements", {
      p_user_id: user.id,
    });
    if (error) {
      return fail("AGREEMENT_FAILED", error.message, 500);
    }

    // 3) welcome 메일 enqueue — 첫 동의일 때만.
    if (wasFirstAgreement) {
      const email = user.email ?? prevProfile?.email ?? "";
      const displayName =
        prevProfile?.display_name ??
        (email ? email.split("@")[0]! : "고객");
      if (email) {
        await enqueueEmail({
          template: "user.welcome",
          to: { email, name: displayName },
          context: {
            kind: "user",
            email,
            displayName,
          },
          relatedType: "user",
          relatedId: user.id,
        });
      }
    }

    return ok({ recorded: true, welcomeEnqueued: wasFirstAgreement });
  } catch (err) {
    return failFromError(err);
  }
}

import "server-only";

import { fail, failFromError, ok } from "@/app/api/_lib/response";
import { requireUser } from "@/lib/auth/session";
import { createAdminSupabase } from "@/lib/db/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/auth/agree
 *
 * 인증된 사용자의 약관 동의 시각을 기록한다.
 *  - profiles.terms_agreed_at, profiles.privacy_agreed_at 가 NULL 인 경우 now() 로 채움.
 *  - 이미 채워져 있으면 no-op (RPC 가 coalesce 처리).
 *
 * 클라이언트는 매직링크 콜백 직후 또는 로그인 폼에서 체크박스 동의 시 호출.
 */
export async function POST() {
  try {
    const user = await requireUser();
    const admin = createAdminSupabase();
    const { error } = await admin.rpc("record_agreements", {
      p_user_id: user.id,
    });
    if (error) {
      return fail("AGREEMENT_FAILED", error.message, 500);
    }
    return ok({ recorded: true });
  } catch (err) {
    return failFromError(err);
  }
}

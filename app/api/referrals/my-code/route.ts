import "server-only";

import { fail, failFromError, ok } from "@/app/api/_lib/response";
import { requireUser } from "@/lib/auth/session";
import { createAdminSupabase } from "@/lib/db/admin";
import { ensureReferralCode } from "@/lib/referrals/code";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/referrals/my-code
 *
 * 응답:
 *   {
 *     referralCode: string,
 *     referralUrl:  string,           // 절대 URL — 친구 공유용
 *     totalReferrals: number,         // 내 코드를 통해 가입한 사람 수
 *     totalRewarded:  number          // 보상 지급된(referee 가 결제 완료) 수
 *   }
 *
 * 멱등: 이미 발급된 코드가 있으면 그대로 돌려준다.
 *
 * 보안:
 *   - 코드 발급은 service_role 로 한다 (UNIQUE 충돌 회피용 select).
 *   - 통계는 referrer_id = auth.uid() 만 카운트.
 */
export async function GET() {
  try {
    const user = await requireUser();
    const admin = createAdminSupabase();

    const { code } = await ensureReferralCode(admin, user.id);

    const [{ count: totalReferrals }, { count: totalRewarded }] = await Promise.all([
      admin
        .from("referrals")
        .select("id", { count: "exact", head: true })
        .eq("referrer_id", user.id)
        .not("referee_id", "is", null),
      admin
        .from("referrals")
        .select("id", { count: "exact", head: true })
        .eq("referrer_id", user.id)
        .eq("reward_status", "rewarded"),
    ]);

    const base = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "");
    const referralUrl = base
      ? `${base}/?ref=${encodeURIComponent(code)}`
      : `/?ref=${encodeURIComponent(code)}`;

    return ok({
      referralCode: code,
      referralUrl,
      totalReferrals: totalReferrals ?? 0,
      totalRewarded: totalRewarded ?? 0,
    });
  } catch (err) {
    return failFromError(err);
  }
}

// 명시적으로 다른 메소드 차단
export async function POST() {
  return fail("METHOD_NOT_ALLOWED", "GET 만 허용됩니다.", 405);
}

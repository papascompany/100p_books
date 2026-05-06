import "server-only";

import { failFromError, ok } from "@/app/api/_lib/response";
import { requireUser } from "@/lib/auth/session";
import { createAdminSupabase } from "@/lib/db/admin";
import { REFERRAL_REWARD } from "@/lib/referrals/code";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/referrals/stats
 *
 * 응답:
 *   {
 *     totalReferrals: number,        // 내 코드로 가입한 사람 수
 *     totalRewarded:  number,        // 그 중 첫 결제 완료(보상 지급)된 수
 *     totalPending:   number,        // 가입했지만 아직 결제 안 한 수
 *     totalEarnedPoints: number,     // 누적 추천 적립 포인트 (rewarded × 5000)
 *     pointBalance:   number,        // 현재 포인트 잔액
 *     rewardPerReferral: number,     // 1인당 보상 액 (참고용 — 정책 변경 대비)
 *     recent: Array<{
 *       refereeId: string | null;    // referee_id (탈퇴 등으로 NULL 가능)
 *       rewardStatus: 'pending' | 'rewarded';
 *       createdAt: string;
 *     }>
 *   }
 *
 * 보안: referrer_id = auth.uid() 인 행만 집계.
 */
export async function GET() {
  try {
    const user = await requireUser();
    const admin = createAdminSupabase();

    const [
      { count: totalReferrals, error: totalErr },
      { count: totalRewarded, error: rewardedErr },
      { data: pointsRow, error: pointsErr },
      { data: recent, error: recentErr },
    ] = await Promise.all([
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
      admin
        .from("user_points")
        .select("balance")
        .eq("user_id", user.id)
        .maybeSingle(),
      admin
        .from("referrals")
        .select("referee_id, reward_status, created_at")
        .eq("referrer_id", user.id)
        .not("referee_id", "is", null)
        .order("created_at", { ascending: false })
        .limit(20),
    ]);

    if (totalErr) {
      return failFromError(
        new Error(`referrals 카운트 실패: ${totalErr.message}`),
      );
    }
    if (rewardedErr) {
      return failFromError(
        new Error(`rewarded 카운트 실패: ${rewardedErr.message}`),
      );
    }
    if (pointsErr) {
      return failFromError(
        new Error(`user_points 조회 실패: ${pointsErr.message}`),
      );
    }
    if (recentErr) {
      return failFromError(
        new Error(`referrals 최근 목록 실패: ${recentErr.message}`),
      );
    }

    const totalReferralsN = totalReferrals ?? 0;
    const totalRewardedN = totalRewarded ?? 0;

    return ok({
      totalReferrals: totalReferralsN,
      totalRewarded: totalRewardedN,
      totalPending: Math.max(0, totalReferralsN - totalRewardedN),
      totalEarnedPoints: totalRewardedN * REFERRAL_REWARD,
      pointBalance: pointsRow?.balance ?? 0,
      rewardPerReferral: REFERRAL_REWARD,
      recent: (recent ?? []).map((r) => ({
        refereeId: r.referee_id,
        rewardStatus: r.reward_status,
        createdAt: r.created_at,
      })),
    });
  } catch (err) {
    return failFromError(err);
  }
}

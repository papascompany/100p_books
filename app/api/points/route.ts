import "server-only";

import { failFromError, ok } from "@/app/api/_lib/response";
import { requireUser } from "@/lib/auth/session";
import { createAdminSupabase } from "@/lib/db/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const REASON_LABEL: Record<string, string> = {
  attendance: "출석체크",
  attendance_bonus: "출석 보너스",
  referral_reward: "친구 추천 보상",
  order_use: "주문 사용",
  order_refund: "주문 환불 복원",
  admin_adjust: "관리자 보정",
  welcome: "가입 웰컴",
};

/**
 * GET /api/points
 *
 * 응답:
 *   {
 *     balance: number,            // 현재 잔액
 *     updatedAt: string | null,
 *     ledger: Array<{             // 최근 50건 (최신순)
 *       id, amount, reason, label, balanceAfter, memo, createdAt
 *     }>,
 *     totals: {
 *       earned: number,           // 누적 적립 (>0 합)
 *       spent:  number,           // 누적 사용 (절댓값)
 *     }
 *   }
 *
 * user_points 행이 없는 신규 사용자는 balance=0 + 빈 ledger.
 * 차감/적립은 본 라우트가 아닌 결제/추천 보상/출석 라우트에서만 수행 (service_role).
 */
export async function GET(req: Request) {
  try {
    const user = await requireUser();
    const admin = createAdminSupabase();

    const url = new URL(req.url);
    const limitRaw = Number(url.searchParams.get("limit") ?? "50");
    const limit =
      Number.isFinite(limitRaw) && limitRaw > 0 && limitRaw <= 200
        ? Math.floor(limitRaw)
        : 50;

    const [pointsRes, ledgerRes] = await Promise.all([
      admin
        .from("user_points")
        .select("balance, updated_at")
        .eq("user_id", user.id)
        .maybeSingle(),
      admin
        .from("point_ledger")
        .select("id, amount, reason, ref_type, ref_id, balance_after, memo, created_at")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(limit),
    ]);

    if (pointsRes.error) {
      return failFromError(
        new Error(`포인트 조회 실패: ${pointsRes.error.message}`),
      );
    }
    if (ledgerRes.error) {
      // ledger 테이블이 아직 마이그레이션되지 않았어도 잔액은 응답한다.
      console.warn("[api/points] ledger 조회 실패:", ledgerRes.error.message);
    }

    const ledgerRows = ledgerRes.data ?? [];

    let earned = 0;
    let spent = 0;
    for (const row of ledgerRows) {
      if (row.amount > 0) earned += row.amount;
      else spent += -row.amount;
    }

    const ledger = ledgerRows.map((row) => ({
      id: row.id,
      amount: row.amount,
      reason: row.reason,
      label: REASON_LABEL[row.reason] ?? row.reason,
      refType: row.ref_type,
      refId: row.ref_id,
      balanceAfter: row.balance_after,
      memo: row.memo,
      createdAt: row.created_at,
    }));

    return ok({
      balance: pointsRes.data?.balance ?? 0,
      updatedAt: pointsRes.data?.updated_at ?? null,
      ledger,
      totals: { earned, spent },
    });
  } catch (err) {
    return failFromError(err);
  }
}

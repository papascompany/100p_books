import "server-only";

import { fail, failFromError, ok } from "@/app/api/_lib/response";
import { requireActiveUser } from "@/lib/auth/session";
import {
  DAILY_ATTENDANCE_REWARD,
  kstToday,
} from "@/lib/attendance/perfect-month";
import { createAdminSupabase } from "@/lib/db/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * user_points 에 +amount 를 atomic 적립 (add_user_points_v2 RPC).
 * 동시 호출 시 lost-update 방어 — INSERT ... ON CONFLICT DO UPDATE 단일 SQL.
 * v2 는 point_ledger 행도 함께 기록한다.
 */
async function creditPoints(
  admin: ReturnType<typeof createAdminSupabase>,
  userId: string,
  amount: number,
  reason: "attendance",
  refId?: string,
  memo?: string,
): Promise<void> {
  if (amount <= 0) return;

  const { error } = await admin.rpc("add_user_points_v2", {
    p_user_id: userId,
    p_amount: amount,
    p_reason: reason,
    p_ref_type: refId ? "attendances" : null,
    p_ref_id: refId ?? null,
    p_memo: memo ?? null,
  });
  if (error) {
    throw new Error(`add_user_points_v2 실패: ${error.message}`);
  }
}

/**
 * POST /api/attendance/check
 *
 * 오늘(KST) 출석체크.
 * - 중복 호출 시 멱등 응답 (alreadyChecked: true).
 * - 출석 성공 시 +100P. 월 보너스는 만근 보너스(+1,000P)뿐이며 여기서 주지 않는다 —
 *   KST 매월 1일 cron(/api/cron/attendance-reset)이 직전 달을 정산한다 (lib/attendance/perfect-month.ts).
 *   (10일 달성 +500P 는 2026-11-06 운영 결정으로 폐지.)
 * - 포인트 지급은 best-effort (실패해도 출석은 성공).
 *
 * 응답: {
 *   alreadyChecked: boolean,
 *   checkedDate: string,        // YYYY-MM-DD (KST)
 *   totalThisMonth: number,
 *   totalAllTime: number,
 *   pointsAwarded: number       // 이번 호출에서 지급된 포인트 (멱등 호출 시 0)
 * }
 */
export async function POST() {
  try {
    const user = await requireActiveUser();
    const admin = createAdminSupabase();

    const { dateStr, monthKey } = kstToday();

    // 1) 출석 INSERT (unique 제약으로 중복 방지 → 23505 → alreadyChecked).
    const { error: insErr } = await admin.from("attendances").insert({
      user_id: user.id,
      checked_date: dateStr,
      month_key: monthKey,
    });

    let alreadyChecked = false;
    if (insErr) {
      // 23505 = unique_violation. 멱등 응답.
      const code = (insErr as { code?: string }).code;
      if (code === "23505") {
        alreadyChecked = true;
      } else {
        return fail(
          "ATTENDANCE_INSERT_FAILED",
          `출석 기록 실패: ${insErr.message}`,
          500,
        );
      }
    }

    // 2) 통계 — 이번 달 / 전체 누적.
    const [thisMonthRes, allTimeRes] = await Promise.all([
      admin
        .from("attendances")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user.id)
        .eq("month_key", monthKey),
      admin
        .from("attendances")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user.id),
    ]);

    if (thisMonthRes.error) {
      return fail(
        "ATTENDANCE_COUNT_FAILED",
        `월별 출석 집계 실패: ${thisMonthRes.error.message}`,
        500,
      );
    }
    if (allTimeRes.error) {
      return fail(
        "ATTENDANCE_COUNT_FAILED",
        `전체 출석 집계 실패: ${allTimeRes.error.message}`,
        500,
      );
    }

    const totalThisMonth = thisMonthRes.count ?? 0;
    const totalAllTime = allTimeRes.count ?? 0;

    // 3) 포인트 보상 (best-effort, 신규 출석에 한함).
    let pointsAwarded = 0;

    if (!alreadyChecked) {
      try {
        await creditPoints(
          admin,
          user.id,
          DAILY_ATTENDANCE_REWARD,
          "attendance",
          undefined,
          `일일 출석 (${dateStr})`,
        );
        pointsAwarded += DAILY_ATTENDANCE_REWARD;
      } catch (e) {
        console.warn(
          "[attendance/check] 일일 포인트 지급 실패:",
          e instanceof Error ? e.message : String(e),
        );
      }
    }

    return ok({
      alreadyChecked,
      checkedDate: dateStr,
      totalThisMonth,
      totalAllTime,
      pointsAwarded,
    });
  } catch (err) {
    return failFromError(err);
  }
}

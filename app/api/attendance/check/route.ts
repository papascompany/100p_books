import "server-only";

import { fail, failFromError, ok } from "@/app/api/_lib/response";
import { requireUser } from "@/lib/auth/session";
import { createAdminSupabase } from "@/lib/db/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * 출석 일일 보상 (포인트).
 */
const DAILY_REWARD = 100;
/**
 * 월 10일 달성 보너스. 정확히 10일째 출석 시점에 1회만 지급.
 */
const TEN_DAY_BONUS = 500;
const TEN_DAY_THRESHOLD = 10;

/**
 * KST(UTC+9) 기준 오늘 일자(YYYY-MM-DD) 와 월 키(YYYY-MM) 를 반환.
 */
function kstToday(): { dateStr: string; monthKey: string } {
  const kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const dateStr = kst.toISOString().slice(0, 10); // YYYY-MM-DD
  const monthKey = dateStr.slice(0, 7); // YYYY-MM
  return { dateStr, monthKey };
}

/**
 * user_points 에 +amount 를 atomic 적립 (add_user_points_v2 RPC).
 * 동시 호출 시 lost-update 방어 — INSERT ... ON CONFLICT DO UPDATE 단일 SQL.
 * v2 는 point_ledger 행도 함께 기록한다.
 */
async function creditPoints(
  admin: ReturnType<typeof createAdminSupabase>,
  userId: string,
  amount: number,
  reason: "attendance" | "attendance_bonus",
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
 * - 출석 성공 시 +100P, 정확히 월 10일째 출석에 도달하면 +500P 추가 지급.
 * - 포인트 지급은 best-effort (실패해도 출석은 성공).
 *
 * 응답: {
 *   alreadyChecked: boolean,
 *   checkedDate: string,        // YYYY-MM-DD (KST)
 *   totalThisMonth: number,
 *   totalAllTime: number,
 *   pointsAwarded: number,      // 이번 호출에서 지급된 포인트 합 (멱등 호출 시 0)
 *   tenDayBonus: boolean        // 이번 호출에서 10일 보너스 지급 여부
 * }
 */
export async function POST() {
  try {
    const user = await requireUser();
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
    let tenDayBonus = false;

    if (!alreadyChecked) {
      try {
        await creditPoints(
          admin,
          user.id,
          DAILY_REWARD,
          "attendance",
          undefined,
          `일일 출석 (${dateStr})`,
        );
        pointsAwarded += DAILY_REWARD;
      } catch (e) {
        console.warn(
          "[attendance/check] 일일 포인트 지급 실패:",
          e instanceof Error ? e.message : String(e),
        );
      }

      // 정확히 10일째 도달한 시점에 보너스 1회 지급.
      if (totalThisMonth === TEN_DAY_THRESHOLD) {
        try {
          await creditPoints(
            admin,
            user.id,
            TEN_DAY_BONUS,
            "attendance_bonus",
            undefined,
            `${monthKey} 10일 달성 보너스`,
          );
          pointsAwarded += TEN_DAY_BONUS;
          tenDayBonus = true;
        } catch (e) {
          console.warn(
            "[attendance/check] 10일 보너스 지급 실패:",
            e instanceof Error ? e.message : String(e),
          );
        }
      }
    }

    return ok({
      alreadyChecked,
      checkedDate: dateStr,
      totalThisMonth,
      totalAllTime,
      pointsAwarded,
      tenDayBonus,
    });
  } catch (err) {
    return failFromError(err);
  }
}

import "server-only";

import { fail, failFromError, ok } from "@/app/api/_lib/response";
import { requireUser } from "@/lib/auth/session";
import { createAdminSupabase } from "@/lib/db/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * KST(UTC+9) 기준 오늘의 월 키(YYYY-MM) 를 반환.
 */
function kstMonthKey(): string {
  const kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 7);
}

/**
 * GET /api/attendance/me?month=YYYY-MM
 *
 * 해당 월(default: KST 현재 월) 의 출석 일자 목록 + 누적 통계.
 *
 * 응답: {
 *   month: string,              // YYYY-MM
 *   checkedDates: string[],     // YYYY-MM-DD 오름차순
 *   totalThisMonth: number,
 *   totalAllTime: number
 * }
 */
export async function GET(req: Request) {
  try {
    const user = await requireUser();
    const admin = createAdminSupabase();

    const url = new URL(req.url);
    const monthParam = url.searchParams.get("month");
    const month = monthParam ?? kstMonthKey();

    // 형식 검증 — YYYY-MM
    if (!/^\d{4}-\d{2}$/.test(month)) {
      return fail(
        "INVALID_MONTH",
        "month 파라미터는 YYYY-MM 형식이어야 합니다.",
        400,
        { month },
      );
    }

    // 1) 해당 월 출석 일자 목록.
    const { data: rows, error: listErr } = await admin
      .from("attendances")
      .select("checked_date")
      .eq("user_id", user.id)
      .eq("month_key", month)
      .order("checked_date", { ascending: true });

    if (listErr) {
      return fail(
        "ATTENDANCE_LIST_FAILED",
        `출석 조회 실패: ${listErr.message}`,
        500,
      );
    }

    const checkedDates = (rows ?? []).map((r) => r.checked_date as string);

    // 2) 전체 누적 카운트.
    const { count: allTimeCount, error: cntErr } = await admin
      .from("attendances")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id);

    if (cntErr) {
      return fail(
        "ATTENDANCE_COUNT_FAILED",
        `누적 출석 집계 실패: ${cntErr.message}`,
        500,
      );
    }

    return ok({
      month,
      checkedDates,
      totalThisMonth: checkedDates.length,
      totalAllTime: allTimeCount ?? 0,
    });
  } catch (err) {
    return failFromError(err);
  }
}

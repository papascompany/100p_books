import "server-only";

import { fail, failFromError, ok } from "@/app/api/_lib/response";
import { createAdminSupabase } from "@/lib/db/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * 월 20일 이상 출석 보너스.
 */
const MONTHLY_BONUS = 1000;
const MONTHLY_THRESHOLD = 20;

/**
 * KST(UTC+9) 기준 오늘 일자(YYYY-MM-DD).
 */
function kstNow(): { year: number; month: number; day: number; dateStr: string } {
  const kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const dateStr = kst.toISOString().slice(0, 10);
  const parts = dateStr.split("-");
  const year = parseInt(parts[0] ?? "0", 10);
  const month = parseInt(parts[1] ?? "0", 10);
  const day = parseInt(parts[2] ?? "0", 10);
  return { year, month, day, dateStr };
}

/**
 * 주어진 (year, month) 의 직전 달 month_key (YYYY-MM) 를 반환.
 * month: 1..12
 */
function previousMonthKey(year: number, month: number): string {
  const prevMonth = month === 1 ? 12 : month - 1;
  const prevYear = month === 1 ? year - 1 : year;
  return `${prevYear}-${String(prevMonth).padStart(2, "0")}`;
}

/**
 * GET /api/cron/attendance-reset
 *
 * Vercel Cron daily (UTC 15:00 = KST 00:00). KST 기준 매월 1일에만 동작.
 *
 * 인증:
 *   - `Authorization: Bearer <CRON_SECRET>` 또는 `x-vercel-cron: 1`.
 *
 * 동작 (KST 1일):
 *   1) 직전 달 월 출석 집계 (user_id 별 COUNT).
 *   2) 20일 이상 출석자에게 +1000P 지급 (best-effort).
 *   3) audit_logs 에 요약 기록.
 *
 * 응답:
 *   - 1일 아님: { skipped: true, reason }
 *   - 1일: { processed, rewarded, monthKey, durationMs }
 */
export async function GET(req: Request) {
  try {
    const auth = req.headers.get("authorization") ?? "";
    const expected = `Bearer ${process.env.CRON_SECRET ?? ""}`;
    const isVercelCron = req.headers.get("x-vercel-cron") === "1";

    if (!process.env.CRON_SECRET && !isVercelCron) {
      return fail(
        "CRON_NOT_CONFIGURED",
        "CRON_SECRET 이 설정되지 않았습니다.",
        500,
      );
    }
    if (!isVercelCron && process.env.CRON_SECRET && auth !== expected) {
      return fail("UNAUTHORIZED", "인증 헤더가 올바르지 않습니다.", 401);
    }

    const start = Date.now();
    const { year, month, day } = kstNow();

    // KST 기준 1일이 아니면 skip.
    if (day !== 1) {
      return ok({ skipped: true, reason: "not first day of KST month", day });
    }

    const prevMonthKey = previousMonthKey(year, month);
    const admin = createAdminSupabase();

    // 1) 직전 달 출석 전체 row 조회 → 메모리에서 user 별 카운트 집계.
    //    (출석은 사용자당 최대 31행, 활성 유저 수 ≤ 만 단위 가정 → 메모리 집계 OK)
    //    페이지네이션 — Supabase 기본 1000행 제한 회피.
    const userCounts = new Map<string, number>();
    const PAGE_SIZE = 1000;
    let from = 0;
    // 안전 상한 — 무한루프 차단.
    for (let iter = 0; iter < 200; iter++) {
      const { data, error } = await admin
        .from("attendances")
        .select("user_id")
        .eq("month_key", prevMonthKey)
        .range(from, from + PAGE_SIZE - 1);

      if (error) {
        return fail(
          "ATTENDANCE_AGGREGATE_FAILED",
          `출석 집계 실패: ${error.message}`,
          500,
        );
      }

      const rows = data ?? [];
      for (const row of rows) {
        const uid = row.user_id as string;
        userCounts.set(uid, (userCounts.get(uid) ?? 0) + 1);
      }

      if (rows.length < PAGE_SIZE) break;
      from += PAGE_SIZE;
    }

    const processed = userCounts.size;

    // 2) 20일 이상 사용자에게 보너스 지급 (best-effort).
    let rewarded = 0;
    const rewardErrors: { userId: string; error: string }[] = [];

    for (const [userId, cnt] of userCounts.entries()) {
      if (cnt < MONTHLY_THRESHOLD) continue;

      try {
        // atomic 적립 — 동시성 안전 (0022_atomic_discount_increment.sql)
        const { error: rpcErr } = await admin.rpc("add_user_points", {
          p_user_id: userId,
          p_amount: MONTHLY_BONUS,
        });
        if (rpcErr) throw new Error(rpcErr.message);

        rewarded += 1;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        rewardErrors.push({ userId, error: msg });
        console.warn(
          `[cron/attendance-reset] 보너스 지급 실패 user=${userId}:`,
          msg,
        );
      }
    }

    const durationMs = Date.now() - start;

    // 3) 요약 로그. audit_logs 테이블은 target_id 가 uuid 타입이라 cron 키
    //    (YYYY-MM 문자열) 를 직접 넣을 수 없으므로 콘솔 요약만 남긴다.
    //    (필요 시 별도 cron_logs 테이블을 후속 마이그레이션으로 추가)
    console.info(
      `[cron/attendance-reset] month=${prevMonthKey} processed=${processed} rewarded=${rewarded} errors=${rewardErrors.length} duration=${durationMs}ms`,
    );

    return ok({
      monthKey: prevMonthKey,
      processed,
      rewarded,
      rewardErrorCount: rewardErrors.length,
      durationMs,
    });
  } catch (err) {
    return failFromError(err);
  }
}

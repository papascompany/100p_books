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
    // CRON_SECRET 이 설정되면 항상 Bearer 검증을 강제한다 (x-vercel-cron 헤더
    // 단독 신뢰 회피 — 방어 심화). Vercel Cron 은 CRON_SECRET 존재 시
    // Authorization: Bearer 를 자동 부여하므로 실제 cron 은 그대로 통과.
    // CRON_SECRET 미설정 시에만 x-vercel-cron 으로 fallback (수동 호출 차단).
    const auth = req.headers.get("authorization") ?? "";
    const secret = process.env.CRON_SECRET;
    const isVercelCron = req.headers.get("x-vercel-cron") === "1";
    if (secret) {
      if (auth !== `Bearer ${secret}`) {
        return fail("UNAUTHORIZED", "인증 헤더가 올바르지 않습니다.", 401);
      }
    } else if (!isVercelCron) {
      return fail("CRON_NOT_CONFIGURED", "CRON_SECRET 이 설정되지 않았습니다.", 500);
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
    //    멱등 — cron 은 at-least-once(재시도/수동 재호출) 라 이중 지급 위험이 있다.
    //    이번 달 'attendance_bonus' 가 이미 적립된 사용자(point_ledger.memo 에 monthKey
    //    포함)는 건너뛴다. (동시 중복 실행 edge 는 드물어 사전조회로 충분.)
    const { data: grantedRows } = await admin
      .from("point_ledger")
      .select("user_id")
      .eq("reason", "attendance_bonus")
      .like("memo", `%${prevMonthKey}%`);
    const alreadyGranted = new Set(
      (grantedRows ?? []).map((g) => g.user_id as string),
    );

    let rewarded = 0;
    let skipped = 0;
    const rewardErrors: { userId: string; error: string }[] = [];

    for (const [userId, cnt] of userCounts.entries()) {
      if (cnt < MONTHLY_THRESHOLD) continue;
      if (alreadyGranted.has(userId)) {
        skipped += 1;
        continue; // 이미 이번 달 보너스 지급됨 — 이중 지급 방지
      }

      try {
        // point_ledger 에 기록되는 v2 로 적립 (멱등 체크 근거 + 감사추적).
        const { error: rpcErr } = await admin.rpc("add_user_points_v2", {
          p_user_id: userId,
          p_amount: MONTHLY_BONUS,
          p_reason: "attendance_bonus",
          p_ref_type: null,
          p_ref_id: null,
          p_memo: `${prevMonthKey} 월 출석 보너스 (20일+)`,
        });
        if (rpcErr) throw new Error(rpcErr.message);

        alreadyGranted.add(userId); // 같은 run 내 중복 방지
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
      `[cron/attendance-reset] month=${prevMonthKey} processed=${processed} rewarded=${rewarded} skipped=${skipped} errors=${rewardErrors.length} duration=${durationMs}ms`,
    );

    return ok({
      monthKey: prevMonthKey,
      processed,
      rewarded,
      skipped,
      rewardErrorCount: rewardErrors.length,
      durationMs,
    });
  } catch (err) {
    return failFromError(err);
  }
}

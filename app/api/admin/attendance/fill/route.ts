import "server-only";

import { fail, ok } from "@/app/api/_lib/response";
import { withAdmin } from "@/lib/admin/auth";
import { logAdminAction } from "@/lib/admin/audit";
import type { AdminAttendanceFillResult } from "@/lib/attendance/admin-types";
import {
  AttendanceFillBodySchema,
  kstToday,
  monthBonusMemos,
  monthStatus,
  PERFECT_MONTH_BONUS,
  perfectMonthBonusMemo,
  planAttendanceFill,
} from "@/lib/attendance/perfect-month";
import { createAdminSupabase } from "@/lib/db/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/admin/attendance/fill
 *
 * 관리자 `출석 채우기` — 지난 출석 부족분을 소급하는 **유일한** 경로 (2026-11-06 운영 결정).
 *
 * 본문: { userId: uuid, monthKey: "YYYY-MM", reason: string(trim 2..200) }
 *
 * 동작:
 *   1) 미래 월·형식 오류 400, 회원 없음 404, 탈퇴(익명화) 회원 409.
 *   2) 그 달의 미출석 날짜 중 **KST 어제까지**만 attendances 에 넣는다(unique 충돌은 무시).
 *      소급분은 일일 +100P 를 주지 않는다.
 *   3) 지난 달이고 채운 뒤 만근(>= min(30, 그 달 일수))이며 그 달 월 보너스가 없으면 +1,000P
 *      (`add_user_points_v2`, reason attendance_bonus, memo = perfectMonthBonusMemo). 이번 달은 다음 달 1일 cron 이 정산.
 *   4) audit_logs `attendance.fill` — 관리자·대상·월·채운 일수·사유·보너스 지급 여부.
 *   채울 날짜도 지급할 보너스도 없으면 409 NOTHING_TO_FILL (감사 로그 없음).
 */
export const POST = withAdmin(async (req, _ctx, user) => {
  const raw = (await req.json().catch(() => ({}))) as unknown;
  const parsed = AttendanceFillBodySchema.safeParse(raw);
  if (!parsed.success) {
    return fail(
      "INVALID_BODY",
      parsed.error.issues[0]?.message ?? "요청 본문이 올바르지 않습니다.",
      400,
      parsed.error.flatten(),
    );
  }
  const { userId, monthKey, reason } = parsed.data;

  const today = kstToday();
  if (monthStatus(monthKey, today.monthKey) === "future") {
    return fail("INVALID_MONTH", "미래 월은 채울 수 없습니다.", 400, { monthKey });
  }

  const admin = createAdminSupabase();

  // 1) 대상 회원 확인.
  const { data: profile, error: profileErr } = await admin
    .from("profiles")
    .select("id, email, display_name, deleted_at")
    .eq("id", userId)
    .maybeSingle();
  if (profileErr) return fail("USER_QUERY_FAILED", profileErr.message, 500);
  if (!profile) return fail("NOT_FOUND", "회원을 찾을 수 없습니다.", 404);
  if (profile.deleted_at) {
    return fail("USER_DELETED", "탈퇴한 회원은 출석을 채울 수 없습니다.", 409);
  }

  // 2) 현재 출석·보너스 상태.
  const [existingRes, bonusRes] = await Promise.all([
    admin
      .from("attendances")
      .select("checked_date")
      .eq("user_id", userId)
      .eq("month_key", monthKey),
    admin
      .from("point_ledger")
      .select("id")
      .eq("user_id", userId)
      .eq("reason", "attendance_bonus")
      .in("memo", monthBonusMemos(monthKey)),
  ]);
  if (existingRes.error) {
    return fail("ATTENDANCE_QUERY_FAILED", existingRes.error.message, 500);
  }
  if (bonusRes.error) {
    // 이력을 모른 채 지급하면 이중 지급 — 멈춘다.
    return fail("BONUS_LEDGER_QUERY_FAILED", bonusRes.error.message, 500);
  }
  const existingDates = (existingRes.data ?? []).map((r) => String(r.checked_date).slice(0, 10));
  const bonusAlreadyPaid = (bonusRes.data ?? []).length > 0;

  const plan = planAttendanceFill({
    monthKey,
    todayDateStr: today.dateStr,
    existingDates,
    bonusAlreadyPaid,
  });

  if (plan.datesToInsert.length === 0 && !plan.shouldPayBonus) {
    return fail(
      "NOTHING_TO_FILL",
      plan.perfectAfter && plan.status === "past"
        ? "이미 만근이며 만근 보너스도 지급되었습니다."
        : "채울 날짜가 없습니다.",
      409,
      { attended: plan.attendedBefore, requiredDays: plan.requiredDays },
    );
  }

  // 3) 미출석 날짜 INSERT — ON CONFLICT DO NOTHING (동시 출석·동시 소급과 경합해도 안전).
  let filledDates: string[] = [];
  if (plan.datesToInsert.length > 0) {
    const { data: inserted, error: insErr } = await admin
      .from("attendances")
      .upsert(
        plan.datesToInsert.map((d) => ({
          user_id: userId,
          checked_date: d,
          month_key: monthKey,
        })),
        { onConflict: "user_id,checked_date", ignoreDuplicates: true },
      )
      .select("checked_date");
    if (insErr) return fail("ATTENDANCE_FILL_FAILED", insErr.message, 500);
    filledDates = (inserted ?? []).map((r) => String(r.checked_date).slice(0, 10)).sort();
  }

  // 실제 반영 후 일수 — 경합으로 일부가 이미 있었어도 정확하다.
  const { count: afterCount, error: countErr } = await admin
    .from("attendances")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("month_key", monthKey);
  const attendedAfter = countErr ? plan.attendedAfter : (afterCount ?? plan.attendedAfter);
  const perfect = attendedAfter >= plan.requiredDays;

  // 4) 지난 달 만근 보너스.
  let bonusPaid = false;
  let bonusRaced = false;
  let bonusError: string | null = null;
  if (plan.status === "past" && perfect && !bonusAlreadyPaid) {
    const { error: rpcErr } = await admin.rpc("add_user_points_v2", {
      p_user_id: userId,
      p_amount: PERFECT_MONTH_BONUS,
      p_reason: "attendance_bonus",
      p_ref_type: null,
      p_ref_id: null,
      p_memo: perfectMonthBonusMemo(monthKey),
    });
    if (!rpcErr) {
      bonusPaid = true;
    } else if ((rpcErr as { code?: string }).code === "23505") {
      // 같은 memo 가 그 사이 cron·다른 관리자 요청으로 적립됨 (0028 부분 unique 인덱스).
      bonusRaced = true;
    } else {
      bonusError = rpcErr.message;
      console.warn(`[admin/attendance/fill] 만근 보너스 적립 실패 user=${userId}:`, rpcErr.message);
    }
  }

  await logAdminAction({
    actor: { id: user.id, email: user.email },
    action: "attendance.fill",
    targetType: "user",
    targetId: userId,
    details: {
      monthKey,
      reason,
      filledCount: filledDates.length,
      filledDates,
      attendedBefore: plan.attendedBefore,
      attendedAfter,
      requiredDays: plan.requiredDays,
      bonusPaid,
      bonusAmount: bonusPaid ? PERFECT_MONTH_BONUS : 0,
      ...(bonusError ? { bonusError } : {}),
      targetEmail: profile.email ?? null,
      targetDisplayName: profile.display_name ?? null,
    },
    request: req,
  });

  const result: AdminAttendanceFillResult = {
    userId,
    monthKey,
    monthStatus: plan.status === "past" ? "past" : "current",
    requiredDays: plan.requiredDays,
    attendedBefore: plan.attendedBefore,
    attendedAfter,
    filledCount: filledDates.length,
    filledDates,
    perfect,
    bonusPaid,
    bonusAlreadyPaid: bonusAlreadyPaid || bonusRaced,
    bonusAmount: bonusPaid ? PERFECT_MONTH_BONUS : 0,
    bonusError,
  };
  return ok(result);
});

import { z } from "zod";

/**
 * 출석 정책 (2026-11-06 운영 결정) — 순수 로직 모음.
 *
 *   - 매일 출석: +100P (`/api/attendance/check`). 관리자 소급분은 일일 포인트가 없다.
 *   - 월 보너스는 **만근 보너스** 하나뿐: 그 달 출석 일수가 `requiredDaysForMonth()` 이상이면 +1,000P.
 *     기준 = min(30, 그 달 일수) — 31일 달은 30일, 30일 달은 30일, 2월은 28/29일 전부.
 *   - 지급 경로: (a) KST 매월 1일 cron 이 직전 달을 정산, (b) 관리자 `출석 채우기` 로 지난 달을 만근으로 만든 경우
 *     그 자리에서 지급. 둘 다 `perfectMonthBonusMemo()` 정확 일치로 중복을 막는다
 *     (DB 에도 point_ledger (user_id, memo) where reason='attendance_bonus' 부분 unique 인덱스 — 0028).
 *   - 10일 달성 보너스(+500P)는 폐지. 과거 20일 보너스(+1,000P)를 이미 받은 달은 같은 월 보너스로 보고 다시 주지 않는다.
 *
 * DB·서버 의존이 없어 서버 라우트·관리자 클라이언트·테스트가 함께 쓴다.
 */

/** 일일 출석 적립 포인트. */
export const DAILY_ATTENDANCE_REWARD = 100;
/** 만근 보너스 포인트. */
export const PERFECT_MONTH_BONUS = 1000;
/** 만근 기준 상한 일수 (30일 미만인 달은 그 달 전체 일수). */
export const PERFECT_MONTH_MAX_DAYS = 30;

const MONTH_KEY_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/** `YYYY-MM` (월 01..12) 형식인지. */
export function isValidMonthKey(value: string): boolean {
  return MONTH_KEY_RE.test(value);
}

function splitMonthKey(monthKey: string): { year: number; month: number } {
  if (!isValidMonthKey(monthKey)) {
    throw new Error(`invalid monthKey: ${monthKey}`);
  }
  const [y, m] = monthKey.split("-");
  return { year: Number(y), month: Number(m) };
}

/** 그 달의 일수 (28..31). */
export function daysInMonth(monthKey: string): number {
  const { year, month } = splitMonthKey(monthKey);
  // UTC 기준 다음 달 0일 = 이번 달 말일 — 실행 환경 timezone 과 무관.
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** 만근으로 인정되는 출석 일수 = min(30, 그 달 일수). */
export function requiredDaysForMonth(monthKey: string): number {
  return Math.min(PERFECT_MONTH_MAX_DAYS, daysInMonth(monthKey));
}

/** 출석 일수가 그 달 만근 기준 이상인지. */
export function isPerfectMonth(attendedDays: number, monthKey: string): boolean {
  return attendedDays >= requiredDaysForMonth(monthKey);
}

/**
 * 만근 보너스 적립 memo 이자 중복 지급 판정 키 (point_ledger.memo 정확 일치).
 * 사용자 포인트 내역에도 그대로 보이므로 2월처럼 30일 미만인 달에도 맞는 문구로 둔다.
 */
export function perfectMonthBonusMemo(monthKey: string): string {
  return `${monthKey} 월 만근 보너스`;
}

/**
 * 폐지된 월 20일 보너스 memo (2026-11 이전 cron 이 적립). 같은 달 월 보너스를 이미 받은 것으로 본다.
 */
export function legacyMonthlyBonusMemo(monthKey: string): string {
  return `${monthKey} 월 출석 보너스 (20일+)`;
}

/** 그 달 월 보너스로 간주하는 memo 전체 (중복 판정용). */
export function monthBonusMemos(monthKey: string): string[] {
  return [perfectMonthBonusMemo(monthKey), legacyMonthlyBonusMemo(monthKey)];
}

/** KST(UTC+9) 기준 오늘 일자와 월 키. */
export function kstToday(nowMs: number = Date.now()): { dateStr: string; monthKey: string } {
  const dateStr = new Date(nowMs + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
  return { dateStr, monthKey: dateStr.slice(0, 7) };
}

export type MonthStatus = "past" | "current" | "future";

/** 대상 월이 KST 현재 월 기준 지난 달 / 이번 달 / 미래 달인지. (YYYY-MM 은 문자열 비교로 순서가 맞다.) */
export function monthStatus(monthKey: string, currentMonthKey: string): MonthStatus {
  if (monthKey < currentMonthKey) return "past";
  if (monthKey === currentMonthKey) return "current";
  return "future";
}

/** 그 달 1일부터 말일까지 `YYYY-MM-DD` 오름차순. */
export function monthDates(monthKey: string): string[] {
  const total = daysInMonth(monthKey);
  const out: string[] = [];
  for (let d = 1; d <= total; d += 1) {
    out.push(`${monthKey}-${String(d).padStart(2, "0")}`);
  }
  return out;
}

export interface FillPlanInput {
  monthKey: string;
  /** KST 오늘 `YYYY-MM-DD`. 오늘과 그 이후는 채우지 않는다(오늘은 회원 본인 출석 몫). */
  todayDateStr: string;
  /** 이미 출석한 날짜 (`YYYY-MM-DD`). */
  existingDates: readonly string[];
  /** 그 달 월 보너스가 point_ledger 에 이미 있는지. */
  bonusAlreadyPaid: boolean;
}

export interface FillPlan {
  monthKey: string;
  status: MonthStatus;
  requiredDays: number;
  attendedBefore: number;
  /** 새로 넣을 날짜 (어제까지, 미출석). 오늘은 회원 본인 출석(+100P)을 막지 않도록 제외한다. */
  datesToInsert: string[];
  attendedAfter: number;
  perfectAfter: boolean;
  /** 지난 달 + 채운 뒤 만근 + 미지급일 때만 true. 이번 달은 다음 달 1일 cron 이 정산한다. */
  shouldPayBonus: boolean;
}

/**
 * 관리자 `출석 채우기` 계획. 미래 달은 호출 전에 거부해야 한다(여기서는 throw).
 */
export function planAttendanceFill(input: FillPlanInput): FillPlan {
  const { monthKey, todayDateStr, existingDates, bonusAlreadyPaid } = input;
  const status = monthStatus(monthKey, todayDateStr.slice(0, 7));
  if (status === "future") {
    throw new Error(`future month cannot be filled: ${monthKey}`);
  }
  const existing = new Set(existingDates.filter((d) => d.startsWith(`${monthKey}-`)));
  const datesToInsert = monthDates(monthKey).filter(
    (d) => d < todayDateStr && !existing.has(d),
  );
  const requiredDays = requiredDaysForMonth(monthKey);
  const attendedBefore = existing.size;
  const attendedAfter = attendedBefore + datesToInsert.length;
  const perfectAfter = attendedAfter >= requiredDays;
  return {
    monthKey,
    status,
    requiredDays,
    attendedBefore,
    datesToInsert,
    attendedAfter,
    perfectAfter,
    shouldPayBonus: status === "past" && perfectAfter && !bonusAlreadyPaid,
  };
}

/** 관리자 소급 사유 — 앞뒤 공백 제거 후 2..200자. */
export const FillReasonSchema = z
  .string()
  .trim()
  .min(2, "사유를 2자 이상 입력해 주세요.")
  .max(200, "사유는 200자 이하로 입력해 주세요.");

export const MonthKeySchema = z
  .string()
  .refine(isValidMonthKey, "월은 YYYY-MM 형식이어야 합니다.");

/** POST /api/admin/attendance/fill 본문. */
export const AttendanceFillBodySchema = z.object({
  userId: z.string().uuid(),
  monthKey: MonthKeySchema,
  reason: FillReasonSchema,
});

export type AttendanceFillBody = z.infer<typeof AttendanceFillBodySchema>;

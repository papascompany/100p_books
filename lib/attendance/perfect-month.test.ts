import { describe, expect, it } from "vitest";

import {
  AttendanceFillBodySchema,
  daysInMonth,
  FillReasonSchema,
  isPerfectMonth,
  isValidMonthKey,
  kstToday,
  legacyMonthlyBonusMemo,
  monthBonusMemos,
  monthDates,
  monthStatus,
  perfectMonthBonusMemo,
  planAttendanceFill,
  requiredDaysForMonth,
} from "./perfect-month";

/**
 * 출석 만근 정책 (2026-11-06 운영 결정) — 만근 기준 = min(30, 그 달 일수), 관리자 소급 계획.
 */

const USER = "11111111-1111-4111-8111-111111111111";

function dates(monthKey: string, from: number, to: number): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d += 1) out.push(`${monthKey}-${String(d).padStart(2, "0")}`);
  return out;
}

describe("만근 기준 일수", () => {
  it("31일 달 → 30일", () => {
    expect(daysInMonth("2026-10")).toBe(31);
    expect(requiredDaysForMonth("2026-10")).toBe(30);
  });
  it("30일 달 → 30일", () => {
    expect(daysInMonth("2026-11")).toBe(30);
    expect(requiredDaysForMonth("2026-11")).toBe(30);
  });
  it("윤년 2월(29일) → 29일", () => {
    expect(daysInMonth("2028-02")).toBe(29);
    expect(requiredDaysForMonth("2028-02")).toBe(29);
  });
  it("평년 2월(28일) → 28일", () => {
    expect(daysInMonth("2026-02")).toBe(28);
    expect(requiredDaysForMonth("2026-02")).toBe(28);
  });
  it("기준 이상이면 만근 — 31일 달은 30일 출석으로 충분", () => {
    expect(isPerfectMonth(29, "2026-10")).toBe(false);
    expect(isPerfectMonth(30, "2026-10")).toBe(true);
    expect(isPerfectMonth(31, "2026-10")).toBe(true);
    expect(isPerfectMonth(27, "2026-02")).toBe(false);
    expect(isPerfectMonth(28, "2026-02")).toBe(true);
  });
  it("잘못된 월 키는 throw", () => {
    expect(() => requiredDaysForMonth("2026-13")).toThrow();
    expect(() => requiredDaysForMonth("2026-1")).toThrow();
  });
});

describe("월 키·날짜", () => {
  it("isValidMonthKey", () => {
    expect(isValidMonthKey("2026-11")).toBe(true);
    expect(isValidMonthKey("2026-00")).toBe(false);
    expect(isValidMonthKey("2026-13")).toBe(false);
    expect(isValidMonthKey("2026-1")).toBe(false);
    expect(isValidMonthKey("2026-11-01")).toBe(false);
  });
  it("kstToday 는 UTC 15:00 이후를 다음 날로 본다", () => {
    expect(kstToday(Date.parse("2026-10-31T14:59:59Z"))).toEqual({ dateStr: "2026-10-31", monthKey: "2026-10" });
    expect(kstToday(Date.parse("2026-10-31T15:00:00Z"))).toEqual({ dateStr: "2026-11-01", monthKey: "2026-11" });
  });
  it("monthStatus", () => {
    expect(monthStatus("2026-10", "2026-11")).toBe("past");
    expect(monthStatus("2025-12", "2026-01")).toBe("past");
    expect(monthStatus("2026-11", "2026-11")).toBe("current");
    expect(monthStatus("2026-12", "2026-11")).toBe("future");
  });
  it("monthDates 는 1일~말일", () => {
    const feb = monthDates("2026-02");
    expect(feb).toHaveLength(28);
    expect(feb[0]).toBe("2026-02-01");
    expect(feb.at(-1)).toBe("2026-02-28");
  });
});

describe("보너스 memo", () => {
  it("만근 memo 와 폐지된 20일 memo 를 함께 중복 판정에 쓴다", () => {
    expect(perfectMonthBonusMemo("2026-11")).toBe("2026-11 월 만근 보너스");
    expect(legacyMonthlyBonusMemo("2026-10")).toBe("2026-10 월 출석 보너스 (20일+)");
    expect(monthBonusMemos("2026-11")).toEqual(["2026-11 월 만근 보너스", "2026-11 월 출석 보너스 (20일+)"]);
    // 폐지된 10일 보너스는 월 보너스가 아니다 — 받았어도 만근 보너스를 막지 않는다.
    expect(monthBonusMemos("2026-11")).not.toContain("2026-11 10일 달성 보너스");
  });
});

describe("planAttendanceFill", () => {
  it("이번 달: 어제까지의 미출석일만 채우고 오늘·미래 날짜는 넣지 않으며 보너스는 주지 않는다", () => {
    const plan = planAttendanceFill({
      monthKey: "2026-11",
      todayDateStr: "2026-11-06",
      existingDates: ["2026-11-02", "2026-11-05"],
      bonusAlreadyPaid: false,
    });
    expect(plan.status).toBe("current");
    expect(plan.datesToInsert).toEqual(["2026-11-01", "2026-11-03", "2026-11-04"]);
    expect(plan.datesToInsert.every((d) => d < "2026-11-06")).toBe(true);
    expect(plan.attendedBefore).toBe(2);
    expect(plan.attendedAfter).toBe(5);
    expect(plan.perfectAfter).toBe(false);
    expect(plan.shouldPayBonus).toBe(false);
  });

  it("이번 달이 만근이 되어도 보너스는 다음 달 1일 cron 몫이다", () => {
    const plan = planAttendanceFill({
      monthKey: "2026-11",
      todayDateStr: "2026-11-30",
      existingDates: [...dates("2026-11", 1, 25), "2026-11-30"],
      bonusAlreadyPaid: false,
    });
    expect(plan.perfectAfter).toBe(true);
    expect(plan.shouldPayBonus).toBe(false);
  });

  it("지난 달: 말일까지 채우고, 만근이 되면 보너스 지급", () => {
    const plan = planAttendanceFill({
      monthKey: "2026-10",
      todayDateStr: "2026-11-06",
      existingDates: dates("2026-10", 1, 20),
      bonusAlreadyPaid: false,
    });
    expect(plan.status).toBe("past");
    expect(plan.datesToInsert).toEqual(dates("2026-10", 21, 31));
    expect(plan.requiredDays).toBe(30);
    expect(plan.attendedAfter).toBe(31);
    expect(plan.shouldPayBonus).toBe(true);
  });

  it("지난 달 보너스가 이미 있으면 다시 주지 않는다 (멱등)", () => {
    const plan = planAttendanceFill({
      monthKey: "2026-10",
      todayDateStr: "2026-11-06",
      existingDates: dates("2026-10", 1, 10),
      bonusAlreadyPaid: true,
    });
    expect(plan.perfectAfter).toBe(true);
    expect(plan.shouldPayBonus).toBe(false);
  });

  it("이미 만근인 지난 달 + 보너스 미지급 → 채울 날짜 없이 보너스만", () => {
    const plan = planAttendanceFill({
      monthKey: "2026-02",
      todayDateStr: "2026-11-06",
      existingDates: dates("2026-02", 1, 28),
      bonusAlreadyPaid: false,
    });
    expect(plan.datesToInsert).toEqual([]);
    expect(plan.shouldPayBonus).toBe(true);
  });

  it("다른 달 날짜가 섞여 들어와도 그 달 것만 센다", () => {
    const plan = planAttendanceFill({
      monthKey: "2026-10",
      todayDateStr: "2026-11-06",
      existingDates: ["2026-09-30", "2026-10-01"],
      bonusAlreadyPaid: false,
    });
    expect(plan.attendedBefore).toBe(1);
    expect(plan.datesToInsert).toHaveLength(30);
  });

  it("미래 월은 throw", () => {
    expect(() =>
      planAttendanceFill({ monthKey: "2026-12", todayDateStr: "2026-11-06", existingDates: [], bonusAlreadyPaid: false }),
    ).toThrow();
  });
});

describe("사유·본문 검증", () => {
  it("사유는 trim 후 2..200자", () => {
    expect(FillReasonSchema.safeParse("").success).toBe(false);
    expect(FillReasonSchema.safeParse("   가   ").success).toBe(false);
    expect(FillReasonSchema.safeParse("  장애  ").data).toBe("장애");
    expect(FillReasonSchema.safeParse("가".repeat(200)).success).toBe(true);
    expect(FillReasonSchema.safeParse("가".repeat(201)).success).toBe(false);
    expect(FillReasonSchema.safeParse(` ${"가".repeat(200)} `).success).toBe(true);
  });

  it("본문 — userId uuid, monthKey YYYY-MM, reason 필수", () => {
    expect(AttendanceFillBodySchema.safeParse({ userId: USER, monthKey: "2026-10", reason: "CS 보상" }).success).toBe(true);
    expect(AttendanceFillBodySchema.safeParse({ userId: "x", monthKey: "2026-10", reason: "CS 보상" }).success).toBe(false);
    expect(AttendanceFillBodySchema.safeParse({ userId: USER, monthKey: "2026-13", reason: "CS 보상" }).success).toBe(false);
    expect(AttendanceFillBodySchema.safeParse({ userId: USER, monthKey: "2026-10" }).success).toBe(false);
  });
});

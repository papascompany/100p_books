import type { MonthStatus } from "./perfect-month";

/** GET /api/admin/attendance 의 회원 1행. */
export interface AdminAttendanceRow {
  userId: string;
  email: string | null;
  displayName: string | null;
  /** 탈퇴(익명화) 계정 — 소급 불가. */
  deleted: boolean;
  attendedDays: number;
  requiredDays: number;
  perfect: boolean;
  /** 그 달 월 보너스(만근 · 폐지된 20일) 가 point_ledger 에 있는지. */
  bonusPaid: boolean;
}

/** GET /api/admin/attendance 응답 data. */
export interface AdminAttendanceList {
  monthKey: string;
  monthStatus: Exclude<MonthStatus, "future">;
  requiredDays: number;
  todayKst: string;
  bonusAmount: number;
  /** "attended" = 그 달 출석자 전체(출석 일수 내림차순), "search" = 이메일·이름 검색 결과(출석 0일 포함). */
  mode: "attended" | "search";
  items: AdminAttendanceRow[];
  total: number;
  page: number;
  pageSize: number;
}

/** POST /api/admin/attendance/fill 응답 data. */
export interface AdminAttendanceFillResult {
  userId: string;
  monthKey: string;
  monthStatus: Exclude<MonthStatus, "future">;
  requiredDays: number;
  attendedBefore: number;
  attendedAfter: number;
  filledCount: number;
  filledDates: string[];
  perfect: boolean;
  /** 이번 호출에서 만근 보너스를 적립했는지. */
  bonusPaid: boolean;
  /** 이번 호출 전에 이미 그 달 월 보너스가 있었는지(또는 동시 지급과 경합). */
  bonusAlreadyPaid: boolean;
  bonusAmount: number;
  /** 보너스 적립 실패 메시지 (출석 채우기는 반영됨 — 다시 시도하면 보너스만 재시도). */
  bonusError: string | null;
}

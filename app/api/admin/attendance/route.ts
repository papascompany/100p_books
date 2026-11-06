import "server-only";

import { z } from "zod";

import { fail, ok } from "@/app/api/_lib/response";
import { withAdmin } from "@/lib/admin/auth";
import type {
  AdminAttendanceList,
  AdminAttendanceRow,
} from "@/lib/attendance/admin-types";
import {
  kstToday,
  monthBonusMemos,
  MonthKeySchema,
  monthStatus,
  PERFECT_MONTH_BONUS,
  requiredDaysForMonth,
} from "@/lib/attendance/perfect-month";
import { createAdminSupabase } from "@/lib/db/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const QuerySchema = z.object({
  month: MonthKeySchema.optional(),
  q: z.string().trim().max(120).optional(),
  page: z.coerce.number().int().min(1).max(10000).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

/** 검색 모드에서 이메일·이름 각각 가져오는 최대 회원 수. */
const SEARCH_LIMIT = 100;
/** PostgREST 기본 1000행 제한 회피용 페이지 크기. */
const PAGE_ROWS = 1000;
/** `.in()` 한 번에 넣는 id 수 (URL 길이 제한 회피). */
const ID_CHUNK = 100;

type Admin = ReturnType<typeof createAdminSupabase>;

function chunk<T>(arr: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/** 그 달 출석 행을 user 별 개수로 집계. userIds 를 주면 그 회원들만. */
async function countAttendance(
  admin: Admin,
  monthKey: string,
  userIds?: readonly string[],
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  const groups: Array<readonly string[] | null> = userIds
    ? chunk(userIds, ID_CHUNK)
    : [null];
  for (const ids of groups) {
    let from = 0;
    // 안전 상한 — 무한루프 차단 (cron 과 동일).
    for (let iter = 0; iter < 200; iter += 1) {
      let query = admin
        .from("attendances")
        .select("user_id")
        .eq("month_key", monthKey);
      if (ids) query = query.in("user_id", [...ids]);
      const { data, error } = await query.range(from, from + PAGE_ROWS - 1);
      if (error) throw new Error(`출석 집계 실패: ${error.message}`);
      const rows = data ?? [];
      for (const row of rows) {
        const uid = row.user_id as string;
        counts.set(uid, (counts.get(uid) ?? 0) + 1);
      }
      if (rows.length < PAGE_ROWS) break;
      from += PAGE_ROWS;
    }
  }
  return counts;
}

interface ProfileLite {
  id: string;
  email: string | null;
  display_name: string | null;
  deleted_at: string | null;
}

const PROFILE_COLUMNS = "id, email, display_name, deleted_at";

async function fetchProfiles(admin: Admin, ids: readonly string[]): Promise<Map<string, ProfileLite>> {
  const out = new Map<string, ProfileLite>();
  for (const group of chunk(ids, ID_CHUNK)) {
    const { data, error } = await admin
      .from("profiles")
      .select(PROFILE_COLUMNS)
      .in("id", group);
    if (error) throw new Error(`회원 조회 실패: ${error.message}`);
    for (const p of (data ?? []) as ProfileLite[]) out.set(p.id, p);
  }
  return out;
}

async function fetchBonusPaid(admin: Admin, monthKey: string, ids: readonly string[]): Promise<Set<string>> {
  const paid = new Set<string>();
  for (const group of chunk(ids, ID_CHUNK)) {
    const { data, error } = await admin
      .from("point_ledger")
      .select("user_id")
      .eq("reason", "attendance_bonus")
      .in("memo", monthBonusMemos(monthKey))
      .in("user_id", group);
    if (error) throw new Error(`보너스 지급 이력 조회 실패: ${error.message}`);
    for (const r of data ?? []) paid.add(r.user_id as string);
  }
  return paid;
}

/** 이메일·이름 부분 일치 검색 (탈퇴 계정 제외). `.or()` 문자열 조립을 피하려고 두 번 조회해 합친다. */
async function searchProfiles(admin: Admin, q: string): Promise<ProfileLite[]> {
  const pattern = `%${q}%`;
  const [byEmail, byName] = await Promise.all([
    admin
      .from("profiles")
      .select(PROFILE_COLUMNS)
      .is("deleted_at", null)
      .ilike("email", pattern)
      .order("created_at", { ascending: false })
      .limit(SEARCH_LIMIT),
    admin
      .from("profiles")
      .select(PROFILE_COLUMNS)
      .is("deleted_at", null)
      .ilike("display_name", pattern)
      .order("created_at", { ascending: false })
      .limit(SEARCH_LIMIT),
  ]);
  if (byEmail.error) throw new Error(`회원 검색 실패: ${byEmail.error.message}`);
  if (byName.error) throw new Error(`회원 검색 실패: ${byName.error.message}`);
  const merged = new Map<string, ProfileLite>();
  for (const p of [...((byEmail.data ?? []) as ProfileLite[]), ...((byName.data ?? []) as ProfileLite[])]) {
    merged.set(p.id, p);
  }
  return [...merged.values()];
}

/**
 * GET /api/admin/attendance?month=YYYY-MM&q=&page=&pageSize=
 *
 * 회원별 월 출석 현황 (관리자 `출석 채우기` 대상 선택용).
 *   - q 없음: 그 달 출석 기록이 있는 회원 전체 — 출석 일수 내림차순, 페이지네이션.
 *   - q 있음: 이메일·이름 부분 일치 회원(탈퇴 제외, 출석 0일 포함) — 출석 일수 오름차순.
 *   - month 기본값 = KST 현재 월. 미래 월은 400.
 */
export const GET = withAdmin(async (req) => {
  const url = new URL(req.url);
  const parsed = QuerySchema.safeParse({
    month: url.searchParams.get("month") || undefined,
    q: url.searchParams.get("q") ?? undefined,
    page: url.searchParams.get("page") ?? undefined,
    pageSize: url.searchParams.get("pageSize") ?? undefined,
  });
  if (!parsed.success) {
    return fail(
      "INVALID_QUERY",
      "쿼리 파라미터가 올바르지 않습니다.",
      400,
      parsed.error.flatten(),
    );
  }
  const today = kstToday();
  const monthKey = parsed.data.month ?? today.monthKey;
  const status = monthStatus(monthKey, today.monthKey);
  if (status === "future") {
    return fail("INVALID_MONTH", "미래 월은 조회할 수 없습니다.", 400, { monthKey });
  }
  const { q, page, pageSize } = parsed.data;
  const requiredDays = requiredDaysForMonth(monthKey);
  const admin = createAdminSupabase();

  try {
    let mode: AdminAttendanceList["mode"];
    let pageEntries: Array<{ userId: string; attendedDays: number }>;
    let total: number;
    let profiles: Map<string, ProfileLite>;

    if (q && q.length > 0) {
      mode = "search";
      const found = await searchProfiles(admin, q);
      const counts = await countAttendance(admin, monthKey, found.map((p) => p.id));
      const sorted = found
        .map((p) => ({ userId: p.id, attendedDays: counts.get(p.id) ?? 0 }))
        .sort((a, b) => a.attendedDays - b.attendedDays);
      total = sorted.length;
      pageEntries = sorted.slice((page - 1) * pageSize, page * pageSize);
      profiles = new Map(found.map((p) => [p.id, p]));
    } else {
      mode = "attended";
      const counts = await countAttendance(admin, monthKey);
      const sorted = [...counts.entries()]
        .map(([userId, attendedDays]) => ({ userId, attendedDays }))
        .sort((a, b) => b.attendedDays - a.attendedDays || a.userId.localeCompare(b.userId));
      total = sorted.length;
      pageEntries = sorted.slice((page - 1) * pageSize, page * pageSize);
      profiles = await fetchProfiles(admin, pageEntries.map((e) => e.userId));
    }

    const paid = await fetchBonusPaid(admin, monthKey, pageEntries.map((e) => e.userId));

    const items: AdminAttendanceRow[] = pageEntries.map(({ userId, attendedDays }) => {
      const p = profiles.get(userId);
      return {
        userId,
        email: p?.email ?? null,
        displayName: p?.display_name ?? null,
        // 프로필 행이 없으면(삭제된 auth 사용자 잔여) 소급 대상이 아니다.
        deleted: !p || p.deleted_at !== null,
        attendedDays,
        requiredDays,
        perfect: attendedDays >= requiredDays,
        bonusPaid: paid.has(userId),
      };
    });

    const data: AdminAttendanceList = {
      monthKey,
      monthStatus: status,
      requiredDays,
      todayKst: today.dateStr,
      bonusAmount: PERFECT_MONTH_BONUS,
      mode,
      items,
      total,
      page,
      pageSize,
    };
    return ok(data);
  } catch (e) {
    return fail(
      "ATTENDANCE_ADMIN_QUERY_FAILED",
      e instanceof Error ? e.message : String(e),
      500,
    );
  }
});

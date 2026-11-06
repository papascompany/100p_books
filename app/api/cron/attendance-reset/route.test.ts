// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { legacyMonthlyBonusMemo, perfectMonthBonusMemo } from "@/lib/attendance/perfect-month";

/**
 * GET /api/cron/attendance-reset — 월 만근 보너스 정산 (2026-11-06 운영 결정: 20일 보너스 → 만근 보너스).
 *
 * 고정하는 계약:
 *   - 만근 기준 = min(30, 그 달 일수). 31일 달 30일, 30일 달 30일, 2월 28/29일 전부.
 *   - 중복 판정은 memo **정확 일치** (만근 memo · 폐지된 20일 memo). 예전 `memo LIKE '%YYYY-MM%'` 는
 *     같은 달 10일 보너스 memo 에도 걸려 월 보너스가 지급되지 않았다 — mock 은 PostgREST eq/in/like/range
 *     의미를 그대로 흉내 내므로 LIKE 로 되돌리면 이 테스트가 실패한다.
 *   - 관리자 소급과 경합해 RPC 가 23505(부분 unique 인덱스)면 지급 완료로 보고 skipped 로 센다.
 */

type Row = Record<string, unknown>;

const db = vi.hoisted(() => ({
  attendances: [] as Row[],
  ledger: [] as Row[],
  rpcCalls: [] as Array<Record<string, unknown>>,
  ledgerError: null as null | { message: string },
  /** user_id → RPC 가 돌려줄 에러 (관리자 소급과의 경합 흉내). */
  rpcErrors: {} as Record<string, { code?: string; message: string }>,
}));

vi.mock("@/lib/security/cron-auth", () => ({
  verifyCronRequest: () => ({ ok: true, via: "bearer" }),
}));

vi.mock("@/lib/db/admin", () => {
  function likeToRegExp(pattern: string): RegExp {
    const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*").replace(/_/g, ".");
    return new RegExp(`^${escaped}$`);
  }
  function from(table: string) {
    const filters: Array<(r: Row) => boolean> = [];
    let range: [number, number] | null = null;
    const source = (): Row[] =>
      table === "attendances" ? db.attendances : table === "point_ledger" ? db.ledger : [];
    const run = () => {
      if (table === "point_ledger" && db.ledgerError) {
        return { data: null, error: db.ledgerError };
      }
      let rows = source().filter((r) => filters.every((f) => f(r)));
      if (range) rows = rows.slice(range[0], range[1] + 1);
      return { data: rows.map((r) => ({ ...r })), error: null };
    };
    const b = {
      select: () => b,
      eq: (column: string, value: unknown) => {
        filters.push((r) => r[column] === value);
        return b;
      },
      in: (column: string, values: unknown[]) => {
        filters.push((r) => values.includes(r[column]));
        return b;
      },
      like: (column: string, pattern: string) => {
        const re = likeToRegExp(pattern);
        filters.push((r) => typeof r[column] === "string" && re.test(r[column] as string));
        return b;
      },
      range: (fromIdx: number, toIdx: number) => {
        range = [fromIdx, toIdx];
        return b;
      },
      then<T>(resolve: (v: ReturnType<typeof run>) => T, reject?: (e: unknown) => T) {
        return Promise.resolve().then(run).then(resolve, reject);
      },
    };
    return b;
  }
  return {
    createAdminSupabase: () => ({
      from,
      rpc: async (fn: string, args: Record<string, unknown>) => {
        db.rpcCalls.push({ fn, ...args });
        const forced = db.rpcErrors[args.p_user_id as string];
        if (forced) return { data: null, error: forced };
        db.ledger.push({
          user_id: args.p_user_id,
          reason: args.p_reason,
          memo: args.p_memo,
          amount: args.p_amount,
        });
        return { data: 1000, error: null };
      },
    }),
  };
});

import { GET } from "./route";

const HEAVY = "11111111-1111-4111-8111-111111111111"; // 만근
const LIGHT = "22222222-2222-4222-8222-222222222222"; // 만근 미달

function attend(userId: string, days: number, monthKey = "2026-08") {
  for (let d = 1; d <= days; d += 1) {
    db.attendances.push({ user_id: userId, month_key: monthKey, checked_date: `${monthKey}-${String(d).padStart(2, "0")}` });
  }
}

async function runCron() {
  const res = await GET(new Request("https://100pbooks.vercel.app/api/cron/attendance-reset"));
  return { status: res.status, json: (await res.json()) as { ok: boolean; data?: Record<string, unknown>; error?: { code: string } } };
}

beforeEach(() => {
  db.attendances = [];
  db.ledger = [];
  db.rpcCalls = [];
  db.ledgerError = null;
  db.rpcErrors = {};
  vi.useFakeTimers();
  // KST 2026-09-01 00:05 = UTC 2026-08-31 15:05
  vi.setSystemTime(new Date("2026-08-31T15:05:00Z"));
  vi.spyOn(console, "info").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.useRealTimers();
});

function bonusCall(userId: string, monthKey = "2026-08") {
  return {
    fn: "add_user_points_v2",
    p_user_id: userId,
    p_amount: 1000,
    p_reason: "attendance_bonus",
    p_ref_type: null,
    p_ref_id: null,
    p_memo: `${monthKey} 월 만근 보너스`,
  };
}

describe("월 만근 보너스 정산", () => {
  it("31일 달: 30일 이상 출석자만 +1000P — 20일대는 더 이상 받지 않는다", async () => {
    attend(HEAVY, 30);
    attend(LIGHT, 29);
    const { status, json } = await runCron();
    expect(status).toBe(200);
    expect(json.data).toMatchObject({ monthKey: "2026-08", requiredDays: 30, processed: 2, rewarded: 1, skipped: 0 });
    expect(db.rpcCalls).toEqual([bonusCall(HEAVY)]);
  });

  it("30일 달: 30일 전부 출석해야 만근", async () => {
    vi.setSystemTime(new Date("2026-09-30T15:05:00Z")); // KST 2026-10-01 → 정산 대상 2026-09 (30일)
    attend(HEAVY, 30, "2026-09");
    attend(LIGHT, 29, "2026-09");
    const { json } = await runCron();
    expect(json.data).toMatchObject({ monthKey: "2026-09", requiredDays: 30, rewarded: 1 });
    expect(db.rpcCalls).toEqual([bonusCall(HEAVY, "2026-09")]);
  });

  it("평년 2월: 28일 전부 출석하면 만근", async () => {
    vi.setSystemTime(new Date("2027-02-28T15:05:00Z")); // KST 2027-03-01 → 2027-02 (28일)
    attend(HEAVY, 28, "2027-02");
    attend(LIGHT, 27, "2027-02");
    const { json } = await runCron();
    expect(json.data).toMatchObject({ monthKey: "2027-02", requiredDays: 28, rewarded: 1 });
    expect(db.rpcCalls).toEqual([bonusCall(HEAVY, "2027-02")]);
  });

  it("윤년 2월: 29일 전부 출석하면 만근", async () => {
    vi.setSystemTime(new Date("2028-02-29T15:05:00Z")); // KST 2028-03-01 → 2028-02 (29일)
    attend(HEAVY, 29, "2028-02");
    attend(LIGHT, 28, "2028-02");
    const { json } = await runCron();
    expect(json.data).toMatchObject({ monthKey: "2028-02", requiredDays: 29, rewarded: 1 });
    expect(db.rpcCalls).toEqual([bonusCall(HEAVY, "2028-02")]);
  });

  it("같은 달 (폐지된) 10일 보너스가 있어도 만근 보너스를 지급한다 — LIKE 회귀 방지", async () => {
    attend(HEAVY, 31);
    db.ledger.push({ user_id: HEAVY, reason: "attendance_bonus", memo: "2026-08 10일 달성 보너스" });
    const { json } = await runCron();
    expect(json.data).toMatchObject({ rewarded: 1, skipped: 0 });
    expect(db.rpcCalls).toEqual([bonusCall(HEAVY)]);
  });

  it("이미 이번 달 만근 보너스가 있으면 건너뛴다(재실행·관리자 소급 선지급 멱등)", async () => {
    attend(HEAVY, 30);
    const first = await runCron();
    expect(first.json.data).toMatchObject({ rewarded: 1, skipped: 0 });
    const second = await runCron();
    expect(second.json.data).toMatchObject({ rewarded: 0, skipped: 1 });
    expect(db.rpcCalls).toHaveLength(1);
  });

  it("그 달 폐지된 20일 보너스를 이미 받았으면 월 보너스 중복으로 본다", async () => {
    attend(HEAVY, 30);
    db.ledger.push({ user_id: HEAVY, reason: "attendance_bonus", memo: legacyMonthlyBonusMemo("2026-08") });
    const { json } = await runCron();
    expect(json.data).toMatchObject({ rewarded: 0, skipped: 1 });
    expect(db.rpcCalls).toEqual([]);
  });

  it("다른 달의 만근 보너스는 이번 달 지급을 막지 않는다", async () => {
    attend(HEAVY, 30);
    db.ledger.push({ user_id: HEAVY, reason: "attendance_bonus", memo: perfectMonthBonusMemo("2026-07") });
    const { json } = await runCron();
    expect(json.data).toMatchObject({ rewarded: 1 });
  });

  it("RPC 23505(동시 소급과 경합) → 지급 완료로 보고 skipped, 오류로 세지 않는다", async () => {
    attend(HEAVY, 30);
    db.rpcErrors[HEAVY] = { code: "23505", message: "duplicate key value violates unique constraint" };
    const { json } = await runCron();
    expect(json.data).toMatchObject({ rewarded: 0, skipped: 1, rewardErrorCount: 0 });
  });

  it("지급 이력 조회 실패 → 500, 지급 0건 (이력을 모른 채 지급하면 재실행 때 이중 지급)", async () => {
    attend(HEAVY, 30);
    db.ledgerError = { message: "timeout" };
    const { status, json } = await runCron();
    expect(status).toBe(500);
    expect(json.error?.code).toBe("BONUS_LEDGER_QUERY_FAILED");
    expect(db.rpcCalls).toEqual([]);
  });

  it("KST 1일이 아니면 아무것도 하지 않는다", async () => {
    vi.setSystemTime(new Date("2026-09-01T15:05:00Z")); // KST 09-02
    attend(HEAVY, 31);
    const { json } = await runCron();
    expect(json.data).toMatchObject({ skipped: true });
    expect(db.rpcCalls).toEqual([]);
  });
});

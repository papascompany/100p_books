// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { monthlyBonusMemo } from "./monthly-bonus";

/**
 * GET /api/cron/attendance-reset — 월 20일 보너스 중복 판정 (E 리뷰 발견 버그).
 *
 * 예전 조회 `memo LIKE '%YYYY-MM%'` 는 같은 달 10일 보너스 memo('YYYY-MM 10일 달성 보너스')에도 걸려,
 * 20일 이상 출석한 사용자가 "이미 지급" 으로 분류돼 월 보너스가 지급되지 않았다.
 * mock 은 PostgREST eq/like/range 의미를 그대로 흉내 내므로 LIKE 로 되돌리면 이 테스트가 실패한다.
 */

type Row = Record<string, unknown>;

const db = vi.hoisted(() => ({
  attendances: [] as Row[],
  ledger: [] as Row[],
  rpcCalls: [] as Array<Record<string, unknown>>,
  ledgerError: null as null | { message: string },
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

const HEAVY = "11111111-1111-4111-8111-111111111111"; // 20일+
const LIGHT = "22222222-2222-4222-8222-222222222222"; // 20일 미만

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
  vi.useFakeTimers();
  // KST 2026-09-01 00:05 = UTC 2026-08-31 15:05
  vi.setSystemTime(new Date("2026-08-31T15:05:00Z"));
  vi.spyOn(console, "info").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("월 20일 보너스 중복 판정", () => {
  it("같은 달 10일 보너스를 받은 20일+ 출석자에게도 월 보너스를 지급한다 (예전: LIKE 로 미지급)", async () => {
    attend(HEAVY, 22);
    attend(LIGHT, 12);
    db.ledger.push({ user_id: HEAVY, reason: "attendance_bonus", memo: "2026-08 10일 달성 보너스" });
    db.ledger.push({ user_id: LIGHT, reason: "attendance_bonus", memo: "2026-08 10일 달성 보너스" });

    const { status, json } = await runCron();
    expect(status).toBe(200);
    expect(json.data).toMatchObject({ monthKey: "2026-08", processed: 2, rewarded: 1, skipped: 0 });
    expect(db.rpcCalls).toEqual([
      {
        fn: "add_user_points_v2",
        p_user_id: HEAVY,
        p_amount: 1000,
        p_reason: "attendance_bonus",
        p_ref_type: null,
        p_ref_id: null,
        p_memo: "2026-08 월 출석 보너스 (20일+)",
      },
    ]);
  });

  it("이미 이번 달 20일 보너스가 있으면 건너뛴다(재실행 멱등)", async () => {
    attend(HEAVY, 25);
    const first = await runCron();
    expect(first.json.data).toMatchObject({ rewarded: 1, skipped: 0 });
    const second = await runCron();
    expect(second.json.data).toMatchObject({ rewarded: 0, skipped: 1 });
    expect(db.rpcCalls).toHaveLength(1);
  });

  it("다른 달의 20일 보너스는 이번 달 지급을 막지 않는다", async () => {
    attend(HEAVY, 20);
    db.ledger.push({ user_id: HEAVY, reason: "attendance_bonus", memo: monthlyBonusMemo("2026-07") });
    const { json } = await runCron();
    expect(json.data).toMatchObject({ rewarded: 1 });
  });

  it("지급 이력 조회 실패 → 500, 지급 0건 (이력을 모른 채 지급하면 재실행 때 이중 지급)", async () => {
    attend(HEAVY, 21);
    db.ledgerError = { message: "timeout" };
    const { status, json } = await runCron();
    expect(status).toBe(500);
    expect(json.error?.code).toBe("BONUS_LEDGER_QUERY_FAILED");
    expect(db.rpcCalls).toEqual([]);
  });

  it("KST 1일이 아니면 아무것도 하지 않는다", async () => {
    vi.setSystemTime(new Date("2026-09-01T15:05:00Z")); // KST 09-02
    attend(HEAVY, 22);
    const { json } = await runCron();
    expect(json.data).toMatchObject({ skipped: true });
    expect(db.rpcCalls).toEqual([]);
  });

  it("monthlyBonusMemo 는 10일 보너스 memo 와 겹치지 않는다", () => {
    expect(monthlyBonusMemo("2026-08")).toBe("2026-08 월 출석 보너스 (20일+)");
    expect(monthlyBonusMemo("2026-08")).not.toBe("2026-08 10일 달성 보너스");
  });
});

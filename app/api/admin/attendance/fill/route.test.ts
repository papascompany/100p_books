// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * POST /api/admin/attendance/fill — 관리자 `출석 채우기` (2026-11-06 운영 결정).
 *
 * 고정하는 계약:
 *   - 미출석일 중 KST 어제까지만 채운다(오늘·미래 없음). 소급분은 일일 +100P 없음.
 *   - 지난 달이 만근이 되면 그 자리에서 +1000P (memo `YYYY-MM 월 만근 보너스`), 이번 달은 지급하지 않는다.
 *   - 보너스는 memo 정확 일치로 1회만 (폐지된 20일 보너스도 같은 달 월 보너스로 본다, 23505 경합은 이미 지급).
 *   - 사유 필수(trim 2..200), 미래·형식 오류 월 400, 탈퇴 회원 409, 할 일 없으면 409.
 *   - audit_logs `attendance.fill` 에 사유·채운 일수·보너스 지급 여부.
 *
 * service_role 클라이언트만 인메모리 테이블(eq/in/upsert ignoreDuplicates 흉내)로 바꾼다.
 */

type Row = Record<string, unknown>;

const state = vi.hoisted(() => ({
  profiles: [] as Row[],
  attendances: [] as Row[],
  ledger: [] as Row[],
  rpcCalls: [] as Row[],
  audit: [] as Row[],
  rpcError: null as null | { code?: string; message: string },
}));

vi.mock("@/lib/auth/session", () => ({
  requireAdmin: vi.fn(async () => ({ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", email: "admin@example.com" })),
}));

vi.mock("@/lib/admin/audit", () => ({
  logAdminAction: vi.fn(async (args: Row) => {
    state.audit.push(args);
  }),
}));

vi.mock("@/lib/db/admin", () => {
  function table(name: string): Row[] {
    if (name === "profiles") return state.profiles;
    if (name === "attendances") return state.attendances;
    if (name === "point_ledger") return state.ledger;
    return [];
  }
  function from(name: string) {
    const filters: Array<(r: Row) => boolean> = [];
    let mode: "select" | "upsert" = "select";
    let upsertRows: Row[] = [];
    let single = false;
    let head = false;
    const run = () => {
      if (mode === "upsert") {
        // ON CONFLICT (user_id, checked_date) DO NOTHING — 실제로 들어간 행만 반환.
        const inserted: Row[] = [];
        for (const r of upsertRows) {
          const dup = state.attendances.some(
            (a) => a.user_id === r.user_id && a.checked_date === r.checked_date,
          );
          if (!dup) {
            state.attendances.push({ ...r });
            inserted.push({ ...r });
          }
        }
        return { data: inserted, error: null, count: null };
      }
      const rows = table(name).filter((r) => filters.every((f) => f(r)));
      if (head) return { data: null, error: null, count: rows.length };
      if (single) return { data: rows[0] ? { ...rows[0] } : null, error: null, count: null };
      return { data: rows.map((r) => ({ ...r })), error: null, count: null };
    };
    const b = {
      select: (_cols?: string, opts?: { head?: boolean }) => {
        if (opts?.head) head = true;
        return b;
      },
      upsert: (rows: Row[]) => {
        mode = "upsert";
        upsertRows = rows;
        return b;
      },
      eq: (col: string, value: unknown) => {
        filters.push((r) => r[col] === value);
        return b;
      },
      in: (col: string, values: unknown[]) => {
        filters.push((r) => values.includes(r[col]));
        return b;
      },
      maybeSingle: () => {
        single = true;
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
      rpc: async (fn: string, args: Row) => {
        state.rpcCalls.push({ fn, ...args });
        if (state.rpcError) return { data: null, error: state.rpcError };
        state.ledger.push({
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

import { POST } from "./route";

const USER = "11111111-1111-4111-8111-111111111111";
const GONE = "22222222-2222-4222-8222-222222222222";
const REASON = "출석 버튼 장애로 누락 — CS #42";

function attend(userId: string, monthKey: string, from: number, to: number) {
  for (let d = from; d <= to; d += 1) {
    state.attendances.push({
      user_id: userId,
      month_key: monthKey,
      checked_date: `${monthKey}-${String(d).padStart(2, "0")}`,
    });
  }
}

async function fill(body: Record<string, unknown>) {
  const req = new Request("https://100pbooks.vercel.app/api/admin/attendance/fill", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const res = await POST(req as never, { params: Promise.resolve({}) });
  return {
    status: res.status,
    json: (await res.json()) as { ok: boolean; data?: Record<string, unknown>; error?: { code: string } },
  };
}

beforeEach(() => {
  state.profiles = [
    { id: USER, email: "u@example.com", display_name: "회원", deleted_at: null },
    { id: GONE, email: null, display_name: null, deleted_at: "2026-10-01T00:00:00Z" },
  ];
  state.attendances = [];
  state.ledger = [];
  state.rpcCalls = [];
  state.audit = [];
  state.rpcError = null;
  vi.useFakeTimers();
  // KST 2026-11-06 10:00
  vi.setSystemTime(new Date("2026-11-06T01:00:00Z"));
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("이번 달 채우기", () => {
  it("어제(KST)까지의 미출석일만 넣고(오늘 제외), 보너스·일일 포인트는 주지 않는다", async () => {
    attend(USER, "2026-11", 2, 3);
    const { status, json } = await fill({ userId: USER, monthKey: "2026-11", reason: REASON });
    expect(status).toBe(200);
    expect(json.data).toMatchObject({
      monthStatus: "current",
      requiredDays: 30,
      attendedBefore: 2,
      attendedAfter: 5,
      filledCount: 3,
      filledDates: ["2026-11-01", "2026-11-04", "2026-11-05"],
      perfect: false,
      bonusPaid: false,
    });
    const novDates = state.attendances.filter((a) => a.user_id === USER).map((a) => a.checked_date as string);
    expect(novDates.every((d) => d < "2026-11-06")).toBe(true);
    expect(state.rpcCalls).toEqual([]); // 일일 +100P 도, 보너스도 없음
  });

  it("어제까지 다 찼으면(오늘 미출석이어도) 409 NOTHING_TO_FILL, 감사 로그 없음", async () => {
    attend(USER, "2026-11", 1, 5);
    const { status, json } = await fill({ userId: USER, monthKey: "2026-11", reason: REASON });
    expect(status).toBe(409);
    expect(json.error?.code).toBe("NOTHING_TO_FILL");
    expect(state.audit).toEqual([]);
  });
});

describe("지난 달 채우기", () => {
  it("만근이 되면 +1000P 만근 보너스를 같은 memo 로 지급하고 감사 로그를 남긴다", async () => {
    attend(USER, "2026-10", 1, 20);
    const { status, json } = await fill({ userId: USER, monthKey: "2026-10", reason: `  ${REASON}  ` });
    expect(status).toBe(200);
    expect(json.data).toMatchObject({
      monthStatus: "past",
      attendedBefore: 20,
      attendedAfter: 31,
      filledCount: 11,
      perfect: true,
      bonusPaid: true,
      bonusAlreadyPaid: false,
      bonusAmount: 1000,
      bonusError: null,
    });
    expect(state.rpcCalls).toEqual([
      {
        fn: "add_user_points_v2",
        p_user_id: USER,
        p_amount: 1000,
        p_reason: "attendance_bonus",
        p_ref_type: null,
        p_ref_id: null,
        p_memo: "2026-10 월 만근 보너스",
      },
    ]);
    expect(state.audit).toHaveLength(1);
    expect(state.audit[0]).toMatchObject({
      actor: { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", email: "admin@example.com" },
      action: "attendance.fill",
      targetType: "user",
      targetId: USER,
      details: {
        monthKey: "2026-10",
        reason: REASON, // trim 된 값
        filledCount: 11,
        bonusPaid: true,
        bonusAmount: 1000,
      },
    });
  });

  it("다시 눌러도 보너스는 1회만 — 두 번째는 409 NOTHING_TO_FILL", async () => {
    attend(USER, "2026-10", 1, 5);
    const first = await fill({ userId: USER, monthKey: "2026-10", reason: REASON });
    expect(first.json.data).toMatchObject({ bonusPaid: true });
    const second = await fill({ userId: USER, monthKey: "2026-10", reason: REASON });
    expect(second.status).toBe(409);
    expect(second.json.error?.code).toBe("NOTHING_TO_FILL");
    expect(state.rpcCalls).toHaveLength(1);
  });

  it("그 달 폐지된 20일 보너스를 이미 받았으면 날짜만 채우고 보너스는 주지 않는다", async () => {
    attend(USER, "2026-10", 1, 22);
    state.ledger.push({ user_id: USER, reason: "attendance_bonus", memo: "2026-10 월 출석 보너스 (20일+)" });
    const { json } = await fill({ userId: USER, monthKey: "2026-10", reason: REASON });
    expect(json.data).toMatchObject({ filledCount: 9, perfect: true, bonusPaid: false, bonusAlreadyPaid: true });
    expect(state.rpcCalls).toEqual([]);
  });

  it("폐지된 10일 보너스는 만근 보너스를 막지 않는다", async () => {
    attend(USER, "2026-10", 1, 12);
    state.ledger.push({ user_id: USER, reason: "attendance_bonus", memo: "2026-10 10일 달성 보너스" });
    const { json } = await fill({ userId: USER, monthKey: "2026-10", reason: REASON });
    expect(json.data).toMatchObject({ bonusPaid: true });
  });

  it("이미 만근인데 보너스가 빠진 지난 달 → 날짜 없이 보너스만 지급", async () => {
    attend(USER, "2026-09", 1, 30);
    const { json } = await fill({ userId: USER, monthKey: "2026-09", reason: REASON });
    expect(json.data).toMatchObject({ filledCount: 0, perfect: true, bonusPaid: true });
  });

  it("RPC 23505(cron·다른 관리자와 경합) → 이미 지급으로 처리", async () => {
    attend(USER, "2026-10", 1, 29);
    state.rpcError = { code: "23505", message: "duplicate key" };
    const { status, json } = await fill({ userId: USER, monthKey: "2026-10", reason: REASON });
    expect(status).toBe(200);
    expect(json.data).toMatchObject({ bonusPaid: false, bonusAlreadyPaid: true, bonusError: null });
  });

  it("RPC 실패 → 출석은 반영, bonusError 반환·감사 로그 기록", async () => {
    attend(USER, "2026-10", 1, 29);
    state.rpcError = { message: "timeout" };
    const { status, json } = await fill({ userId: USER, monthKey: "2026-10", reason: REASON });
    expect(status).toBe(200);
    expect(json.data).toMatchObject({ filledCount: 2, bonusPaid: false, bonusError: "timeout" });
    expect(state.audit[0]).toMatchObject({ details: { bonusPaid: false, bonusError: "timeout" } });
  });
});

describe("거부", () => {
  it.each([
    ["사유 없음", { userId: USER, monthKey: "2026-10" }],
    ["사유 1자(trim 후)", { userId: USER, monthKey: "2026-10", reason: "  가 " }],
    ["사유 201자", { userId: USER, monthKey: "2026-10", reason: "가".repeat(201) }],
    ["형식 오류 월", { userId: USER, monthKey: "2026-13", reason: REASON }],
    ["userId 형식 오류", { userId: "nope", monthKey: "2026-10", reason: REASON }],
  ])("%s → 400 INVALID_BODY", async (_label, body) => {
    const { status, json } = await fill(body);
    expect(status).toBe(400);
    expect(json.error?.code).toBe("INVALID_BODY");
    expect(state.attendances).toEqual([]);
  });

  it("미래 월 → 400 INVALID_MONTH", async () => {
    const { status, json } = await fill({ userId: USER, monthKey: "2026-12", reason: REASON });
    expect(status).toBe(400);
    expect(json.error?.code).toBe("INVALID_MONTH");
  });

  it("탈퇴(익명화) 회원 → 409 USER_DELETED, 아무것도 쓰지 않음", async () => {
    const { status, json } = await fill({ userId: GONE, monthKey: "2026-10", reason: REASON });
    expect(status).toBe(409);
    expect(json.error?.code).toBe("USER_DELETED");
    expect(state.attendances).toEqual([]);
    expect(state.audit).toEqual([]);
  });

  it("없는 회원 → 404", async () => {
    const { status } = await fill({
      userId: "33333333-3333-4333-8333-333333333333",
      monthKey: "2026-10",
      reason: REASON,
    });
    expect(status).toBe(404);
  });
});

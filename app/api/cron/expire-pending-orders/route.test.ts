// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * GET /api/cron/expire-pending-orders (DEBT-6).
 *
 * 인증은 실제 lib/security/cron-auth 를 쓰고, service_role 클라이언트만 인메모리 orders 테이블로
 * 바꾼다. 필터(eq/is/not/lt/in)를 실제로 평가하므로 라우트가 결제 키·생성 시각 조건을 빠뜨리면
 * 엉뚱한 주문이 취소돼 테스트가 실패한다. 토스 원장 조회(probeTossOrder)는 toss_order_id 별로
 * 정해 둔 응답을 돌려주는 가짜로 바꾼다.
 */

import type { TossOrderProbe } from "@/lib/orders/toss-order-probe";

type Row = Record<string, unknown>;

const state = vi.hoisted(() => ({
  orders: [] as Array<Record<string, unknown>>,
  updates: 0,
  probes: {} as Record<string, TossOrderProbe>,
  probeCalls: [] as Array<string | null>,
}));

vi.mock("@/lib/orders/toss-order-probe", () => ({
  probeTossOrder: vi.fn(async (tossOrderId: string | null): Promise<TossOrderProbe> => {
    state.probeCalls.push(tossOrderId);
    return (
      (tossOrderId ? state.probes[tossOrderId] : undefined) ?? {
        kind: "no_payment",
        reason: "not_found",
      }
    );
  }),
}));

function compare(a: unknown, b: unknown): number {
  const ta = typeof a === "string" ? Date.parse(a) : NaN;
  const tb = typeof b === "string" ? Date.parse(b) : NaN;
  if (Number.isFinite(ta) && Number.isFinite(tb)) return ta - tb;
  return String(a).localeCompare(String(b));
}

function table(name: string) {
  if (name !== "orders") throw new Error(`unexpected table ${name}`);
  const filters: Array<(r: Row) => boolean> = [];
  let action: "select" | "update" = "select";
  let values: Row = {};
  let head = false;
  let limit: number | null = null;
  let orderBy: { col: string; asc: boolean } | null = null;

  const run = () => {
    const hits = state.orders.filter((r) => filters.every((f) => f(r)));
    if (action === "update") {
      state.updates += 1;
      for (const r of hits) Object.assign(r, values);
      return { data: hits.map((r) => ({ id: r.id })), error: null, count: null };
    }
    let out = [...hits];
    if (orderBy) {
      const { col, asc } = orderBy;
      out.sort((x, y) => (asc ? 1 : -1) * compare(x[col], y[col]));
    }
    if (limit !== null) out = out.slice(0, limit);
    return head
      ? { data: null, error: null, count: hits.length }
      : { data: out.map((r) => ({ ...r })), error: null, count: null };
  };

  const b = {
    select(_cols?: string, opts?: { head?: boolean }) {
      head = opts?.head ?? false;
      return b;
    },
    update(v: Row) {
      action = "update";
      values = v;
      return b;
    },
    eq(col: string, v: unknown) {
      filters.push((r) => r[col] === v);
      return b;
    },
    is(col: string, v: null) {
      filters.push((r) => r[col] === v);
      return b;
    },
    not(col: string, op: string, v: null) {
      if (op !== "is") throw new Error(`unsupported not(${op})`);
      filters.push((r) => r[col] !== v);
      return b;
    },
    lt(col: string, v: string) {
      filters.push((r) => compare(r[col], v) < 0);
      return b;
    },
    in(col: string, vs: unknown[]) {
      filters.push((r) => vs.includes(r[col]));
      return b;
    },
    order(col: string, opts: { ascending: boolean }) {
      orderBy = { col, asc: opts.ascending };
      return b;
    },
    limit(n: number) {
      limit = n;
      return b;
    },
    then<T>(resolve: (v: ReturnType<typeof run>) => T, reject?: (e: unknown) => T) {
      return Promise.resolve().then(run).then(resolve, reject);
    },
  };
  return b;
}

vi.mock("@/lib/db/admin", () => ({
  createAdminSupabase: () => ({ from: (name: string) => table(name) }),
}));

import { GET } from "./route";

const HOUR = 3_600_000;
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

function req(query = "", auth = "Bearer test-cron-secret") {
  return new Request(`https://100p.test/api/cron/expire-pending-orders${query}`, {
    headers: auth ? { authorization: auth } : {},
  });
}

type Body = {
  ok: boolean;
  data?: {
    dryRun: boolean;
    expired?: number;
    wouldExpire?: number;
    sample?: string[];
    paymentFound: number;
    paymentFoundSample: Array<{ orderId: string; tossStatus: string }>;
    probeFailed: number;
    probeDeferred: number;
    staleWithPaymentKey: number;
    truncated: boolean;
  };
  error?: { code: string };
};

beforeEach(() => {
  vi.stubEnv("CRON_SECRET", "test-cron-secret");
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  state.updates = 0;
  state.probes = {};
  state.probeCalls = [];
  const order = (id: string, status: string, key: string | null, createdMsAgo: number) => ({
    id,
    status,
    toss_payment_key: key,
    toss_order_id: `toss-${id}`,
    created_at: ago(createdMsAgo),
  });
  state.orders = [
    order("old-no-key", "pending", null, 25 * HOUR),
    order("old-no-key-2", "pending", null, 72 * HOUR),
    order("old-with-key", "pending", "tgen_key", 30 * HOUR),
    order("recent-no-key", "pending", null, 2 * HOUR),
    order("old-paid", "paid", "tgen_paid", 48 * HOUR),
    order("old-cancelled", "cancelled", null, 48 * HOUR),
  ];
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const statusOf = (id: string) => state.orders.find((o) => o.id === id)?.status;

describe("GET /api/cron/expire-pending-orders", () => {
  it("Bearer CRON_SECRET 가 없으면 401 이고 아무것도 바꾸지 않는다", async () => {
    const res = await GET(req("", ""));
    expect(res.status).toBe(401);
    expect(state.updates).toBe(0);
  });

  it("결제 키 없는 24시간 초과 pending 만 cancelled 로 바꾸고, 결제 키 있는 건수를 보고한다", async () => {
    const res = await GET(req());
    const body = (await res.json()) as Body;
    expect(res.status).toBe(200);
    expect(body.data).toMatchObject({
      dryRun: false,
      expired: 2,
      paymentFound: 0,
      probeFailed: 0,
      probeDeferred: 0,
      staleWithPaymentKey: 1,
    });
    // 토스 조회는 만료 후보에만 — 결제 키 있는 주문·최근 주문·다른 상태는 조회하지 않는다.
    expect([...state.probeCalls].sort()).toEqual(["toss-old-no-key", "toss-old-no-key-2"]);

    expect(statusOf("old-no-key")).toBe("cancelled");
    expect(statusOf("old-no-key-2")).toBe("cancelled");
    expect(statusOf("old-with-key")).toBe("pending");
    expect(statusOf("recent-no-key")).toBe("pending");
    expect(statusOf("old-paid")).toBe("paid");
    expect(console.warn).toHaveBeenCalledOnce(); // staleWithPaymentKey(데이터 이상) 경고
    expect(console.error).not.toHaveBeenCalled();
  });

  it("토스에 결제 기록이 있는 pending(캡처 후 반영 실패)은 취소하지 않고 console.error 로 보고한다", async () => {
    state.probes["toss-old-no-key-2"] = { kind: "payment_found", tossStatus: "DONE" };
    const res = await GET(req());
    const body = (await res.json()) as Body;
    expect(body.data).toMatchObject({
      expired: 1,
      paymentFound: 1,
      paymentFoundSample: [{ orderId: "old-no-key-2", tossStatus: "DONE" }],
    });
    expect(statusOf("old-no-key-2")).toBe("pending");
    expect(statusOf("old-no-key")).toBe("cancelled");
    expect(console.error).toHaveBeenCalledOnce();
  });

  it("토스 조회가 실패하면 취소하지 않고 probeFailed 로 집계한다 (fail-closed)", async () => {
    state.probes["toss-old-no-key"] = { kind: "unavailable", code: "TOSS_TIMEOUT", message: "t" };
    state.probes["toss-old-no-key-2"] = {
      kind: "unavailable",
      code: "TOSS_SECRET_MISSING",
      message: "no key",
    };
    const res = await GET(req());
    const body = (await res.json()) as Body;
    expect(body.data).toMatchObject({ expired: 0, probeFailed: 2 });
    expect(state.updates).toBe(0);
    expect(statusOf("old-no-key")).toBe("pending");
    expect(statusOf("old-no-key-2")).toBe("pending");
  });

  it("?dryRun=1 은 상태를 바꾸지 않고 예정 건수·샘플만 반환", async () => {
    const res = await GET(req("?dryRun=1"));
    const body = (await res.json()) as Body;
    expect(body.data).toMatchObject({ dryRun: true, wouldExpire: 2 });
    // dryRun 도 토스 조회(읽기 전용)는 한다 — 켜기 전에 결제 기록 있는 pending 을 발견하기 위해.
    expect(state.probeCalls).toHaveLength(2);
    expect(body.data?.sample).toEqual(["old-no-key-2", "old-no-key"]);
    expect(state.updates).toBe(0);
    expect(statusOf("old-no-key")).toBe("pending");
  });

  it("다시 실행해도 추가로 바뀌는 것이 없다 (멱등)", async () => {
    await GET(req());
    const res = await GET(req());
    const body = (await res.json()) as Body;
    expect(body.data?.expired).toBe(0);
  });

  it("배치 한도(PENDING_ORDER_EXPIRY_BATCH)에 걸리면 오래된 순으로 처리하고 truncated", async () => {
    vi.stubEnv("PENDING_ORDER_EXPIRY_BATCH", "1");
    const res = await GET(req());
    const body = (await res.json()) as Body;
    expect(body.data).toMatchObject({ expired: 1, truncated: true });
    expect(statusOf("old-no-key-2")).toBe("cancelled");
    expect(statusOf("old-no-key")).toBe("pending");
  });
});

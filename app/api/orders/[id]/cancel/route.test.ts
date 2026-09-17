// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * POST /api/orders/[id]/cancel — 사용자 대기 주문 취소 (DEBT-6).
 *
 * orders 는 인메모리 행 하나로 두고, service_role UPDATE 는 걸린 필터를 실제로 평가한다
 * (status='pending' · toss_payment_key IS NULL · user_id 조건이 빠지면 테스트가 실패하도록).
 * 토스 원장 조회(probeTossOrder)만 가짜로 바꾸고 판정(probeCancelVerdict)은 실제 구현을 쓴다.
 */

import type * as ProbeModule from "@/lib/orders/toss-order-probe";
import type { TossOrderProbe } from "@/lib/orders/toss-order-probe";

type OrderRow = {
  id: string;
  user_id: string;
  status: string;
  toss_payment_key: string | null;
  toss_order_id: string | null;
};

const ORDER_ID = "0c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f";

const state = vi.hoisted(() => ({
  order: null as OrderRow | null,
  /** 라우트가 SELECT 한 뒤 UPDATE 직전에 끼어드는 변경(결제 confirm 경합 흉내). */
  beforeUpdate: null as null | ((o: OrderRow) => void),
  updates: [] as Array<{ values: Record<string, unknown>; filters: string[] }>,
  activeUserError: null as null | (Error & { status?: number; code?: string }),
  probe: { kind: "no_payment", reason: "not_found" } as TossOrderProbe,
  probeCalls: [] as Array<string | null>,
}));

vi.mock("@/lib/orders/toss-order-probe", async (importOriginal) => {
  const actual = await importOriginal<typeof ProbeModule>();
  return {
    ...actual,
    probeTossOrder: vi.fn(async (tossOrderId: string | null) => {
      state.probeCalls.push(tossOrderId);
      return state.probe;
    }),
  };
});

vi.mock("@/lib/auth/session", () => ({
  requireUser: vi.fn(async () => {
    throw new Error("cancel must use requireActiveUser");
  }),
  requireActiveUser: vi.fn(async () => {
    if (state.activeUserError) throw state.activeUserError;
    return { id: "user-1", email: "me@example.com" };
  }),
}));

vi.mock("@/lib/db/server", () => ({
  createServerSupabase: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            // RLS 흉내: 본인 주문이 아니어도 테스트에서는 행을 돌려 403 분기를 검증한다.
            data: state.order ? { ...state.order } : null,
            error: null,
          }),
        }),
      }),
    }),
  }),
}));

vi.mock("@/lib/db/admin", () => ({
  createAdminSupabase: () => ({
    from: (table: string) => {
      if (table !== "orders") throw new Error(`unexpected table ${table}`);
      const filters: Array<(o: OrderRow) => boolean> = [];
      const labels: string[] = [];
      let values: Record<string, unknown> | null = null;
      const builder = {
        update(v: Record<string, unknown>) {
          values = v;
          return builder;
        },
        select() {
          return builder;
        },
        eq(col: keyof OrderRow, v: unknown) {
          labels.push(`eq(${col},${String(v)})`);
          filters.push((o) => o[col] === v);
          return builder;
        },
        is(col: keyof OrderRow, v: null) {
          labels.push(`is(${col},${String(v)})`);
          filters.push((o) => o[col] === v);
          return builder;
        },
        async maybeSingle() {
          if (values) {
            if (state.order && state.beforeUpdate) {
              state.beforeUpdate(state.order);
              state.beforeUpdate = null;
            }
            state.updates.push({ values, filters: labels });
            const hit = state.order && filters.every((f) => f(state.order as OrderRow));
            if (hit && state.order) {
              state.order = { ...state.order, ...(values as Partial<OrderRow>) };
              return { data: { id: state.order.id }, error: null };
            }
            return { data: null, error: null };
          }
          const hit = state.order && filters.every((f) => f(state.order as OrderRow));
          return { data: hit ? { ...state.order } : null, error: null };
        },
      };
      return builder;
    },
  }),
}));

import { POST } from "./route";

type Body = {
  ok: boolean;
  data?: { orderId: string; status: string; alreadyCancelled: boolean };
  error?: { code: string; message: string };
};

async function call(id = ORDER_ID) {
  const res = await POST(
    new Request(`https://100p.test/api/orders/${id}/cancel`, { method: "POST" }),
    { params: { id } },
  );
  return { status: res.status, body: (await res.json()) as Body };
}

beforeEach(() => {
  state.order = {
    id: ORDER_ID,
    user_id: "user-1",
    status: "pending",
    toss_payment_key: null,
    toss_order_id: "100p-toss-order-1",
  };
  state.beforeUpdate = null;
  state.updates = [];
  state.activeUserError = null;
  state.probe = { kind: "no_payment", reason: "not_found" };
  state.probeCalls = [];
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("POST /api/orders/[id]/cancel", () => {
  it("결제 키 없는 본인 pending 주문을 토스 확인(결제 없음) 후 조건부 UPDATE 로 cancelled 전이", async () => {
    const { status, body } = await call();
    expect(status).toBe(200);
    expect(state.probeCalls).toEqual(["100p-toss-order-1"]);
    expect(body.data).toEqual({ orderId: ORDER_ID, status: "cancelled", alreadyCancelled: false });
    expect(state.order?.status).toBe("cancelled");
    expect(state.updates).toHaveLength(1);
    expect(state.updates[0]?.values).toEqual({ status: "cancelled" });
    expect(state.updates[0]?.filters).toEqual([
      `eq(id,${ORDER_ID})`,
      "eq(user_id,user-1)",
      "eq(status,pending)",
      "is(toss_payment_key,null)",
    ]);
  });

  it("이미 cancelled 면 토스 조회·UPDATE 없이 성공 (멱등)", async () => {
    state.order = { ...state.order!, status: "cancelled" };
    const { status, body } = await call();
    expect(status).toBe(200);
    expect(body.data?.alreadyCancelled).toBe(true);
    expect(state.updates).toHaveLength(0);
    expect(state.probeCalls).toHaveLength(0);
  });

  it.each(["DONE", "IN_PROGRESS", "WAITING_FOR_DEPOSIT", "CANCELED"])(
    "토스에 결제 기록(%s)이 있으면 — DB 는 pending·키 없음이어도 — 409 이고 UPDATE 0건",
    async (tossStatus) => {
      // confirm 이 토스 캡처 후 클레임 UPDATE 에 실패해 남은 주문 (리뷰 must_fix 재현).
      state.probe = { kind: "payment_found", tossStatus };
      const { status, body } = await call();
      expect(status).toBe(409);
      expect(body.error?.code).toBe("PAYMENT_IN_PROGRESS");
      expect(state.updates).toHaveLength(0);
      expect(state.order?.status).toBe("pending");
      expect(console.error).toHaveBeenCalledOnce();
    },
  );

  it("토스 조회가 실패하면 503 PAYMENT_STATUS_UNAVAILABLE 이고 UPDATE 0건 (fail-closed)", async () => {
    state.probe = { kind: "unavailable", code: "TOSS_TIMEOUT", message: "timeout" };
    const { status, body } = await call();
    expect(status).toBe(503);
    expect(body.error?.code).toBe("PAYMENT_STATUS_UNAVAILABLE");
    expect(state.updates).toHaveLength(0);
    expect(state.order?.status).toBe("pending");
  });

  it.each([
    { kind: "no_payment", reason: "aborted" },
    { kind: "no_payment", reason: "expired" },
    { kind: "no_payment", reason: "no_toss_order_id" },
  ] as TossOrderProbe[])("토스 판정 %o 이면 취소한다", async (probe) => {
    state.probe = probe;
    const { status } = await call();
    expect(status).toBe(200);
    expect(state.order?.status).toBe("cancelled");
  });

  it("(방어 분기) 결제 키가 있는 pending 은 토스 조회 없이 409 PAYMENT_IN_PROGRESS, 상태 유지", async () => {
    // 현재 결제 키는 paid 전이와 같은 UPDATE 에서만 기록돼 이 조합은 생기지 않는다 — 데이터 이상 대비.
    state.order = { ...state.order!, toss_payment_key: "tgen_key" };
    const { status, body } = await call();
    expect(status).toBe(409);
    expect(body.error?.code).toBe("PAYMENT_IN_PROGRESS");
    expect(state.updates).toHaveLength(0);
    expect(state.order?.status).toBe("pending");
    expect(state.probeCalls).toHaveLength(0);
  });

  it("결제 완료 주문은 토스 조회 없이 409 ORDER_NOT_CANCELLABLE", async () => {
    state.order = { ...state.order!, status: "paid", toss_payment_key: "tgen_key" };
    const { status, body } = await call();
    expect(status).toBe(409);
    expect(body.error?.code).toBe("ORDER_NOT_CANCELLABLE");
    expect(state.updates).toHaveLength(0);
    expect(state.probeCalls).toHaveLength(0);
  });

  it("남의 주문은 403, 없는 주문은 404, 잘못된 id 는 400", async () => {
    state.order = { ...state.order!, user_id: "someone-else" };
    expect((await call()).status).toBe(403);
    expect(state.updates).toHaveLength(0);
    expect(state.probeCalls).toHaveLength(0);

    state.order = null;
    expect((await call()).status).toBe(404);

    expect((await call("not-a-uuid")).status).toBe(400);
  });

  it("경합: 판정 후 confirm 이 먼저 paid 로 클레임하면 UPDATE 가 빗나가고 409 로 응답", async () => {
    state.beforeUpdate = (o) => {
      o.status = "paid";
      o.toss_payment_key = "tgen_key";
    };
    const { status, body } = await call();
    expect(status).toBe(409);
    expect(body.error?.code).toBe("ORDER_NOT_CANCELLABLE");
    expect(state.order?.status).toBe("paid");
  });

  it("(방어) 경합: 판정 후 결제 키만 붙어도(pending 유지) UPDATE 가 빗나가 409 PAYMENT_IN_PROGRESS", async () => {
    state.beforeUpdate = (o) => {
      o.toss_payment_key = "tgen_key";
    };
    const { status, body } = await call();
    expect(status).toBe(409);
    expect(body.error?.code).toBe("PAYMENT_IN_PROGRESS");
    expect(state.order?.status).toBe("pending");
  });

  it("경합: 다른 취소 요청이 먼저 끝났으면 성공(멱등)으로 응답", async () => {
    state.beforeUpdate = (o) => {
      o.status = "cancelled";
    };
    const { status, body } = await call();
    expect(status).toBe(200);
    expect(body.data?.alreadyCancelled).toBe(true);
  });

  it("탈퇴 처리 중 계정은 requireActiveUser 가 막는다 (410)", async () => {
    state.activeUserError = Object.assign(new Error("탈퇴 처리 중"), {
      status: 410,
      code: "ACCOUNT_DELETED",
    });
    const { status, body } = await call();
    expect(status).toBe(410);
    expect(body.error?.code).toBe("ACCOUNT_DELETED");
    expect(state.updates).toHaveLength(0);
    expect(state.probeCalls).toHaveLength(0);
  });
});

// @vitest-environment node
import type { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * /api/admin/orders/:id/refund 라우트 흐름.
 *
 *   - 권한: requireAdmin 실패 → 토스·DB 무접촉.
 *   - paid 전액 환불: 토스 취소 1회 → refunded 조건부 전이 → 포인트·할인 복원 1회 → 감사 로그.
 *   - 토스 조회/취소 실패 시 주문 상태 불변.
 *   - 제작 이후 상태는 force + 사유 필요.
 *   - 동시 중복 요청·웹훅 선반영: 토스 실제 취소 1회, 복원 1회, 모두 성공으로 수렴.
 *
 * 토스 클라이언트(lib/payments/toss-cancel)는 인메모리 결제로, service_role 클라이언트는
 * eq/in 필터를 흉내 내는 인메모리 테이블로 바꾼다.
 */

type Row = Record<string, unknown>;
type Filter = { op: "eq" | "in"; column: string; value: unknown };

const ORDER_ID = "11111111-2222-3333-4444-555555555555";
const PAYMENT_KEY = "pay_key_123";

const state = vi.hoisted(() => ({
  tables: {} as Record<string, Array<Record<string, unknown>>>,
  toss: {
    status: "DONE",
    totalAmount: 30000,
    orderId: "toss-order-1",
    method: "카드",
  } as { status: string; totalAmount: number; orderId: string; method: string },
  /** 토스에서 실제로 DONE → CANCELED 가 일어난 횟수. */
  tossCancellations: 0,
  cancelCalls: [] as Array<{ paymentKey: string; cancelReason: string; idempotencyKey: string }>,
  getError: null as null | { code: string; message: string; status: number },
  cancelError: null as null | { code: string; message: string; status: number },
  /** 취소 직후(응답 전) 실행 — 웹훅 선반영 흉내 등. */
  afterCancel: null as null | (() => void),
  failOrderUpdate: false,
  restoreCalls: [] as unknown[],
  restoreThrows: false,
  /** restoreOrderCredits 반환값 덮어쓰기 — null 이면 주문 값대로 복원 성공. */
  restoreResult: null as null | Record<string, unknown>,
  audits: [] as Array<{ action: string; details?: Record<string, unknown> }>,
  emails: [] as Array<{ template: string; to: { email: string } }>,
  adminError: null as null | Error,
}));

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

vi.mock("@/lib/auth/session", () => ({
  requireAdmin: vi.fn(async () => {
    if (state.adminError) throw state.adminError;
    return { id: "admin-1", email: "admin@example.com" };
  }),
}));

vi.mock("@/lib/payments/toss-cancel", async () => {
  const { TossError } = await import("@/lib/payments/toss");
  const snapshot = () => ({ paymentKey: PAYMENT_KEY, ...state.toss });
  return {
    refundIdempotencyKey: (orderId: string) => `100p-refund-full-${orderId}`,
    getTossPayment: vi.fn(async () => {
      await tick();
      if (state.getError) throw new TossError(state.getError);
      return snapshot();
    }),
    // 실제 클라이언트와 같은 수렴 규칙: DONE → 취소, 이미 CANCELED → already_canceled.
    cancelTossPaymentFully: vi.fn(
      async (args: { paymentKey: string; cancelReason: string; idempotencyKey: string }) => {
        state.cancelCalls.push(args);
        await tick();
        if (state.cancelError) throw new TossError(state.cancelError);
        let outcome: "canceled" | "already_canceled" = "already_canceled";
        if (state.toss.status === "DONE") {
          state.toss.status = "CANCELED";
          state.tossCancellations += 1;
          outcome = "canceled";
        }
        state.afterCancel?.();
        await tick();
        return { outcome, payment: snapshot() };
      },
    ),
  };
});

/** 최소 PostgREST 흉내: select/update + eq/in + maybeSingle + head count. 매 호출 tick 으로 인터리빙. */
function tableBuilder(table: string) {
  let action: "select" | "update" = "select";
  let payload: Row = {};
  let head = false;
  const filters: Filter[] = [];

  const matches = (row: Row) =>
    filters.every((f) =>
      f.op === "eq" ? row[f.column] === f.value : (f.value as unknown[]).includes(row[f.column]),
    );

  const exec = (): { data: Row[] | null; error: { message: string } | null } => {
    const rows = state.tables[table] ?? [];
    if (action === "update") {
      if (table === "orders" && state.failOrderUpdate) {
        return { data: null, error: { message: "update failed" } };
      }
      // 필터 판정 + 쓰기를 한 동기 구간에서 — Postgres 조건부 UPDATE 의 원자성 흉내.
      const hit = rows.filter(matches);
      for (const r of hit) Object.assign(r, payload);
      return { data: hit.map((r) => ({ ...r })), error: null };
    }
    return { data: rows.filter(matches).map((r) => ({ ...r })), error: null };
  };

  const builder = {
    select(_cols?: string, opts?: { head?: boolean }) {
      if (opts?.head) head = true;
      return builder;
    },
    update(values: Row) {
      action = "update";
      payload = values;
      return builder;
    },
    eq(column: string, value: unknown) {
      filters.push({ op: "eq", column, value });
      return builder;
    },
    in(column: string, value: unknown[]) {
      filters.push({ op: "in", column, value });
      return builder;
    },
    async maybeSingle() {
      await tick();
      const r = exec();
      return { data: r.data?.[0] ?? null, error: r.error };
    },
    then<T>(resolve: (v: unknown) => T, reject?: (e: unknown) => T) {
      return tick()
        .then(() => {
          const r = exec();
          return head ? { data: null, count: r.data?.length ?? 0, error: r.error } : r;
        })
        .then(resolve, reject);
    },
  };
  return builder;
}

vi.mock("@/lib/db/admin", () => ({
  createAdminSupabase: () => ({ from: (table: string) => tableBuilder(table) }),
}));

vi.mock("@/lib/orders/refund", () => ({
  // 실제 계약: throw 하지 않고 ReleaseCreditsResult 를 돌려준다(실제로 되돌린 양).
  restoreOrderCredits: vi.fn(
    async (
      _admin: unknown,
      order: { points_used: number; discount_code_id: string | null },
    ) => {
      state.restoreCalls.push(order);
      if (state.restoreThrows) throw new Error("points rpc failed");
      return (
        state.restoreResult ?? {
          ok: true,
          mode: "atomic",
          pointsRestored: order.points_used,
          discountUsesRestored: order.discount_code_id ? 1 : 0,
        }
      );
    },
  ),
}));

vi.mock("@/lib/admin/audit", () => ({
  logAdminAction: vi.fn(async (args: { action: string; details?: Record<string, unknown> }) => {
    state.audits.push({ action: args.action, details: args.details });
  }),
}));

vi.mock("@/lib/email/queue", () => ({
  enqueueEmail: vi.fn(async (args: { template: string; to: { email: string } }) => {
    state.emails.push(args);
    return { ok: true, jobId: "j", sent: false };
  }),
}));

import { GET, POST } from "./route";

const ctx = { params: { id: ORDER_ID } };

function post(body: Record<string, unknown> = {}) {
  const req = new Request(`https://100pbooks.vercel.app/api/admin/orders/${ORDER_ID}/refund`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return POST(req as unknown as NextRequest, ctx);
}

function get() {
  const req = new Request(`https://100pbooks.vercel.app/api/admin/orders/${ORDER_ID}/refund`);
  return GET(req as unknown as NextRequest, ctx);
}

type Json = {
  ok: boolean;
  data?: Record<string, unknown>;
  error?: { code: string; message: string };
};
const body = async (res: Response) => (await res.json()) as Json;

const order = () => state.tables.orders![0]!;

beforeEach(() => {
  state.tables = {
    orders: [
      {
        id: ORDER_ID,
        status: "paid",
        amount: 30000,
        user_id: "user-1",
        qty: 1,
        project_id: "proj-1",
        address: { name: "홍길동" },
        points_used: 2000,
        discount_code_id: "dc-1",
        discount_amount: 3000,
        toss_payment_key: PAYMENT_KEY,
        toss_order_id: "toss-order-1",
      },
    ],
    profiles: [{ id: "user-1", email: "me@example.com", display_name: "길동" }],
    projects: [{ id: "proj-1", title: "여름", book_size_id: "bs-1" }],
    pages: [
      { id: "pg-1", project_id: "proj-1" },
      { id: "pg-2", project_id: "proj-1" },
    ],
    book_sizes: [{ id: "bs-1", name: "A5" }],
  };
  state.toss = { status: "DONE", totalAmount: 30000, orderId: "toss-order-1", method: "카드" };
  state.tossCancellations = 0;
  state.cancelCalls = [];
  state.getError = null;
  state.cancelError = null;
  state.afterCancel = null;
  state.failOrderUpdate = false;
  state.restoreCalls = [];
  state.restoreThrows = false;
  state.restoreResult = null;
  state.audits = [];
  state.emails = [];
  state.adminError = null;
});

describe("POST /api/admin/orders/:id/refund", () => {
  it("권한 없음 → 403, 토스·DB 무접촉", async () => {
    state.adminError = Object.assign(new Error("관리자 권한이 필요합니다."), {
      status: 403,
      code: "FORBIDDEN",
    });
    const res = await post();
    expect(res.status).toBe(403);
    expect((await body(res)).error?.code).toBe("FORBIDDEN");
    expect(state.cancelCalls).toHaveLength(0);
    expect(order().status).toBe("paid");
    expect(state.restoreCalls).toHaveLength(0);
  });

  it("paid 성공: 토스 전액 취소 1회 → refunded → 복원 1회 → 감사 로그·고객 메일", async () => {
    const res = await post();
    const json = await body(res);
    expect(res.status).toBe(200);
    expect(json.data).toMatchObject({
      item: { id: ORDER_ID, status: "refunded" },
      tossOutcome: "canceled",
      claimed: true,
      alreadyRefunded: false,
      toss: { status: "CANCELED", method: "카드", totalAmount: 30000 },
    });

    expect(state.tossCancellations).toBe(1);
    expect(state.cancelCalls).toEqual([
      {
        paymentKey: PAYMENT_KEY,
        cancelReason: "고객 요청 전액 환불",
        idempotencyKey: `100p-refund-full-${ORDER_ID}`,
      },
    ]);
    expect(order().status).toBe("refunded");
    expect(state.restoreCalls).toEqual([
      { id: ORDER_ID, user_id: "user-1", points_used: 2000, discount_code_id: "dc-1" },
    ]);
    expect(state.audits).toHaveLength(1);
    expect(state.audits[0]).toMatchObject({
      action: "order.refund",
      details: {
        from: "paid",
        to: "refunded",
        amount: 30000,
        method: "카드",
        tossOutcome: "canceled",
        claimed: true,
        pointsRestored: 2000,
        discountRestored: true,
      },
    });
    expect(state.emails).toHaveLength(1);
    expect(state.emails[0]).toMatchObject({
      template: "order.refunded",
      to: { email: "me@example.com", name: "홍길동" },
    });
  });

  it("관리자 사유는 토스 cancelReason 과 감사 로그에 실린다", async () => {
    const res = await post({ reason: "고객 단순 변심" });
    expect(res.status).toBe(200);
    expect(state.cancelCalls[0]?.cancelReason).toBe("고객 단순 변심");
    expect(state.audits[0]?.details).toMatchObject({ reason: "고객 단순 변심" });
  });

  it("토스 취소 실패 → 상태 불변·복원 없음, 에러 코드 전달 + 실패 감사 로그", async () => {
    state.cancelError = {
      code: "NOT_CANCELABLE_PAYMENT",
      message: "취소 할 수 없는 결제 입니다",
      status: 400,
    };
    const res = await post();
    expect(res.status).toBe(400);
    expect((await body(res)).error?.code).toBe("NOT_CANCELABLE_PAYMENT");
    expect(order().status).toBe("paid");
    expect(state.restoreCalls).toHaveLength(0);
    expect(state.emails).toHaveLength(0);
    expect(state.audits.map((a) => a.action)).toEqual(["order.refund_failed"]);
  });

  it("토스 타임아웃 → 504, 상태 불변", async () => {
    state.cancelError = { code: "TOSS_TIMEOUT", message: "시간 초과", status: 504 };
    const res = await post();
    expect(res.status).toBe(504);
    expect(order().status).toBe("paid");
    expect(state.restoreCalls).toHaveLength(0);
  });

  it("같은 멱등 키가 처리 중(IDEMPOTENT_REQUEST_PROCESSING) → 409 REFUND_IN_PROGRESS, 상태 불변", async () => {
    state.cancelError = {
      code: "IDEMPOTENT_REQUEST_PROCESSING",
      message: "처리 중",
      status: 409,
    };
    const res = await post();
    expect(res.status).toBe(409);
    expect((await body(res)).error?.code).toBe("REFUND_IN_PROGRESS");
    expect(order().status).toBe("paid");
  });

  it("토스 사전 조회 실패 → 취소 호출 없음, 상태 불변 + 실패 감사 로그(toss_precheck)", async () => {
    state.getError = { code: "TOSS_TIMEOUT", message: "시간 초과", status: 504 };
    const res = await post();
    expect(res.status).toBe(504);
    expect(state.cancelCalls).toHaveLength(0);
    expect(order().status).toBe("paid");
    expect(state.audits).toEqual([
      {
        action: "order.refund_failed",
        details: expect.objectContaining({ stage: "toss_precheck", code: "TOSS_TIMEOUT", from: "paid" }),
      },
    ]);
  });

  it("in_production 은 force 없이 409 REFUND_REQUIRES_FORCE, 토스 무접촉", async () => {
    order().status = "in_production";
    const res = await post();
    expect(res.status).toBe(409);
    expect((await body(res)).error?.code).toBe("REFUND_REQUIRES_FORCE");
    expect(state.cancelCalls).toHaveLength(0);
    expect(order().status).toBe("in_production");
  });

  it("in_production + force 인데 사유 없음 → 400 REFUND_REASON_REQUIRED", async () => {
    order().status = "in_production";
    const res = await post({ force: true });
    expect(res.status).toBe(400);
    expect((await body(res)).error?.code).toBe("REFUND_REASON_REQUIRED");
    expect(state.cancelCalls).toHaveLength(0);
  });

  it("delivered + force + 사유 → 환불 성공, 감사 로그에 force 기록", async () => {
    order().status = "delivered";
    const res = await post({ force: true, reason: "인쇄 불량(페이지 결손)" });
    expect(res.status).toBe(200);
    expect(order().status).toBe("refunded");
    expect(state.restoreCalls).toHaveLength(1);
    expect(state.audits[0]?.details).toMatchObject({
      from: "delivered",
      force: true,
      reason: "인쇄 불량(페이지 결손)",
    });
  });

  it("이미 refunded → 409 ALREADY_REFUNDED, 토스 무접촉", async () => {
    order().status = "refunded";
    const res = await post();
    expect(res.status).toBe(409);
    expect((await body(res)).error?.code).toBe("ALREADY_REFUNDED");
    expect(state.cancelCalls).toHaveLength(0);
    expect(state.restoreCalls).toHaveLength(0);
  });

  it.each(["pending", "cancelled"])("%s → 409 ORDER_NOT_REFUNDABLE", async (status) => {
    order().status = status;
    const res = await post();
    expect(res.status).toBe(409);
    expect((await body(res)).error?.code).toBe("ORDER_NOT_REFUNDABLE");
    expect(state.cancelCalls).toHaveLength(0);
  });

  it("결제 키 없음 → 409 NO_PAYMENT_KEY", async () => {
    order().toss_payment_key = null;
    const res = await post();
    expect(res.status).toBe(409);
    expect((await body(res)).error?.code).toBe("NO_PAYMENT_KEY");
  });

  it("토스 PARTIAL_CANCELED → 409, 취소·상태 변경 없음", async () => {
    state.toss.status = "PARTIAL_CANCELED";
    const res = await post();
    expect(res.status).toBe(409);
    expect((await body(res)).error?.code).toBe("PARTIAL_CANCELED_PAYMENT");
    expect(state.cancelCalls).toHaveLength(0);
    expect(order().status).toBe("paid");
  });

  it("토스 금액 불일치 → 409 AMOUNT_MISMATCH, 취소 호출 없음 + 실패 감사 로그(금액 기록)", async () => {
    state.toss.totalAmount = 1000;
    const res = await post();
    expect(res.status).toBe(409);
    expect((await body(res)).error?.code).toBe("AMOUNT_MISMATCH");
    expect(state.cancelCalls).toHaveLength(0);
    expect(state.audits).toEqual([
      {
        action: "order.refund_failed",
        details: expect.objectContaining({
          stage: "toss_precheck",
          code: "AMOUNT_MISMATCH",
          tossStatus: "DONE",
          tossTotalAmount: 1000,
          amount: 30000,
        }),
      },
    ]);
  });

  it("복원이 ok=false(RELEASE_FAILED)를 돌려주면 성공 응답 + creditRestoreError·감사 기록 (조용히 성공 처리하지 않음)", async () => {
    state.restoreResult = { ok: false, mode: "atomic", code: "RELEASE_FAILED", message: "rpc timeout" };
    const res = await post();
    expect(res.status).toBe(200);
    expect((await body(res)).data).toMatchObject({
      claimed: true,
      creditRestoreError: "RELEASE_FAILED: rpc timeout",
    });
    expect(order().status).toBe("refunded");
    expect(state.audits[0]).toMatchObject({
      action: "order.refund",
      details: { creditRestoreFailed: true, creditRestoreError: "RELEASE_FAILED: rpc timeout" },
    });
  });

  it("감사 로그 복원량은 실제로 되돌린 값 — 차감 기록이 없던 주문은 0", async () => {
    state.restoreResult = { ok: true, mode: "atomic", pointsRestored: 0, discountUsesRestored: 0 };
    const res = await post();
    expect(res.status).toBe(200);
    expect(state.audits[0]?.details).toMatchObject({ pointsRestored: 0, discountRestored: false });
  });

  it("콘솔에서 이미 취소(CANCELED) → 취소 호출 없이 refunded + 복원 1회", async () => {
    state.toss.status = "CANCELED";
    const res = await post();
    expect(res.status).toBe(200);
    expect((await body(res)).data).toMatchObject({
      tossOutcome: "already_canceled",
      claimed: true,
    });
    expect(state.cancelCalls).toHaveLength(0);
    expect(order().status).toBe("refunded");
    expect(state.restoreCalls).toHaveLength(1);
  });

  it("동시 중복 요청 2건 → 토스 실제 취소 1회, refunded 전이·복원 1회, 둘 다 성공 수렴", async () => {
    const [a, b] = await Promise.all([post(), post()]);
    const [ja, jb] = [await body(a), await body(b)];

    expect([a.status, b.status]).toEqual([200, 200]);
    expect(state.tossCancellations).toBe(1);
    expect(order().status).toBe("refunded");
    expect(state.restoreCalls).toHaveLength(1);
    expect(state.emails).toHaveLength(1);
    const claimed = [ja.data?.claimed, jb.data?.claimed];
    expect(claimed.filter(Boolean)).toHaveLength(1);
    expect([ja.data?.alreadyRefunded, jb.data?.alreadyRefunded].filter(Boolean)).toHaveLength(1);
    // 두 요청 모두 같은 주문 id 멱등 키로 토스를 호출한다.
    expect(new Set(state.cancelCalls.map((c) => c.idempotencyKey))).toEqual(
      new Set([`100p-refund-full-${ORDER_ID}`]),
    );
  });

  // 환불 메일은 refunded 클레임 승자가 보낸다 — 웹훅이 이기면 웹훅이 보낸다(payments/webhook route.test).
  it("토스 웹훅이 먼저 refunded 로 전이 → 클레임 패배, 복원·메일 중복 없이 성공 수렴", async () => {
    state.afterCancel = () => {
      order().status = "refunded"; // 웹훅 클레임 승자가 복원까지 수행했다고 가정
    };
    const res = await post();
    expect(res.status).toBe(200);
    expect((await body(res)).data).toMatchObject({ claimed: false, alreadyRefunded: true });
    expect(state.restoreCalls).toHaveLength(0);
    expect(state.emails).toHaveLength(0);
    expect(state.audits[0]).toMatchObject({ action: "order.refund", details: { claimed: false } });
  });

  it("토스 취소 후 주문 UPDATE 실패 → 500, 재시도하면 토스 재취소 없이 상태만 반영", async () => {
    state.failOrderUpdate = true;
    const first = await post();
    expect(first.status).toBe(500);
    expect((await body(first)).error?.code).toBe("ORDER_UPDATE_FAILED");
    expect(order().status).toBe("paid");
    expect(state.restoreCalls).toHaveLength(0);

    state.failOrderUpdate = false;
    const retry = await post();
    expect(retry.status).toBe(200);
    expect((await body(retry)).data).toMatchObject({ tossOutcome: "already_canceled" });
    expect(state.tossCancellations).toBe(1);
    expect(order().status).toBe("refunded");
    expect(state.restoreCalls).toHaveLength(1);
  });

  it("토스 취소 사이 주문이 paid → in_production 으로 바뀌어도 refunded 로 수렴", async () => {
    state.afterCancel = () => {
      order().status = "in_production";
    };
    const res = await post();
    expect(res.status).toBe(200);
    expect(order().status).toBe("refunded");
    expect(state.restoreCalls).toHaveLength(1);
  });

  it("포인트·할인 복원이 throw 해도 결제 취소·refunded 는 성공 응답 + 경고·감사 기록", async () => {
    state.restoreThrows = true;
    const res = await post();
    expect(res.status).toBe(200);
    expect((await body(res)).data).toMatchObject({
      claimed: true,
      creditRestoreError: "points rpc failed",
    });
    expect(order().status).toBe("refunded");
    expect(state.audits[0]).toMatchObject({
      action: "order.refund",
      details: { creditRestoreFailed: true, creditRestoreError: "points rpc failed" },
    });
  });

  it("본문 형식 오류 → 400 INVALID_BODY", async () => {
    const res = await post({ force: "yes" });
    expect(res.status).toBe(400);
    expect((await body(res)).error?.code).toBe("INVALID_BODY");
  });
});

describe("GET /api/admin/orders/:id/refund (미리보기)", () => {
  it("금액·결제수단·복원 대상 + force 불필요, 상태 변경 없음", async () => {
    const res = await get();
    const json = await body(res);
    expect(res.status).toBe(200);
    expect(json.data).toMatchObject({
      order: {
        id: ORDER_ID,
        status: "paid",
        amount: 30000,
        pointsUsed: 2000,
        discountAmount: 3000,
        hasDiscountCode: true,
      },
      refundable: true,
      requiresForce: false,
      block: null,
      toss: { status: "DONE", method: "카드", totalAmount: 30000 },
      tossError: null,
    });
    expect(state.cancelCalls).toHaveLength(0);
    expect(order().status).toBe("paid");
  });

  it("shipped → requiresForce", async () => {
    order().status = "shipped";
    const json = await body(await get());
    expect(json.data).toMatchObject({ refundable: true, requiresForce: true });
  });

  it("PARTIAL_CANCELED → refundable false + block", async () => {
    state.toss.status = "PARTIAL_CANCELED";
    const json = await body(await get());
    expect(json.data).toMatchObject({
      refundable: false,
      block: { code: "PARTIAL_CANCELED_PAYMENT" },
    });
  });

  it("토스 조회 실패여도 200 + tossError (다이얼로그는 뜬다)", async () => {
    state.getError = { code: "TOSS_TIMEOUT", message: "시간 초과", status: 504 };
    const res = await get();
    expect(res.status).toBe(200);
    expect((await body(res)).data).toMatchObject({ toss: null, tossError: "시간 초과" });
  });

  it("권한 없음 → 403", async () => {
    state.adminError = Object.assign(new Error("관리자 권한이 필요합니다."), {
      status: 403,
      code: "FORBIDDEN",
    });
    expect((await get()).status).toBe(403);
  });
});

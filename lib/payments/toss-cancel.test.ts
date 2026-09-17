// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TossError } from "./toss";
import {
  cancelTossPaymentFully,
  getTossPayment,
  refundIdempotencyKey,
} from "./toss-cancel";

/**
 * 토스 전액 취소 클라이언트 — fetch 를 가로채 요청 모양과 응답 수렴을 고정한다.
 *   성공 / 이미 취소 / 실패 / 타임아웃 / 재조회 불일치 / 동시 처리 중.
 */

const PAYMENT_KEY = "pay_key_123";
const ORDER_UUID = "11111111-2222-3333-4444-555555555555";

type FetchCall = { url: string; init: RequestInit };
const calls: FetchCall[] = [];

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function payment(status: string, extra: Record<string, unknown> = {}) {
  return {
    paymentKey: PAYMENT_KEY,
    orderId: "toss-order-1",
    status,
    totalAmount: 30000,
    balanceAmount: status === "CANCELED" ? 0 : 30000,
    method: "카드",
    ...extra,
  };
}

/** 순서대로 응답을 돌려주는 fetch mock. 함수 응답은 (url, init) 으로 호출. */
function mockFetch(
  responses: Array<Response | ((url: string, init: RequestInit) => Promise<Response>)>,
) {
  const queue = [...responses];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      const next = queue.shift();
      if (!next) throw new Error(`unexpected fetch: ${init.method} ${url}`);
      return typeof next === "function" ? next(url, init) : next;
    }),
  );
}

/** abort 신호가 올 때까지 응답하지 않는 fetch — 타임아웃 재현. */
function hangUntilAbort(_url: string, init: RequestInit): Promise<Response> {
  return new Promise((_resolve, reject) => {
    init.signal?.addEventListener("abort", () => {
      reject(new DOMException("The operation was aborted.", "AbortError"));
    });
  });
}

beforeEach(() => {
  calls.length = 0;
  vi.stubEnv("TOSS_SECRET_KEY", "test_sk_abc");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const baseArgs = {
  paymentKey: PAYMENT_KEY,
  cancelReason: "고객 요청 전액 환불",
  idempotencyKey: refundIdempotencyKey(ORDER_UUID),
};

describe("refundIdempotencyKey", () => {
  it("주문 id 기반 고정 키 — 같은 주문은 항상 같은 키, 300자 이하", () => {
    expect(refundIdempotencyKey(ORDER_UUID)).toBe(`100p-refund-full-${ORDER_UUID}`);
    expect(refundIdempotencyKey(ORDER_UUID)).toBe(refundIdempotencyKey(ORDER_UUID));
    expect(refundIdempotencyKey("x".repeat(400)).length).toBe(300);
  });
});

describe("cancelTossPaymentFully", () => {
  it("성공: cancelAmount 없이 POST(멱등 키·Basic 인증) → 재조회 CANCELED → canceled", async () => {
    mockFetch([json(200, payment("CANCELED")), json(200, payment("CANCELED"))]);

    const res = await cancelTossPaymentFully(baseArgs);

    expect(res.outcome).toBe("canceled");
    expect(res.payment.status).toBe("CANCELED");
    expect(calls).toHaveLength(2);

    const [post, get] = calls;
    expect(post!.url).toBe(
      `https://api.tosspayments.com/v1/payments/${PAYMENT_KEY}/cancel`,
    );
    expect(post!.init.method).toBe("POST");
    const headers = post!.init.headers as Record<string, string>;
    expect(headers.Authorization).toBe(
      "Basic " + Buffer.from("test_sk_abc:").toString("base64"),
    );
    expect(headers["Idempotency-Key"]).toBe(`100p-refund-full-${ORDER_UUID}`);
    expect(headers["Content-Type"]).toBe("application/json");
    const body = JSON.parse(String(post!.init.body)) as Record<string, unknown>;
    // 전액 취소 — 부분 취소 필드가 절대 실리지 않는다.
    expect(body).toEqual({ cancelReason: "고객 요청 전액 환불" });
    expect(body).not.toHaveProperty("cancelAmount");

    expect(get!.url).toBe(`https://api.tosspayments.com/v1/payments/${PAYMENT_KEY}`);
    expect(get!.init.method).toBe("GET");
  });

  it("취소 사유는 200자로 절단된다", async () => {
    mockFetch([json(200, payment("CANCELED")), json(200, payment("CANCELED"))]);
    await cancelTossPaymentFully({ ...baseArgs, cancelReason: "가".repeat(250) });
    const body = JSON.parse(String(calls[0]!.init.body)) as { cancelReason: string };
    expect(body.cancelReason).toHaveLength(200);
  });

  it("이미 취소된 결제(ALREADY_CANCELED_PAYMENT) → 재조회 CANCELED 로 성공 수렴", async () => {
    mockFetch([
      json(400, { code: "ALREADY_CANCELED_PAYMENT", message: "이미 취소된 결제 입니다" }),
      json(200, payment("CANCELED")),
    ]);

    const res = await cancelTossPaymentFully(baseArgs);
    expect(res.outcome).toBe("already_canceled");
    expect(res.payment.status).toBe("CANCELED");
  });

  it("토스 실패(NOT_CANCELABLE_PAYMENT) → TossError, 재조회 없음", async () => {
    mockFetch([
      json(403, { code: "NOT_CANCELABLE_PAYMENT", message: "취소 할 수 없는 결제 입니다" }),
    ]);

    const err = await cancelTossPaymentFully(baseArgs).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TossError);
    expect((err as TossError).code).toBe("NOT_CANCELABLE_PAYMENT");
    expect((err as TossError).status).toBe(400);
    expect(calls).toHaveLength(1);
  });

  it("토스 5xx → 502 로 정규화", async () => {
    mockFetch([
      json(500, { code: "FAILED_INTERNAL_SYSTEM_PROCESSING", message: "내부 시스템 처리 작업이 실패했습니다" }),
    ]);
    const err = (await cancelTossPaymentFully(baseArgs).catch((e: unknown) => e)) as TossError;
    expect(err.code).toBe("FAILED_INTERNAL_SYSTEM_PROCESSING");
    expect(err.status).toBe(502);
  });

  it("같은 멱등 키 요청이 처리 중(409 IDEMPOTENT_REQUEST_PROCESSING) → 409 TossError", async () => {
    mockFetch([
      json(409, { code: "IDEMPOTENT_REQUEST_PROCESSING", message: "처리 중" }),
    ]);
    const err = (await cancelTossPaymentFully(baseArgs).catch((e: unknown) => e)) as TossError;
    expect(err.code).toBe("IDEMPOTENT_REQUEST_PROCESSING");
    expect(err.status).toBe(409);
  });

  it("타임아웃 → TOSS_TIMEOUT(504), 재조회 없음", async () => {
    mockFetch([hangUntilAbort]);
    const err = (await cancelTossPaymentFully({
      ...baseArgs,
      cancelTimeoutMs: 20,
    }).catch((e: unknown) => e)) as TossError;
    expect(err).toBeInstanceOf(TossError);
    expect(err.code).toBe("TOSS_TIMEOUT");
    expect(err.status).toBe(504);
    expect(calls).toHaveLength(1);
  });

  it("네트워크 오류 → TOSS_NETWORK_ERROR(502)", async () => {
    mockFetch([
      async () => {
        throw new TypeError("fetch failed");
      },
    ]);
    const err = (await cancelTossPaymentFully(baseArgs).catch((e: unknown) => e)) as TossError;
    expect(err.code).toBe("TOSS_NETWORK_ERROR");
    expect(err.status).toBe(502);
  });

  it("취소 200 이어도 재조회가 CANCELED 가 아니면 TOSS_CANCEL_UNVERIFIED", async () => {
    mockFetch([json(200, payment("CANCELED")), json(200, payment("DONE"))]);
    const err = (await cancelTossPaymentFully(baseArgs).catch((e: unknown) => e)) as TossError;
    expect(err.code).toBe("TOSS_CANCEL_UNVERIFIED");
    expect(err.status).toBe(502);
  });

  it("재조회 타임아웃 → TOSS_CANCEL_UNVERIFIED (재시도 안전 안내)", async () => {
    mockFetch([json(200, payment("CANCELED")), hangUntilAbort]);
    const err = (await cancelTossPaymentFully({
      ...baseArgs,
      fetchTimeoutMs: 20,
    }).catch((e: unknown) => e)) as TossError;
    expect(err.code).toBe("TOSS_CANCEL_UNVERIFIED");
    expect(err.message).toContain("재시도");
  });

  it("TOSS_SECRET_KEY 미설정 → fetch 없이 TOSS_SECRET_MISSING", async () => {
    vi.stubEnv("TOSS_SECRET_KEY", "");
    mockFetch([]);
    const err = (await cancelTossPaymentFully(baseArgs).catch((e: unknown) => e)) as TossError;
    expect(err.code).toBe("TOSS_SECRET_MISSING");
    expect(calls).toHaveLength(0);
  });

  it("빈 취소 사유 → 호출 없이 거부", async () => {
    mockFetch([]);
    const err = (await cancelTossPaymentFully({ ...baseArgs, cancelReason: "  " }).catch(
      (e: unknown) => e,
    )) as TossError;
    expect(err.code).toBe("TOSS_CANCEL_REASON_REQUIRED");
    expect(calls).toHaveLength(0);
  });
});

describe("getTossPayment", () => {
  it("성공: paymentKey 를 인코딩해 GET", async () => {
    mockFetch([json(200, payment("DONE"))]);
    const p = await getTossPayment("a/b");
    expect(p.status).toBe("DONE");
    expect(calls[0]!.url).toBe("https://api.tosspayments.com/v1/payments/a%2Fb");
  });

  it("타임아웃 → TOSS_TIMEOUT", async () => {
    mockFetch([hangUntilAbort]);
    const err = (await getTossPayment(PAYMENT_KEY, { timeoutMs: 20 }).catch(
      (e: unknown) => e,
    )) as TossError;
    expect(err.code).toBe("TOSS_TIMEOUT");
  });

  it("status 없는 응답 → TOSS_INVALID_RESPONSE", async () => {
    mockFetch([json(200, { foo: 1 })]);
    const err = (await getTossPayment(PAYMENT_KEY).catch((e: unknown) => e)) as TossError;
    expect(err.code).toBe("TOSS_INVALID_RESPONSE");
  });
});

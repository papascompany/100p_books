// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildConfirmIdempotencyKey,
  classifyTossConfirmError,
  classifyTossPaymentStatus,
  confirmTossPayment,
  fetchTossPayment,
  findTossPaymentMismatch,
  isTossLookupNotFound,
  TOSS_IDEMPOTENCY_KEY_MAX,
  TossError,
} from "./toss";

/**
 * lib/payments/toss — 멱등키·오류 분류·응답 대조 (DEBT-1, SEC-8).
 * fetch 를 스텁해 실제 토스 API 는 호출하지 않는다.
 */

beforeEach(() => {
  vi.stubEnv("TOSS_SECRET_KEY", "test_sk_dummy_for_unit_test");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function stubFetch(status: number, body: unknown) {
  const fn = vi.fn(async (_url: string, _init?: RequestInit) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    }),
  );
  vi.stubGlobal("fetch", fn);
  return fn;
}

describe("buildConfirmIdempotencyKey", () => {
  it("같은 (주문, paymentKey) 는 같은 키 — 재시도가 첫 응답으로 수렴", () => {
    expect(buildConfirmIdempotencyKey("order-1", "pk-1")).toBe(
      buildConfirmIdempotencyKey("order-1", "pk-1"),
    );
  });

  it("같은 주문이라도 paymentKey 가 다르면 다른 키 — 새 결제 시도가 이전 실패 응답에 묶이지 않음", () => {
    expect(buildConfirmIdempotencyKey("order-1", "pk-1")).not.toBe(
      buildConfirmIdempotencyKey("order-1", "pk-2"),
    );
  });

  it("paymentKey 최대 길이(200자)여도 토스 제한(300자) 이내", () => {
    const key = buildConfirmIdempotencyKey(
      "4b6f2a0e-7c1d-4f7a-9a51-2b1f0c3d4e5f",
      "x".repeat(200),
    );
    expect(key.length).toBeLessThanOrEqual(TOSS_IDEMPOTENCY_KEY_MAX);
    expect(key.startsWith("100p-confirm-")).toBe(true);
  });
});

describe("confirmTossPayment", () => {
  it("Idempotency-Key 헤더와 Basic 인증을 보낸다", async () => {
    const fetchFn = stubFetch(200, {
      paymentKey: "pk-1",
      orderId: "100p-abc",
      status: "DONE",
      totalAmount: 18000,
    });
    const key = buildConfirmIdempotencyKey("order-1", "pk-1");
    const res = await confirmTossPayment({
      paymentKey: "pk-1",
      orderId: "100p-abc",
      amount: 18000,
      idempotencyKey: key,
    });
    expect(res.status).toBe("DONE");
    const init = fetchFn.mock.calls[0]![1]!;
    const headers = init.headers as Record<string, string>;
    expect(headers["Idempotency-Key"]).toBe(key);
    expect(headers.Authorization).toMatch(/^Basic /);
    expect(JSON.parse(String(init.body))).toEqual({
      paymentKey: "pk-1",
      orderId: "100p-abc",
      amount: 18000,
    });
  });

  it("토스 오류 코드를 보존한다 — ALREADY_PROCESSED_PAYMENT", async () => {
    stubFetch(400, { code: "ALREADY_PROCESSED_PAYMENT", message: "이미 처리된 결제 입니다." });
    const err = await confirmTossPayment({
      paymentKey: "pk-1",
      orderId: "100p-abc",
      amount: 18000,
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TossError);
    expect((err as TossError).code).toBe("ALREADY_PROCESSED_PAYMENT");
    expect(classifyTossConfirmError(err as TossError)).toBe("already_processed");
  });

  it("409 IDEMPOTENT_REQUEST_PROCESSING → status 409 · in_progress", async () => {
    stubFetch(409, { code: "IDEMPOTENT_REQUEST_PROCESSING", message: "처리 중" });
    const err = (await confirmTossPayment({
      paymentKey: "pk-1",
      orderId: "100p-abc",
      amount: 18000,
      idempotencyKey: "k",
    }).catch((e: unknown) => e)) as TossError;
    expect(err.status).toBe(409);
    expect(classifyTossConfirmError(err)).toBe("in_progress");
  });

  it("300자 초과 멱등키는 요청 전에 거부(캡처 불가로 분류)", async () => {
    const fetchFn = stubFetch(200, {});
    const err = (await confirmTossPayment({
      paymentKey: "pk-1",
      orderId: "100p-abc",
      amount: 18000,
      idempotencyKey: "k".repeat(301),
    }).catch((e: unknown) => e)) as TossError;
    expect(err.code).toBe("INVALID_IDEMPOTENCY_KEY");
    expect(fetchFn).not.toHaveBeenCalled();
    expect(classifyTossConfirmError(err)).toBe("not_captured");
  });
});

describe("classifyTossConfirmError", () => {
  const cases: Array<[code: string, status: number, kind: string]> = [
    ["ALREADY_PROCESSED_PAYMENT", 400, "already_processed"],
    ["IDEMPOTENT_REQUEST_PROCESSING", 409, "in_progress"],
    ["ALREADY_PROCESSING_REQUEST", 400, "in_progress"],
    ["TOSS_TIMEOUT", 504, "outcome_unknown"],
    ["TOSS_NETWORK_ERROR", 502, "outcome_unknown"],
    ["PROVIDER_ERROR", 400, "outcome_unknown"],
    ["FAILED_PAYMENT_INTERNAL_SYSTEM_PROCESSING", 502, "outcome_unknown"],
    ["SOME_NEW_5XX_CODE", 502, "outcome_unknown"],
    ["REJECT_CARD_PAYMENT", 400, "not_captured"],
    ["NOT_FOUND_PAYMENT_SESSION", 400, "not_captured"],
    ["TOSS_SECRET_MISSING", 500, "not_captured"],
  ];
  for (const [code, status, kind] of cases) {
    it(`${code} (${status}) → ${kind}`, () => {
      expect(
        classifyTossConfirmError(new TossError({ code, message: code, status })),
      ).toBe(kind);
    });
  }
});

describe("classifyTossPaymentStatus", () => {
  const cases: Array<[status: string, kind: string]> = [
    ["DONE", "captured"],
    ["READY", "awaiting_confirm"],
    ["IN_PROGRESS", "awaiting_confirm"],
    ["ABORTED", "not_captured"],
    ["EXPIRED", "not_captured"],
    // 캡처 후 취소 — 승인 재시도 금지(멱등키가 첫 DONE 을 재생)
    ["CANCELED", "canceled"],
    ["PARTIAL_CANCELED", "needs_review"],
    ["WAITING_FOR_DEPOSIT", "needs_review"],
    ["SOME_NEW_STATUS", "needs_review"],
  ];
  for (const [status, kind] of cases) {
    it(`${status} → ${kind}`, () => {
      expect(classifyTossPaymentStatus(status)).toBe(kind);
    });
  }
});

describe("isTossLookupNotFound", () => {
  it("결제 조회 404 만 '승인된 결제 없음' — 타임아웃·5xx·인증 오류는 아님", async () => {
    stubFetch(404, { code: "NOT_FOUND_PAYMENT", message: "존재하지 않는 결제 정보 입니다." });
    const notFound = await fetchTossPayment("pk-1").catch((e: unknown) => e);
    expect(isTossLookupNotFound(notFound)).toBe(true);

    stubFetch(500, { code: "FAILED_PAYMENT_INTERNAL_SYSTEM_PROCESSING", message: "x" });
    expect(isTossLookupNotFound(await fetchTossPayment("pk-1").catch((e: unknown) => e))).toBe(false);

    stubFetch(401, { code: "UNAUTHORIZED_KEY", message: "x" });
    expect(isTossLookupNotFound(await fetchTossPayment("pk-1").catch((e: unknown) => e))).toBe(false);

    expect(
      isTossLookupNotFound(new TossError({ code: "TOSS_TIMEOUT", message: "x", status: 504 })),
    ).toBe(false);
    expect(isTossLookupNotFound(new Error("not a toss error"))).toBe(false);
  });
});

describe("findTossPaymentMismatch (SEC-8)", () => {
  const res = { paymentKey: "pk-1", orderId: "100p-abc", totalAmount: 18000 };

  it("모두 일치하면 빈 배열", () => {
    expect(
      findTossPaymentMismatch(res, { paymentKey: "pk-1", orderId: "100p-abc", amount: 18000 }),
    ).toEqual([]);
  });

  it("같은 금액의 다른 주문번호 결제는 불일치", () => {
    expect(
      findTossPaymentMismatch(res, { paymentKey: "pk-1", orderId: "100p-other", amount: 18000 }),
    ).toEqual(["orderId"]);
  });

  it("주문에 토스 주문번호가 없으면 불일치로 본다", () => {
    expect(
      findTossPaymentMismatch(res, { paymentKey: "pk-1", orderId: null, amount: 18000 }),
    ).toEqual(["orderId"]);
  });

  it("paymentKey·금액 불일치를 각각 보고", () => {
    expect(
      findTossPaymentMismatch(res, { paymentKey: "pk-2", orderId: "100p-abc", amount: 17000 }),
    ).toEqual(["paymentKey", "totalAmount"]);
  });
});

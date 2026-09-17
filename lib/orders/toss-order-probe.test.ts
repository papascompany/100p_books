// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  classifyTossOrderLookup,
  probeCancelVerdict,
  probeTossOrder,
  type TossOrderProbe,
} from "./toss-order-probe";

/**
 * 대기 주문 취소 전 토스 원장 확인 (DEBT-6) — fail-closed 판정 고정.
 * "취소 허용(no_payment)" 은 토스가 결제 없음(404)·승인 실패(ABORTED)·만료(EXPIRED)라고
 * 명시한 경우뿐이어야 한다. 그 밖의 모든 응답·오류는 취소 금지다.
 */

const TOSS_ORDER_ID = "100p-20260917-abcdef";

describe("classifyTossOrderLookup", () => {
  const classify = (httpStatus: number, body: unknown) =>
    classifyTossOrderLookup({ httpStatus, body, tossOrderId: TOSS_ORDER_ID });

  it("404 NOT_FOUND_PAYMENT / NOT_FOUND 는 결제 없음", () => {
    expect(classify(404, { code: "NOT_FOUND_PAYMENT", message: "x" })).toEqual({
      kind: "no_payment",
      reason: "not_found",
    });
    expect(classify(404, { code: "NOT_FOUND", message: "x" })).toEqual({
      kind: "no_payment",
      reason: "not_found",
    });
  });

  it("코드 없는 404·다른 코드의 404 는 판정 불가 (라우팅 오류 등을 결제 없음으로 오인하지 않는다)", () => {
    expect(classify(404, null).kind).toBe("unavailable");
    expect(classify(404, { code: "SOMETHING_ELSE" }).kind).toBe("unavailable");
  });

  it("200 + ABORTED/EXPIRED 는 결제 없음", () => {
    expect(classify(200, { orderId: TOSS_ORDER_ID, status: "ABORTED" })).toEqual({
      kind: "no_payment",
      reason: "aborted",
    });
    expect(classify(200, { orderId: TOSS_ORDER_ID, status: "EXPIRED" })).toEqual({
      kind: "no_payment",
      reason: "expired",
    });
  });

  it.each(["DONE", "IN_PROGRESS", "WAITING_FOR_DEPOSIT", "CANCELED", "PARTIAL_CANCELED", "READY", "SOMETHING_NEW"])(
    "200 + %s 는 결제 기록 있음 → 취소 금지",
    (status) => {
      expect(classify(200, { orderId: TOSS_ORDER_ID, status })).toEqual({
        kind: "payment_found",
        tossStatus: status,
      });
    },
  );

  it("200 인데 status/orderId 가 없거나 orderId 가 다르면 판정 불가", () => {
    expect(classify(200, null).kind).toBe("unavailable");
    expect(classify(200, { status: "DONE" }).kind).toBe("unavailable");
    expect(classify(200, { orderId: TOSS_ORDER_ID }).kind).toBe("unavailable");
    expect(classify(200, { orderId: "other-order", status: "EXPIRED" })).toMatchObject({
      kind: "unavailable",
      code: "TOSS_ORDER_ID_MISMATCH",
    });
  });

  it.each([
    [401, { code: "UNAUTHORIZED_KEY", message: "bad key" }, "UNAUTHORIZED_KEY"],
    [403, { code: "FORBIDDEN_CONSECUTIVE_REQUEST", message: "slow down" }, "FORBIDDEN_CONSECUTIVE_REQUEST"],
    [500, { code: "FAILED_PAYMENT_INTERNAL_SYSTEM_PROCESSING", message: "x" }, "FAILED_PAYMENT_INTERNAL_SYSTEM_PROCESSING"],
    [502, null, "TOSS_HTTP_502"],
  ])("HTTP %i 는 판정 불가 (fail-closed)", (httpStatus, body, code) => {
    expect(classify(httpStatus, body)).toMatchObject({ kind: "unavailable", code });
  });
});

describe("probeCancelVerdict", () => {
  it("결제 없음만 진행, 결제 기록은 409, 조회 실패는 503", () => {
    expect(probeCancelVerdict({ kind: "no_payment", reason: "not_found" })).toEqual({
      kind: "proceed",
    });
    expect(probeCancelVerdict({ kind: "payment_found", tossStatus: "DONE" })).toMatchObject({
      kind: "reject",
      status: 409,
      code: "PAYMENT_IN_PROGRESS",
    });
    expect(
      probeCancelVerdict({ kind: "unavailable", code: "TOSS_TIMEOUT", message: "t" }),
    ).toMatchObject({ kind: "reject", status: 503, code: "PAYMENT_STATUS_UNAVAILABLE" });
  });
});

describe("probeTossOrder", () => {
  const fetchMock = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("TOSS_SECRET_KEY", "test_sk_dummy");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });

  it("orderId 조회 엔드포인트를 Basic 인증으로 호출하고 응답을 판정한다", async () => {
    fetchMock.mockResolvedValueOnce(json(200, { orderId: "a b/c", status: "DONE" }));
    const result = await probeTossOrder("a b/c");
    expect(result).toEqual({ kind: "payment_found", tossStatus: "DONE" });

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("https://api.tosspayments.com/v1/payments/orders/a%20b%2Fc");
    expect(init?.method).toBe("GET");
    const headers = init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe(
      "Basic " + Buffer.from("test_sk_dummy:").toString("base64"),
    );
  });

  it("404 NOT_FOUND_PAYMENT 는 결제 없음", async () => {
    fetchMock.mockResolvedValueOnce(json(404, { code: "NOT_FOUND_PAYMENT", message: "x" }));
    expect(await probeTossOrder(TOSS_ORDER_ID)).toEqual({ kind: "no_payment", reason: "not_found" });
  });

  it("네트워크 오류·JSON 아닌 5xx 는 throw 하지 않고 unavailable", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));
    expect(await probeTossOrder(TOSS_ORDER_ID)).toMatchObject({
      kind: "unavailable",
      code: "TOSS_NETWORK_ERROR",
    });

    fetchMock.mockResolvedValueOnce(new Response("<html>bad gateway</html>", { status: 502 }));
    expect(await probeTossOrder(TOSS_ORDER_ID)).toMatchObject({
      kind: "unavailable",
      code: "TOSS_HTTP_502",
    });
  });

  it("timeout 이면 요청을 중단하고 unavailable(TOSS_TIMEOUT)", async () => {
    fetchMock.mockImplementationOnce(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
          });
        }),
    );
    const result: TossOrderProbe = await probeTossOrder(TOSS_ORDER_ID, { timeoutMs: 5 });
    expect(result).toMatchObject({ kind: "unavailable", code: "TOSS_TIMEOUT" });
  });

  it("TOSS_SECRET_KEY 가 없으면 호출 없이 unavailable", async () => {
    vi.stubEnv("TOSS_SECRET_KEY", "");
    expect(await probeTossOrder(TOSS_ORDER_ID)).toMatchObject({
      kind: "unavailable",
      code: "TOSS_SECRET_MISSING",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("toss_order_id 가 없으면 호출 없이 결제 없음 — confirm 이 승인 호출 전에 거부하는 주문", async () => {
    expect(await probeTossOrder(null)).toEqual({ kind: "no_payment", reason: "no_toss_order_id" });
    expect(await probeTossOrder("")).toEqual({ kind: "no_payment", reason: "no_toss_order_id" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

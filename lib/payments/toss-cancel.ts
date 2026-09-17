import "server-only";

import { createHash } from "node:crypto";

import { TossError, type TossConfirmResponse } from "@/lib/payments/toss";

/**
 * TossPayments 결제 **전액** 취소 클라이언트 (관리자 환불 전용).
 *
 *   POST https://api.tosspayments.com/v1/payments/{paymentKey}/cancel
 *   (https://docs.tosspayments.com/reference#결제-취소)
 *
 *   - cancelAmount 를 **보내지 않는다** → 토스가 남은 금액 전액을 취소한다.
 *     부분 취소(PARTIAL_CANCELED)는 앱에 부분 환불 모델이 없어 의도적으로 지원하지 않는다
 *     (포인트·할인 전액 복원과 어긋남 — webhook/route.ts mapTossStatus 주석 참고).
 *   - Idempotency-Key: 주문 id 기반 고정 키. 네트워크 타임아웃 뒤 재시도해도 이중 취소가
 *     일어나지 않는다. 토스는 같은 키의 **첫 응답(에러 포함)** 을 15일간 그대로 돌려주고,
 *     첫 요청이 처리 중이면 409 IDEMPOTENT_REQUEST_PROCESSING 을 준다
 *     (https://docs.tosspayments.com/reference/using-api/idempotency-key).
 *     공식 문서는 에러 뒤 키를 바꿔 재시도하는 것을 위험하다고 명시 → 키를 바꾸지 않는다.
 *   - 이미 취소된 결제(400 ALREADY_CANCELED_PAYMENT)는 재조회로 CANCELED 를 확인한 뒤
 *     성공으로 수렴한다(콘솔 취소·동시 요청·웹훅 선반영 모두 같은 결말).
 *   - 성공 응답도 믿고 끝내지 않고 **재조회로 CANCELED 를 확인**한다.
 */

const TOSS_API_BASE = "https://api.tosspayments.com";

const DEFAULT_FETCH_TIMEOUT_MS = 10_000;
const DEFAULT_CANCEL_TIMEOUT_MS = 20_000;

/** 토스 cancelReason 최대 길이 (공식 문서: 최대 200자). */
export const TOSS_CANCEL_REASON_MAX = 200;

/** Idempotency-Key 최대 길이 (공식 문서: 최대 300자). */
const IDEMPOTENCY_KEY_MAX = 300;

/**
 * 인증 헤더 — base64(`${secretKey}:`) Basic.
 *
 * lib/payments/toss.ts 의 authHeader 와 동일 규칙. 그쪽 함수가 export 되어 있지 않아
 * (toss.ts 수정은 이 변경 범위 밖) 같은 구성을 여기서 한 번 더 둔다. export 되면 import 로 교체.
 */
function authHeader(): string {
  const key = process.env.TOSS_SECRET_KEY;
  if (!key) {
    throw new TossError({
      code: "TOSS_SECRET_MISSING",
      message: "TOSS_SECRET_KEY 환경변수가 설정되지 않았습니다.",
      status: 500,
    });
  }
  return "Basic " + Buffer.from(`${key}:`).toString("base64");
}

export type TossPaymentStatus =
  | "READY"
  | "IN_PROGRESS"
  | "WAITING_FOR_DEPOSIT"
  | "DONE"
  | "CANCELED"
  | "PARTIAL_CANCELED"
  | "ABORTED"
  | "EXPIRED";

export interface TossCancelEntry {
  cancelAmount?: number;
  cancelReason?: string;
  canceledAt?: string;
  transactionKey?: string;
  cancelStatus?: string;
  [key: string]: unknown;
}

/** 결제 조회·취소 응답(Payment 객체) 중 환불 판단에 쓰는 필드. */
export interface TossPayment extends TossConfirmResponse {
  balanceAmount?: number;
  cancels?: TossCancelEntry[] | null;
  virtualAccount?: unknown;
}

export type TossFullCancelOutcome = "canceled" | "already_canceled";

export interface TossFullCancelResult {
  outcome: TossFullCancelOutcome;
  /** 재조회로 확인한 결제 (status === "CANCELED"). */
  payment: TossPayment;
}

export interface TossFullCancelArgs {
  paymentKey: string;
  cancelReason: string;
  idempotencyKey: string;
  /** 취소 POST 타임아웃 (ms). */
  cancelTimeoutMs?: number;
  /** 재조회 GET 타임아웃 (ms). */
  fetchTimeoutMs?: number;
}

/** 주문 id 기반 전액 환불 멱등 키 — 같은 주문의 전액 취소는 몇 번 눌러도 한 건. */
export function refundIdempotencyKey(orderId: string): string {
  return `100p-refund-full-${orderId}`.slice(0, IDEMPOTENCY_KEY_MAX);
}

/**
 * 취소된 주문에 캡처된 결제의 자동 전액 취소 멱등 키 — (주문 id, paymentKey) 결정적 해시.
 *
 * 관리자 환불 키(refundIdempotencyKey)와 분리한다: 토스는 같은 키의 첫 응답을 재생하므로
 * 서로 다른 경로(결제 확정 경합 정리 vs 관리자 환불)가 한 키를 공유하면 한쪽의 실패가 다른 쪽에 재생된다.
 * paymentKey 를 묶어 한 주문에 결제 키가 바뀌어도 다른 결제의 응답이 재생되지 않게 한다.
 */
export function cancelledOrderCancelIdempotencyKey(
  orderId: string,
  paymentKey: string,
): string {
  const digest = createHash("sha256").update(`${orderId}:${paymentKey}`).digest("hex");
  return `100p-cancel-order-${digest}`.slice(0, IDEMPOTENCY_KEY_MAX);
}

/** 토스 에러 HTTP → 우리 응답 HTTP. 5xx 는 업스트림 장애, 409 는 동시 처리 중. */
function mapHttpStatus(status: number): number {
  if (status >= 500) return 502;
  if (status === 409) return 409;
  return 400;
}

/** fetch + 타임아웃 + JSON 파싱 + 토스 에러 정규화. */
async function tossRequest(
  path: string,
  init: { method: "GET" | "POST"; body?: unknown; idempotencyKey?: string },
  timeoutMs: number,
  label: string,
): Promise<TossPayment> {
  // 헤더 구성(시크릿 확인)을 네트워크 호출 전에 끝낸다 — 미설정이면 fetch 자체를 하지 않는다.
  const headers: Record<string, string> = { Authorization: authHeader() };
  if (init.body !== undefined) headers["Content-Type"] = "application/json";
  if (init.idempotencyKey) headers["Idempotency-Key"] = init.idempotencyKey;

  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${TOSS_API_BASE}${path}`, {
      method: init.method,
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: ctrl.signal,
      cache: "no-store",
    });
    const json = (await res.json().catch(() => null)) as
      | (TossPayment & { code?: string; message?: string })
      | null;

    if (!res.ok) {
      throw new TossError({
        code: json?.code ?? "TOSS_HTTP_ERROR",
        message: json?.message ?? `${label} 실패 (HTTP ${res.status}).`,
        status: mapHttpStatus(res.status),
        raw: json,
      });
    }
    if (!json || typeof json.status !== "string") {
      throw new TossError({
        code: "TOSS_INVALID_RESPONSE",
        message: `${label} — 토스 응답을 해석할 수 없습니다.`,
        status: 502,
        raw: json,
      });
    }
    return json;
  } catch (e) {
    if (e instanceof TossError) throw e;
    if ((e as Error)?.name === "AbortError") {
      throw new TossError({
        code: "TOSS_TIMEOUT",
        message: `${label} — 토스 응답 시간 초과`,
        status: 504,
      });
    }
    throw new TossError({
      code: "TOSS_NETWORK_ERROR",
      message: `${label} — ${(e as Error)?.message ?? "토스 호출 실패"}`,
      status: 502,
    });
  } finally {
    clearTimeout(timeout);
  }
}

/** 결제 단건 조회 (타임아웃 포함). */
export async function getTossPayment(
  paymentKey: string,
  opts: { timeoutMs?: number } = {},
): Promise<TossPayment> {
  return tossRequest(
    `/v1/payments/${encodeURIComponent(paymentKey)}`,
    { method: "GET" },
    opts.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS,
    "토스 결제 조회",
  );
}

/**
 * 전액 취소 → 재조회로 CANCELED 확인.
 *
 *   - 200 → outcome "canceled"
 *   - 400 ALREADY_CANCELED_PAYMENT → outcome "already_canceled"
 *   - 그 외 토스 에러/타임아웃 → TossError throw (호출 측은 상태를 바꾸지 않는다)
 *   - 재조회 실패 또는 CANCELED 가 아님 → TossError(TOSS_CANCEL_UNVERIFIED).
 *     취소가 실제로 반영됐을 수 있으나, 같은 멱등 키 + 이미 취소 수렴 덕에 재시도가 안전하다.
 */
export async function cancelTossPaymentFully(
  args: TossFullCancelArgs,
): Promise<TossFullCancelResult> {
  const reason = args.cancelReason.trim().slice(0, TOSS_CANCEL_REASON_MAX);
  if (!reason) {
    throw new TossError({
      code: "TOSS_CANCEL_REASON_REQUIRED",
      message: "취소 사유가 필요합니다.",
      status: 400,
    });
  }

  let outcome: TossFullCancelOutcome;
  try {
    await tossRequest(
      `/v1/payments/${encodeURIComponent(args.paymentKey)}/cancel`,
      {
        method: "POST",
        // cancelAmount 미지정 = 전액 취소. 부분 취소 필드는 절대 넣지 않는다.
        body: { cancelReason: reason },
        idempotencyKey: args.idempotencyKey,
      },
      args.cancelTimeoutMs ?? DEFAULT_CANCEL_TIMEOUT_MS,
      "토스 결제 취소",
    );
    outcome = "canceled";
  } catch (e) {
    if (e instanceof TossError && e.code === "ALREADY_CANCELED_PAYMENT") {
      outcome = "already_canceled";
    } else {
      throw e;
    }
  }

  let payment: TossPayment;
  try {
    payment = await getTossPayment(args.paymentKey, {
      timeoutMs: args.fetchTimeoutMs,
    });
  } catch (e) {
    throw new TossError({
      code: "TOSS_CANCEL_UNVERIFIED",
      message:
        "토스 취소 요청 후 결제 상태를 확인하지 못했습니다. 잠시 후 다시 시도하세요(재시도는 안전합니다).",
      status: 502,
      raw: e instanceof TossError ? { code: e.code, message: e.message } : undefined,
    });
  }
  if (payment.status !== "CANCELED") {
    throw new TossError({
      code: "TOSS_CANCEL_UNVERIFIED",
      message: `토스 취소 후 결제 상태가 CANCELED 가 아닙니다 (현재: ${payment.status}).`,
      status: 502,
      raw: { status: payment.status },
    });
  }
  return { outcome, payment };
}

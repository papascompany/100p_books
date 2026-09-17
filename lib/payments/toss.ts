import "server-only";

import { createHash } from "node:crypto";

/**
 * TossPayments 서버 검증 헬퍼.
 *
 *   - confirm: 클라가 successUrl 로 받은 paymentKey + orderId + amount 를 서버에서
 *     `POST https://api.tosspayments.com/v1/payments/confirm` 으로 한 번 더 호출해
 *     실제 승인하고 응답을 받는 단계.
 *
 * Authorization 은 secret_key + ":" 를 base64 인코딩한 Basic 헤더.
 * (https://docs.tosspayments.com/reference#auth)
 *
 * 멱등키 (https://docs.tosspayments.com/reference/using-api/idempotency-key):
 *   - 모든 POST API 가 `Idempotency-Key` 헤더를 지원한다(최대 300자, 15일 유효).
 *   - 같은 키로 재요청하면 첫 요청의 응답을 그대로 돌려준다.
 *   - 첫 요청이 아직 처리 중이면 `409 IDEMPOTENT_REQUEST_PROCESSING`.
 */

const TOSS_API_BASE = "https://api.tosspayments.com";

export class TossError extends Error {
  status: number;
  code: string;
  /** 토스 응답 raw — 디버깅용. */
  raw?: unknown;
  constructor(opts: {
    code: string;
    message: string;
    status?: number;
    raw?: unknown;
  }) {
    super(opts.message);
    this.name = "TossError";
    this.code = opts.code;
    this.status = opts.status ?? 500;
    this.raw = opts.raw;
  }
}

function getSecretKey(): string {
  const key = process.env.TOSS_SECRET_KEY;
  if (!key) {
    throw new TossError({
      code: "TOSS_SECRET_MISSING",
      message: "TOSS_SECRET_KEY 환경변수가 설정되지 않았습니다.",
      status: 500,
    });
  }
  return key;
}

function authHeader(): string {
  const key = getSecretKey();
  // base64(`${secretKey}:`)
  return "Basic " + Buffer.from(`${key}:`).toString("base64");
}

export interface TossConfirmResponse {
  paymentKey: string;
  orderId: string;
  status: string;
  totalAmount: number;
  method?: string;
  approvedAt?: string;
  receipt?: { url?: string };
  [key: string]: unknown;
}

export interface TossConfirmArgs {
  paymentKey: string;
  /** 토스 측 orderId (자체 orders.id 가 아닌 tossOrderId). */
  orderId: string;
  amount: number;
  /**
   * `Idempotency-Key` 헤더 값. 재시도(타임아웃·중복 요청)가 캡처를 두 번 시도하지 않고
   * 첫 응답으로 수렴하도록 buildConfirmIdempotencyKey() 로 만든 값을 넘긴다.
   */
  idempotencyKey?: string;
  /** 외부 호출 타임아웃 (ms). */
  timeoutMs?: number;
}

/** 멱등키 최대 길이 (토스 문서). */
export const TOSS_IDEMPOTENCY_KEY_MAX = 300;

/**
 * 결제 승인 멱등키 — (주문 id, paymentKey) 결정적 해시.
 *
 * 주문 id 만 쓰면 한 주문의 첫 시도가 실패한 뒤 **새 paymentKey** 로 다시 결제할 때
 * 첫 시도의 실패 응답이 15일간 재생돼 영영 결제할 수 없다. 그래서 paymentKey 를 함께
 * 묶고, paymentKey 길이(최대 200자)와 무관하게 300자 제한을 지키려고 sha256 으로 줄인다.
 */
export function buildConfirmIdempotencyKey(
  orderId: string,
  paymentKey: string,
): string {
  const digest = createHash("sha256")
    .update(`${orderId}:${paymentKey}`)
    .digest("hex");
  return `100p-confirm-${digest}`;
}

/**
 * 결제 승인 요청.
 *
 *   응답이 200 OK 가 아니면 TossError 로 throw.
 *   토스의 에러 응답은 `{ code, message }` 포맷.
 */
export async function confirmTossPayment(
  args: TossConfirmArgs,
): Promise<TossConfirmResponse> {
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), args.timeoutMs ?? 15000);

  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: authHeader(),
    };
    if (args.idempotencyKey) {
      if (args.idempotencyKey.length > TOSS_IDEMPOTENCY_KEY_MAX) {
        throw new TossError({
          code: "INVALID_IDEMPOTENCY_KEY",
          message: "멱등키가 너무 깁니다.",
          status: 500,
        });
      }
      headers["Idempotency-Key"] = args.idempotencyKey;
    }

    const res = await fetch(`${TOSS_API_BASE}/v1/payments/confirm`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        paymentKey: args.paymentKey,
        orderId: args.orderId,
        amount: args.amount,
      }),
      signal: ctrl.signal,
    });

    const json = (await res.json().catch(() => null)) as
      | (TossConfirmResponse & { code?: string; message?: string })
      | null;

    if (!res.ok) {
      throw new TossError({
        code: json?.code ?? "TOSS_HTTP_ERROR",
        message:
          json?.message ?? `토스 결제 승인 실패 (HTTP ${res.status}).`,
        status: res.status >= 500 ? 502 : res.status === 409 ? 409 : 400,
        raw: json,
      });
    }

    if (!json) {
      throw new TossError({
        code: "TOSS_INVALID_RESPONSE",
        message: "토스 응답을 파싱할 수 없습니다.",
        status: 502,
      });
    }

    return json;
  } catch (e) {
    if (e instanceof TossError) throw e;
    if ((e as Error).name === "AbortError") {
      throw new TossError({
        code: "TOSS_TIMEOUT",
        message: "토스 응답 시간 초과",
        status: 504,
      });
    }
    throw new TossError({
      code: "TOSS_NETWORK_ERROR",
      message: (e as Error).message ?? "토스 호출 실패",
      status: 502,
    });
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * confirm 실패의 의미 분류 — 호출측이 "크레딧 선점을 되돌려도 되는가" 를 결정한다.
 *
 *   - already_processed : 이미 승인된 결제 → 조회로 DONE 을 확인해 확정으로 수렴.
 *   - in_progress       : 같은 멱등키 요청이 처리 중 → 아무것도 되돌리지 않고 재시도 안내.
 *   - outcome_unknown   : 타임아웃·네트워크·토스 내부 오류 → 캡처됐을 수 있으므로
 *                         선점을 유지한 채 재시도(같은 멱등키) 또는 웹훅으로 수렴.
 *   - not_captured      : 그 외 4xx(카드 거절·세션 만료·잘못된 요청 등) → 캡처 안 됨,
 *                         선점을 되돌린다.
 */
export type TossConfirmFailureKind =
  | "already_processed"
  | "in_progress"
  | "outcome_unknown"
  | "not_captured";

const IN_PROGRESS_CODES = new Set([
  "IDEMPOTENT_REQUEST_PROCESSING",
  "ALREADY_PROCESSING_REQUEST",
]);

const OUTCOME_UNKNOWN_CODES = new Set([
  "TOSS_TIMEOUT",
  "TOSS_NETWORK_ERROR",
  "TOSS_INVALID_RESPONSE",
  "PROVIDER_ERROR",
  "FAILED_PAYMENT_INTERNAL_SYSTEM_PROCESSING",
  "FAILED_INTERNAL_SYSTEM_PROCESSING",
  "UNKNOWN_PAYMENT_ERROR",
]);

export function classifyTossConfirmError(e: TossError): TossConfirmFailureKind {
  if (e.code === "ALREADY_PROCESSED_PAYMENT") return "already_processed";
  if (IN_PROGRESS_CODES.has(e.code)) return "in_progress";
  if (OUTCOME_UNKNOWN_CODES.has(e.code) || e.status >= 500) {
    // TOSS_SECRET_MISSING·INVALID_IDEMPOTENCY_KEY 는 요청을 보내기 전 실패 — 캡처 불가.
    if (e.code === "TOSS_SECRET_MISSING" || e.code === "INVALID_IDEMPOTENCY_KEY") {
      return "not_captured";
    }
    return "outcome_unknown";
  }
  return "not_captured";
}

/** 토스 결제 상태 중 "캡처되지 않았고 앞으로도 되지 않는" 종착 상태. */
export const TOSS_TERMINAL_NOT_CAPTURED = new Set(["ABORTED", "EXPIRED"]);

/**
 * 토스 결제 상태(승인·조회 응답)의 의미 분류 — confirm 이 "승인을 (재)시도해도 되는가",
 * "크레딧 선점을 되돌려도 되는가" 를 결정한다.
 *
 *   - captured         : DONE — 확정으로 수렴.
 *   - awaiting_confirm : READY·IN_PROGRESS — 아직 승인 전. 같은 멱등키로 승인해도 안전.
 *   - not_captured     : ABORTED·EXPIRED — 캡처 안 됐고 앞으로도 안 됨 → 선점 해제.
 *   - canceled         : CANCELED — 캡처 후 전액 취소됨. 승인을 다시 시도하면 멱등키가 첫 DONE
 *                        응답을 재생해 무과금 확정이 되므로 절대 재시도하지 않는다.
 *   - needs_review     : PARTIAL_CANCELED·WAITING_FOR_DEPOSIT·미지 상태 — 자동 처리하지 않는다.
 */
export type TossPaymentStateKind =
  | "captured"
  | "awaiting_confirm"
  | "not_captured"
  | "canceled"
  | "needs_review";

export function classifyTossPaymentStatus(status: string): TossPaymentStateKind {
  switch (status) {
    case "DONE":
      return "captured";
    case "READY":
    case "IN_PROGRESS":
      return "awaiting_confirm";
    case "CANCELED":
      return "canceled";
    default:
      return TOSS_TERMINAL_NOT_CAPTURED.has(status) ? "not_captured" : "needs_review";
  }
}

/**
 * 결제 조회가 404 — 토스에 **승인된** 결제가 없다(조회 API 는 승인된 결제 대상).
 * 캡처된 적이 없다는 뜻이므로 같은 멱등키 승인으로 진행해도 안전하다.
 * 그 외 조회 실패(타임아웃·5xx·인증 오류 등)는 캡처 여부를 알 수 없다.
 */
export function isTossLookupNotFound(e: unknown): boolean {
  return e instanceof TossError && e.status === 404;
}

export type TossPaymentMismatchField = "paymentKey" | "orderId" | "totalAmount";

/**
 * 토스 응답(승인·조회)이 우리 주문과 같은 결제인지 대조 (SEC-8).
 *
 * @returns 불일치 필드 목록 (비어 있으면 일치).
 */
export function findTossPaymentMismatch(
  res: Pick<TossConfirmResponse, "paymentKey" | "orderId" | "totalAmount">,
  expected: { paymentKey: string; orderId: string | null; amount: number },
): TossPaymentMismatchField[] {
  const out: TossPaymentMismatchField[] = [];
  if (res.paymentKey !== expected.paymentKey) out.push("paymentKey");
  if (!expected.orderId || res.orderId !== expected.orderId) out.push("orderId");
  if (res.totalAmount !== expected.amount) out.push("totalAmount");
  return out;
}

/**
 * 토스 결제 조회 (멱등성 — 동일 paymentKey 로 다시 호출 시 사용).
 * 승인된 결제가 대상이다 — 승인 전 결제는 404(NOT_FOUND_PAYMENT)일 수 있다.
 */
export async function fetchTossPayment(
  paymentKey: string,
  opts: { timeoutMs?: number } = {},
): Promise<TossConfirmResponse> {
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 10000);
  try {
    const res = await fetch(
      `${TOSS_API_BASE}/v1/payments/${encodeURIComponent(paymentKey)}`,
      {
        method: "GET",
        headers: { Authorization: authHeader() },
        signal: ctrl.signal,
      },
    );
    const json = (await res.json().catch(() => null)) as
      | (TossConfirmResponse & { code?: string; message?: string })
      | null;
    if (!res.ok || !json) {
      throw new TossError({
        code: json?.code ?? "TOSS_FETCH_FAILED",
        message: json?.message ?? "토스 결제 조회 실패",
        status: res.status,
        raw: json,
      });
    }
    return json;
  } catch (e) {
    if (e instanceof TossError) throw e;
    if ((e as Error).name === "AbortError") {
      throw new TossError({
        code: "TOSS_TIMEOUT",
        message: "토스 결제 조회 시간 초과",
        status: 504,
      });
    }
    throw new TossError({
      code: "TOSS_NETWORK_ERROR",
      message: (e as Error).message ?? "토스 결제 조회 실패",
      status: 502,
    });
  } finally {
    clearTimeout(timeout);
  }
}

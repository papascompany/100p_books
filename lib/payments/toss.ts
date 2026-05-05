import "server-only";

/**
 * TossPayments 서버 검증 헬퍼.
 *
 *   - confirm: 클라가 successUrl 로 받은 paymentKey + orderId + amount 를 서버에서
 *     `POST https://api.tosspayments.com/v1/payments/confirm` 으로 한 번 더 호출해
 *     실제 승인하고 응답을 받는 단계.
 *
 * Authorization 은 secret_key + ":" 를 base64 인코딩한 Basic 헤더.
 * (https://docs.tosspayments.com/reference#auth)
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
  /** 외부 호출 타임아웃 (ms). */
  timeoutMs?: number;
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
    const res = await fetch(`${TOSS_API_BASE}/v1/payments/confirm`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: authHeader(),
      },
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
        status: res.status >= 500 ? 502 : 400,
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
 * 토스 결제 조회 (멱등성 — 동일 paymentKey 로 다시 호출 시 사용).
 */
export async function fetchTossPayment(
  paymentKey: string,
): Promise<TossConfirmResponse> {
  const res = await fetch(
    `${TOSS_API_BASE}/v1/payments/${encodeURIComponent(paymentKey)}`,
    {
      method: "GET",
      headers: { Authorization: authHeader() },
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
}

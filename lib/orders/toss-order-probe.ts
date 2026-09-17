import "server-only";

/**
 * 대기(pending) 주문 취소 전 토스 원장 확인 (DEBT-6) — fail-closed.
 *
 * 왜 필요한가:
 *   payments/confirm 은 토스 승인(캡처) **전에** orders.toss_payment_key 를 바인딩한다
 *   (0033 reserve_order_credits). 그래서 캡처된 결제는 원칙적으로 키가 묶인 pending 이나 paid 로만
 *   남고, 취소·만료 경로는 키가 묶인 pending 을 건드리지 않는다(lib/orders/state.ts hasPaymentKey).
 *   그래도 키 없는 pending 에는 바인딩 도입 이전(캡처 후 클레임 실패로 키 없이 남은) 주문이나
 *   해제 경합 같은 예외가 섞일 수 있다. 그런 주문을 cancelled 로 바꾸면 이후 웹훅 DONE 은
 *   canTransition(cancelled→paid) 에 막혀 확정되지 않는다(돈은 청구됐는데 주문은 취소). 그래서 취소
 *   직전에 토스에 "이 orderId 로 승인된 결제가 있는가" 를 물어, **없다는 것이 확인될 때만** 취소한다
 *   — 키 바인딩 위에 얹는 추가 방어선이다.
 *
 * 조회 API: GET https://api.tosspayments.com/v1/payments/orders/{orderId}
 *   (토스 API 레퍼런스, 2026-09-17 확인 — "승인된 결제를 orderId 로 조회", Basic 인증)
 *   결제가 없으면 404 NOT_FOUND_PAYMENT | NOT_FOUND (레퍼런스 › 에러 코드 › 결제 조회).
 *
 * 판정 (classifyTossOrderLookup):
 *   - no_payment    : 404 NOT_FOUND_PAYMENT/NOT_FOUND, 또는 200 인데 status 가 ABORTED(승인 실패)
 *                     /EXPIRED(유효시간 30분 경과로 거래 취소). → 취소 허용.
 *   - payment_found : 200 + 그 밖의 모든 status(DONE·IN_PROGRESS·WAITING_FOR_DEPOSIT·CANCELED·
 *                     PARTIAL_CANCELED·READY·알 수 없는 값). → 취소 금지, 운영 확인 대상.
 *   - unavailable   : 네트워크 오류·timeout·401/403/5xx·응답 해석 불가·orderId 불일치·키 미설정.
 *                     → 취소 금지(fail-closed). 사용자에게는 재시도 안내, cron 은 다음 실행에서 재시도.
 *
 * toss_order_id 가 NULL 인 주문은 조회 없이 no_payment 로 본다: payments/confirm 은 토스 승인 호출
 * **전에** `order.toss_order_id !== tossOrderId` 를 400 으로 거부하고, 웹훅은 결제 키 또는
 * toss_order_id 로만 주문을 찾는다 — 우리 코드로는 이 주문에 돈이 캡처·연결될 경로가 없다.
 * (orders/create 는 최초 구현부터 toss_order_id 를 항상 채운다.)
 *
 * 인증 헤더 구성은 lib/payments/toss.ts 와 같다(여기서 복제 — 공용 헬퍼로 합치는 것은 별도 정리 대상).
 */

const TOSS_API_BASE = "https://api.tosspayments.com";

/** 사용자 요청 경로에서 기다릴 최대 시간 — 짧게 두고 실패는 재시도 안내로 돌린다. */
export const TOSS_ORDER_PROBE_TIMEOUT_MS = 5_000;

/** 토스가 "이 orderId 로 승인된 결제가 없다" 고 답하는 404 코드. */
const NOT_FOUND_CODES = new Set(["NOT_FOUND_PAYMENT", "NOT_FOUND"]);

/** 200 응답이어도 돈이 캡처되지 않았음이 확정인 결제 상태. 그 외는 전부 취소 금지. */
const UNCAPTURED_STATUS: Record<string, "aborted" | "expired"> = {
  ABORTED: "aborted",
  EXPIRED: "expired",
};

export type TossOrderProbe =
  | {
      kind: "no_payment";
      reason: "not_found" | "aborted" | "expired" | "no_toss_order_id";
    }
  | { kind: "payment_found"; tossStatus: string }
  | { kind: "unavailable"; code: string; message: string };

/** 토스 HTTP 응답 → 판정. 순수 함수 (테스트 고정 대상). */
export function classifyTossOrderLookup(input: {
  httpStatus: number;
  body: unknown;
  tossOrderId: string;
}): TossOrderProbe {
  const body =
    input.body !== null && typeof input.body === "object"
      ? (input.body as Record<string, unknown>)
      : null;
  const code = typeof body?.code === "string" ? body.code : null;

  if (input.httpStatus === 404 && code !== null && NOT_FOUND_CODES.has(code)) {
    return { kind: "no_payment", reason: "not_found" };
  }

  if (input.httpStatus === 200) {
    const status = typeof body?.status === "string" ? body.status : null;
    const orderId = typeof body?.orderId === "string" ? body.orderId : null;
    if (status === null || orderId === null) {
      return {
        kind: "unavailable",
        code: "TOSS_INVALID_RESPONSE",
        message: "토스 결제 조회 응답을 해석할 수 없습니다.",
      };
    }
    if (orderId !== input.tossOrderId) {
      return {
        kind: "unavailable",
        code: "TOSS_ORDER_ID_MISMATCH",
        message: "토스 결제 조회 응답의 주문번호가 요청과 다릅니다.",
      };
    }
    const uncaptured = UNCAPTURED_STATUS[status];
    if (uncaptured) return { kind: "no_payment", reason: uncaptured };
    return { kind: "payment_found", tossStatus: status };
  }

  return {
    kind: "unavailable",
    code: code ?? `TOSS_HTTP_${input.httpStatus}`,
    message:
      typeof body?.message === "string"
        ? body.message
        : `토스 결제 조회 실패 (HTTP ${input.httpStatus}).`,
  };
}

/**
 * 토스에 orderId 로 승인된 결제가 있는지 조회한다. **throw 하지 않는다** — 모든 실패는
 * unavailable 로 돌려 호출 측이 fail-closed 로 처리하게 한다.
 */
export async function probeTossOrder(
  tossOrderId: string | null,
  opts: { timeoutMs?: number } = {},
): Promise<TossOrderProbe> {
  if (tossOrderId === null || tossOrderId === "") {
    return { kind: "no_payment", reason: "no_toss_order_id" };
  }

  const secretKey = process.env.TOSS_SECRET_KEY;
  if (!secretKey) {
    return {
      kind: "unavailable",
      code: "TOSS_SECRET_MISSING",
      message: "TOSS_SECRET_KEY 환경변수가 설정되지 않았습니다.",
    };
  }

  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? TOSS_ORDER_PROBE_TIMEOUT_MS);
  try {
    const res = await fetch(
      `${TOSS_API_BASE}/v1/payments/orders/${encodeURIComponent(tossOrderId)}`,
      {
        method: "GET",
        headers: {
          Authorization: "Basic " + Buffer.from(`${secretKey}:`).toString("base64"),
        },
        cache: "no-store",
        signal: ctrl.signal,
      },
    );
    const body: unknown = await res.json().catch(() => null);
    return classifyTossOrderLookup({ httpStatus: res.status, body, tossOrderId });
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") {
      return { kind: "unavailable", code: "TOSS_TIMEOUT", message: "토스 결제 조회 시간 초과" };
    }
    return {
      kind: "unavailable",
      code: "TOSS_NETWORK_ERROR",
      message: e instanceof Error ? e.message : "토스 결제 조회 실패",
    };
  } finally {
    clearTimeout(timeout);
  }
}

export type ProbeCancelVerdict =
  | { kind: "proceed" }
  | {
      kind: "reject";
      status: 409 | 503;
      code: "PAYMENT_IN_PROGRESS" | "PAYMENT_STATUS_UNAVAILABLE";
      message: string;
    };

/** 사용자 취소 라우트용 — probe 결과를 응답 판정으로 바꾼다. 순수 함수. */
export function probeCancelVerdict(probe: TossOrderProbe): ProbeCancelVerdict {
  if (probe.kind === "no_payment") return { kind: "proceed" };
  if (probe.kind === "payment_found") {
    return {
      kind: "reject",
      status: 409,
      code: "PAYMENT_IN_PROGRESS",
      message:
        "결제 내역이 확인되는 주문이라 취소할 수 없어요. 결제 반영까지 잠시 기다려 주시고, 계속 결제 대기로 보이면 고객센터로 문의해 주세요.",
    };
  }
  return {
    kind: "reject",
    status: 503,
    code: "PAYMENT_STATUS_UNAVAILABLE",
    message: "결제 상태를 확인하지 못해 지금은 취소할 수 없어요. 잠시 후 다시 시도해 주세요.",
  };
}

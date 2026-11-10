/**
 * 오류 코드 → 사용자 안내 문구 + 다음 행동 매핑 (UX audit P10).
 *
 * - 순수 모듈: server-only 아님, 클라이언트에서 안전하게 import 한다.
 * - API 표준 응답 `{ ok:false, error:{ code, message } }` 와 토스 failUrl 의 code 를 같은 표로 푼다.
 * - 내부 코드·DB/스택 원문은 화면에 내보내지 않는다. 매핑이 없으면 호출자가 준 fallback 을 쓴다.
 */
import { CUSTOMER_CENTER_TEL, CUSTOMER_CENTER_TEL_HREF } from "@/lib/orders/customer-center";

export type UserErrorActionKind = "retry" | "login" | "support";

export interface UserErrorAction {
  label: string;
  href?: string;
  kind?: UserErrorActionKind;
}

export interface UserError {
  message: string;
  action?: UserErrorAction;
}

export const GENERIC_USER_ERROR_MESSAGE =
  "일시적인 문제가 생겼어요. 잠시 후 다시 시도해 주세요.";

const RETRY: UserErrorAction = { label: "다시 시도", kind: "retry" };
const LOGIN: UserErrorAction = { label: "로그인하기", href: "/login", kind: "login" };
const SUPPORT: UserErrorAction = {
  label: `고객센터 ${CUSTOMER_CENTER_TEL}`,
  href: CUSTOMER_CENTER_TEL_HREF,
  kind: "support",
};
const ORDERS: UserErrorAction = { label: "주문 내역 보기", href: "/mypage/orders" };

const MAP: Record<string, UserError> = {
  // 인증·권한
  UNAUTHORIZED: { message: "로그인이 필요해요. 로그인한 뒤 다시 시도해 주세요.", action: LOGIN },
  ACCOUNT_DELETED: { message: "탈퇴 처리된 계정이에요. 다른 계정으로 로그인해 주세요.", action: LOGIN },
  FORBIDDEN: { message: "이 작업을 할 수 있는 권한이 없어요. 내 계정의 항목인지 확인해 주세요." },
  NOT_FOUND: { message: "요청한 항목을 찾을 수 없어요. 삭제되었거나 주소가 바뀌었을 수 있어요." },
  RATE_LIMITED: { message: "요청이 너무 많아요. 잠시 후 다시 시도해 주세요.", action: RETRY },
  TOKEN_EXPIRED: { message: "링크가 만료되었어요. 새 링크를 요청해 주세요." },
  INVALID_TOKEN: { message: "유효하지 않은 링크예요. 주소를 다시 확인해 주세요." },

  // 편집 잠금·충돌
  PROJECT_LOCKED: {
    message: "결제가 진행된 책은 더 이상 편집할 수 없어요. 새로 만들려면 사본을 만들어 주세요.",
    action: { label: "내 책 보기", href: "/projects" },
  },
  EDIT_CONFLICT: { message: "다른 화면에서 먼저 저장된 내용이 있어요. 새로고침한 뒤 다시 편집해 주세요.", action: { label: "새로고침", kind: "retry" } },
  STATE_CHANGED: { message: "그 사이 상태가 바뀌었어요. 화면을 새로고침한 뒤 다시 시도해 주세요.", action: { label: "새로고침", kind: "retry" } },
  PLAN_CHANGED: { message: "요금 구성이 바뀌었어요. 화면을 새로고침해 금액을 다시 확인해 주세요.", action: { label: "새로고침", kind: "retry" } },
  ORDER_CHANGED: { message: "주문 내용이 바뀌었어요. 화면을 새로고침해 다시 확인해 주세요.", action: { label: "새로고침", kind: "retry" } },
  ORDER_PRICING_CHANGED: { message: "주문 금액이 바뀌었어요. 화면을 새로고침해 금액을 다시 확인해 주세요.", action: { label: "새로고침", kind: "retry" } },

  // 포인트·할인
  POINTS_INSUFFICIENT: { message: "보유 포인트가 부족해요. 사용할 포인트를 줄여 다시 시도해 주세요." },
  DISCOUNT_INVALID: { message: "사용할 수 없는 할인 코드예요. 코드를 다시 확인해 주세요." },

  // 주문·취소
  NOT_PENDING: { message: "이미 처리된 주문이에요. 주문 내역에서 상태를 확인해 주세요.", action: ORDERS },
  NOT_CANCELABLE_PAYMENT: { message: "지금은 결제를 취소할 수 없어요. 고객센터로 문의해 주세요.", action: SUPPORT },
  PAYMENT_NOT_CANCELABLE: { message: "지금은 결제를 취소할 수 없어요. 고객센터로 문의해 주세요.", action: SUPPORT },
  ORDER_NOT_CANCELLABLE: { message: "이 주문은 지금 취소할 수 없어요. 제작이 시작되었다면 고객센터로 문의해 주세요.", action: SUPPORT },
  ORDER_NOT_REFUNDABLE: { message: "이 주문은 환불할 수 없는 상태예요. 고객센터로 문의해 주세요.", action: SUPPORT },
  ALREADY_REFUNDED: { message: "이미 환불이 완료된 주문이에요.", action: ORDERS },
  ALREADY_CANCELED_PAYMENT: { message: "이미 취소된 결제예요.", action: ORDERS },
  ALREADY_PROCESSED_PAYMENT: { message: "이미 처리된 결제예요. 주문 내역에서 확인해 주세요.", action: ORDERS },
  ORDERS_IN_PROGRESS: { message: "진행 중인 주문이 있어 처리할 수 없어요. 주문이 끝난 뒤 다시 시도해 주세요.", action: ORDERS },
  VIRTUAL_ACCOUNT_REFUND_UNSUPPORTED: { message: "가상계좌 결제는 자동 환불이 어려워요. 고객센터로 문의해 주세요.", action: SUPPORT },

  // 결제 (금액·결제 정보 불일치는 고객센터 안내)
  AMOUNT_MISMATCH: { message: "결제 금액이 주문 금액과 달라 처리하지 못했어요. 고객센터로 문의해 주세요.", action: SUPPORT },
  PAYMENT_MISMATCH: { message: "결제 정보가 주문과 일치하지 않아요. 고객센터로 문의해 주세요.", action: SUPPORT },
  TOSS_PAYMENT_MISMATCH: { message: "결제 정보가 주문과 일치하지 않아요. 고객센터로 문의해 주세요.", action: SUPPORT },
  TOSS_ORDER_MISMATCH: { message: "결제 정보가 주문과 일치하지 않아요. 고객센터로 문의해 주세요.", action: SUPPORT },
  TOSS_ORDER_ID_MISMATCH: { message: "결제 정보가 주문과 일치하지 않아요. 고객센터로 문의해 주세요.", action: SUPPORT },
  PAYMENT_KEY_MISMATCH: { message: "결제 정보가 주문과 일치하지 않아요. 고객센터로 문의해 주세요.", action: SUPPORT },
  PAYMENT_KEY_CONFLICT: { message: "이미 다른 주문에 사용된 결제예요. 고객센터로 문의해 주세요.", action: SUPPORT },
  PAYMENT_CAPTURED_OR_IN_PROGRESS: { message: "결제가 이미 진행 중이거나 완료되었어요. 주문 내역에서 확인해 주세요.", action: ORDERS },
  PAYMENT_IN_PROGRESS: { message: "결제를 처리하고 있어요. 잠시 후 주문 내역에서 확인해 주세요.", action: ORDERS },
  IDEMPOTENT_REQUEST_PROCESSING: { message: "같은 요청을 처리하고 있어요. 잠시 후 주문 내역에서 확인해 주세요.", action: ORDERS },
  IN_PROGRESS: { message: "처리 중이에요. 잠시 후 다시 확인해 주세요.", action: RETRY },
  PAYMENT_STATUS_UNAVAILABLE: { message: "결제 상태를 확인하지 못했어요. 잠시 후 주문 내역에서 확인하고, 결제가 되었다면 고객센터로 문의해 주세요.", action: ORDERS },
  NOT_FOUND_PAYMENT: { message: "결제 내역을 찾을 수 없어요. 결제가 되었다면 고객센터로 문의해 주세요.", action: SUPPORT },
  NOT_FOUND_PAYMENT_SESSION: { message: "결제 시간이 지났어요. 주문서에서 다시 결제해 주세요." },
  PARTIAL_CANCELED_PAYMENT: { message: "부분 취소된 결제예요. 자세한 내용은 고객센터로 문의해 주세요.", action: SUPPORT },
  TOSS_TIMEOUT: { message: "결제 확인이 지연되고 있어요. 중복 결제를 막기 위해 주문 내역에서 결제 여부를 먼저 확인해 주세요.", action: ORDERS },
  TOSS_NETWORK_ERROR: { message: "결제사와 연결하지 못했어요. 잠시 후 다시 시도해 주세요.", action: RETRY },
  TOSS_HTTP_502: { message: "결제사 서버가 일시적으로 불안정해요. 잠시 후 다시 시도해 주세요.", action: RETRY },
  TOSS_HTTP_503: { message: "결제사 서버가 일시적으로 불안정해요. 잠시 후 다시 시도해 주세요.", action: RETRY },
  TOSS_INVALID_RESPONSE: { message: "결제 결과를 확인하지 못했어요. 주문 내역에서 결제 여부를 확인해 주세요.", action: ORDERS },
  TOSS_UNKNOWN_ERROR: { message: "결제 중 알 수 없는 문제가 생겼어요. 주문 내역에서 결제 여부를 확인해 주세요.", action: ORDERS },
  TOSS_CANCEL_UNVERIFIED: { message: "취소 결과를 확인하지 못했어요. 고객센터로 문의해 주세요.", action: SUPPORT },
  TOSS_SECRET_MISSING: { message: "결제 서비스를 사용할 수 없어요. 고객센터로 문의해 주세요.", action: SUPPORT },

  // 토스 failUrl 에서 오는 결제창 code
  PAY_PROCESS_CANCELED: { message: "결제창을 닫아 결제가 진행되지 않았어요. 준비되면 다시 결제해 주세요." },
  USER_CANCEL: { message: "결제창을 닫아 결제가 진행되지 않았어요. 준비되면 다시 결제해 주세요." },
  PAY_PROCESS_ABORTED: { message: "결제 진행 중 문제가 생겨 결제가 완료되지 않았어요. 다시 시도해 주세요.", action: RETRY },
  REJECT_CARD_COMPANY: { message: "카드사에서 결제를 거절했어요. 다른 카드로 시도하거나 카드사에 문의해 주세요.", action: RETRY },
  REJECT_CARD_PAYMENT: { message: "한도 초과 또는 잔액 부족으로 결제가 거절됐어요. 다른 카드로 시도해 주세요.", action: RETRY },
  INVALID_CARD_NUMBER: { message: "카드 번호를 다시 확인해 주세요.", action: RETRY },
  INVALID_CARD_EXPIRATION: { message: "카드 유효기간을 다시 확인해 주세요.", action: RETRY },
  EXCEED_MAX_CARD_INSTALLMENT_PLAN: { message: "선택한 할부 개월 수를 사용할 수 없어요. 다른 개월 수로 시도해 주세요.", action: RETRY },
  NOT_SUPPORTED_INSTALLMENT_PLAN_CARD_OR_MERCHANT: { message: "이 카드는 선택한 할부를 지원하지 않아요. 일시불이나 다른 카드로 시도해 주세요.", action: RETRY },
  FORBIDDEN_CONSECUTIVE_REQUEST: { message: "짧은 시간에 요청이 반복됐어요. 잠시 후 다시 시도해 주세요.", action: RETRY },
  FAILED_INTERNAL_SYSTEM_PROCESSING: { message: "결제사 처리 중 문제가 생겼어요. 잠시 후 다시 시도해 주세요.", action: RETRY },
  FAILED_PAYMENT_INTERNAL_SYSTEM_PROCESSING: { message: "결제사 처리 중 문제가 생겼어요. 잠시 후 다시 시도해 주세요.", action: RETRY },

  // 사진·업로드·공유
  LOW_RESOLUTION: { message: "사진 해상도가 낮아 인쇄 품질이 떨어질 수 있어요. 더 큰 사진을 사용해 주세요." },
  FILE_CORRUPTED: { message: "손상된 파일이라 불러올 수 없어요. 다른 사진을 선택해 주세요." },
  FILE_NOT_FOUND: { message: "파일을 찾을 수 없어요. 다시 업로드해 주세요." },
  INVALID_FILE: { message: "지원하지 않는 파일이에요. JPG, PNG 사진을 사용해 주세요." },
  EMPTY_FILE: { message: "비어 있는 파일이에요. 다른 사진을 선택해 주세요." },
  ALREADY_SENT: { message: "이미 보낸 선물이에요." },
};

/** 서버 내부 오류 계열 — 서버 메시지에 DB/스택 원문이 섞일 수 있어 항상 일반 문구로 치환한다. */
const INTERNAL_CODE_PATTERN =
  /(_FAILED|_ERROR|_UNAVAILABLE|_NOT_CONFIGURED|_NOT_S3)$|^(INTERNAL|EXCEPTION|ERROR|UNKNOWN|DB_ERROR|PROVIDER_ERROR)$|^(PG|P0|XX|23|42)[A-Z0-9]*$|^[0-9]{5}$/;

const VALIDATION_USER_ERROR: UserError = {
  message: "입력한 내용을 다시 확인해 주세요.",
};

const VALIDATION_CODE_PATTERN = /^(INVALID_|VALIDATION)/;

/**
 * 서버가 준 한국어 안내 문구가 화면에 그대로 나가도 안전한지 판정한다.
 * 한글이 있고, 내부 식별자(SNAKE_CASE·snake_case·점 표기)·스택·SQL 흔적이 없고, 짧을 때만 true.
 */
export function isSafeServerMessage(text: unknown): text is string {
  if (typeof text !== "string") return false;
  const t = text.trim();
  if (t.length === 0 || t.length > 120) return false;
  if (!/[가-힣]/.test(t)) return false;
  if (/[A-Z][A-Z0-9]*_[A-Z0-9_]+/.test(t)) return false;
  if (/[a-z]+_[a-z_]+/.test(t)) return false;
  if (/\b[a-z]+\.[a-z_]+\b/.test(t)) return false;
  if (/\n|\bat\s+\S+\s*\(|Error:|Exception|violates|constraint|relation|syntax|SELECT|INSERT|UPDATE|DELETE/i.test(t)) return false;
  return true;
}

/**
 * 오류 코드 → 사용자 안내.
 * 우선순위: 매핑 표 → (내부 오류 계열이면) 일반 문구 → 검증 계열이면 안전한 서버 문구 → fallback.
 * fallback 은 호출자가 쓰는 화면별 한국어 문구(예: "삭제에 실패했어요.")다.
 */
export function userErrorFor(
  code: string | undefined | null,
  fallback?: string,
  serverMessage?: unknown,
): UserError {
  const normalized = typeof code === "string" ? code.trim() : "";
  const mapped = normalized ? MAP[normalized] : undefined;
  if (mapped) return mapped;

  const fallbackMessage = fallback ?? GENERIC_USER_ERROR_MESSAGE;
  if (normalized && INTERNAL_CODE_PATTERN.test(normalized)) {
    return { message: fallbackMessage, action: RETRY };
  }
  if (isSafeServerMessage(serverMessage)) {
    return { message: serverMessage.trim() };
  }
  if (normalized && VALIDATION_CODE_PATTERN.test(normalized)) {
    return fallback ? { message: fallback } : VALIDATION_USER_ERROR;
  }
  return { message: fallbackMessage };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * API 표준 응답 본문(`{ ok:false, error:{ code, message } }`)을 사용자 안내로 변환.
 * 본문이 JSON 이 아니거나(네트워크·프록시 오류) 코드가 없으면 HTTP status 로 대체 판정한다.
 */
export function userErrorFromJson(
  body: unknown,
  fallback?: string,
  status?: number,
): UserError {
  const error = isRecord(body) && isRecord(body.error) ? body.error : null;
  const code = error && typeof error.code === "string" ? error.code : undefined;
  if (!code && status !== undefined) {
    const byStatus = userErrorForStatus(status, fallback);
    if (byStatus) return byStatus;
  }
  return userErrorFor(code, fallback, error?.message);
}

/** HTTP status 만 알 수 있을 때의 안내. 해당 없으면 undefined. */
export function userErrorForStatus(status: number, fallback?: string): UserError | undefined {
  if (status === 401) return MAP.UNAUTHORIZED;
  if (status === 403) return MAP.FORBIDDEN;
  if (status === 404) return MAP.NOT_FOUND;
  if (status === 429) return MAP.RATE_LIMITED;
  if (status >= 500) return { message: fallback ?? GENERIC_USER_ERROR_MESSAGE, action: RETRY };
  return undefined;
}

/** fetch Response 를 사용자 안내로 변환 (본문은 한 번만 읽는다). */
export async function userErrorFromResponse(res: Response, fallback?: string): Promise<UserError> {
  const body: unknown = await res.json().catch(() => null);
  return userErrorFromJson(body, fallback, res.status);
}

/** 문구만 필요한 곳(throw new Error(...), toast)용 단축형. */
export function userMessageFromJson(body: unknown, fallback?: string, status?: number): string {
  return userErrorFromJson(body, fallback, status).message;
}

/**
 * 토스 failUrl 의 code/message query → 사용자 안내.
 * 매핑이 없는 code 는 토스가 준 한국어 message 가 안전 판정을 통과할 때만 쓰고, 아니면 일반 문구를 쓴다.
 * code 자체는 화면에 노출하지 않는다.
 */
export function userErrorFromTossFail(
  code: string | undefined,
  tossMessage?: string,
  fallback?: string,
): UserError {
  return userErrorFor(
    code,
    fallback ?? "결제가 정상적으로 처리되지 않았어요. 잠시 후 다시 시도해 주세요.",
    tossMessage,
  );
}

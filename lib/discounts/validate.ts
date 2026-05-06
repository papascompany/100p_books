import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database, DiscountCode } from "@/lib/db/types";

/**
 * 할인 코드 검증.
 *
 *   - validate API + orders/create 양쪽에서 동일한 로직을 사용해야 가격 일관성을 보장.
 *   - service_role(admin) 클라이언트로 호출해야 RLS 우회 + 정확한 used_count 조회.
 *
 * 반환:
 *   { valid: true, code, discountAmount } 또는
 *   { valid: false, reason }
 */

export type DiscountInvalidReason =
  | "not_found"
  | "inactive"
  | "expired"
  | "limit_reached"
  | "already_used"
  | "subtotal_too_low";

export interface DiscountValidationOk {
  valid: true;
  code: DiscountCode;
  /** subtotal 에서 차감될 금액 (KRW 정수). subtotal 을 초과하지 않음. */
  discountAmount: number;
}

export interface DiscountValidationFail {
  valid: false;
  reason: DiscountInvalidReason;
}

export type DiscountValidation = DiscountValidationOk | DiscountValidationFail;

export interface ValidateDiscountArgs {
  supabase: SupabaseClient<Database>;
  /** 사용자 입력 코드 — 대소문자 무시 + 좌우 공백 정리. */
  code: string;
  /** 검증 대상 사용자 (1인 1회 제한). */
  userId: string;
  /** 할인 적용 전 합계 (KRW). 음수 방지 + 비율 계산. */
  subtotal: number;
}

/**
 * 입력된 코드를 정규화 — 영문 대문자 + trim.
 */
export function normalizeCode(code: string): string {
  return code.trim().toUpperCase();
}

/**
 * 코드 + (subtotal, userId) 검증. used_count 와 discount_uses 모두 확인.
 *
 * 호출측은 결제 confirm 직전에 한 번 더 호출하여 race condition 을 최소화한다.
 * (실제 사용 마킹은 결제 성공 후 별도 트랜잭션.)
 */
export async function validateDiscount(
  args: ValidateDiscountArgs,
): Promise<DiscountValidation> {
  const code = normalizeCode(args.code);
  if (!code) return { valid: false, reason: "not_found" };

  const { data: row, error } = await args.supabase
    .from("discount_codes")
    .select(
      "id, code, type, value, max_uses, used_count, expires_at, active, created_by, created_at",
    )
    .eq("code", code)
    .maybeSingle();

  if (error) {
    // 쿼리 자체가 실패 → 호출측이 fail 응답으로 처리하도록 throw.
    const e = new Error(`discount_codes 조회 실패: ${error.message}`) as Error & {
      status?: number;
      code?: string;
    };
    e.status = 500;
    e.code = "DISCOUNT_QUERY_FAILED";
    throw e;
  }
  if (!row) return { valid: false, reason: "not_found" };

  const dc: DiscountCode = row;

  if (!dc.active) return { valid: false, reason: "inactive" };

  if (dc.expires_at) {
    const expiresAt = new Date(dc.expires_at).getTime();
    if (Number.isFinite(expiresAt) && expiresAt <= Date.now()) {
      return { valid: false, reason: "expired" };
    }
  }

  if (dc.max_uses !== null && dc.used_count >= dc.max_uses) {
    return { valid: false, reason: "limit_reached" };
  }

  // 1인 1회 — discount_uses 확인.
  const { count: useCount, error: useErr } = await args.supabase
    .from("discount_uses")
    .select("id", { count: "exact", head: true })
    .eq("code_id", dc.id)
    .eq("user_id", args.userId);

  if (useErr) {
    const e = new Error(`discount_uses 조회 실패: ${useErr.message}`) as Error & {
      status?: number;
      code?: string;
    };
    e.status = 500;
    e.code = "DISCOUNT_USE_QUERY_FAILED";
    throw e;
  }
  if ((useCount ?? 0) > 0) return { valid: false, reason: "already_used" };

  if (!Number.isFinite(args.subtotal) || args.subtotal <= 0) {
    return { valid: false, reason: "subtotal_too_low" };
  }

  const discountAmount = computeDiscountAmount(dc, args.subtotal);
  if (discountAmount <= 0) {
    return { valid: false, reason: "subtotal_too_low" };
  }

  return { valid: true, code: dc, discountAmount };
}

/**
 * 코드 정책 + subtotal 로 실제 할인 금액 계산. (KRW 정수, subtotal 캡)
 */
export function computeDiscountAmount(
  code: Pick<DiscountCode, "type" | "value">,
  subtotal: number,
): number {
  const safeSubtotal = Math.max(0, Math.floor(subtotal));
  if (safeSubtotal <= 0) return 0;
  if (code.type === "percent") {
    const ratio = Math.max(0, Math.min(100, Number(code.value))) / 100;
    return Math.min(safeSubtotal, Math.round(safeSubtotal * ratio));
  }
  // amount
  const v = Math.max(0, Math.floor(Number(code.value)));
  return Math.min(safeSubtotal, v);
}

/**
 * INVALID reason → 한글 메시지 매핑 (UI/응답 메시지에 사용).
 */
export function reasonMessage(reason: DiscountInvalidReason): string {
  switch (reason) {
    case "not_found":
      return "유효하지 않은 코드입니다.";
    case "inactive":
      return "사용할 수 없는 코드입니다.";
    case "expired":
      return "만료된 코드입니다.";
    case "limit_reached":
      return "사용 한도에 도달한 코드입니다.";
    case "already_used":
      return "이미 사용한 코드입니다.";
    case "subtotal_too_low":
      return "주문 금액이 할인 적용 조건을 충족하지 못합니다.";
    default:
      return "코드를 사용할 수 없습니다.";
  }
}

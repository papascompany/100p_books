import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database, OrderStatus } from "@/lib/db/types";
import {
  checkDiscountCodeState,
  type DiscountCodeStateReason,
} from "@/lib/discounts/amount";

/**
 * 주문 크레딧(사용 포인트 + 할인 코드) 선점·해제·복원.
 *
 *   - reserveOrderCredits : 결제 캡처 **전** 포인트 차감 + 할인 사용 기록 선점 (SEC-7, DEBT-7).
 *   - releaseOrderCredits : 캡처 실패·금액 불일치 시 선점 해제 (pending 주문).
 *   - restoreOrderCredits : 환불/취소 시 복원 (refunded·cancelled 주문).
 *
 * "이 주문에 실제로 잡혀 있는 크레딧" 의 정본:
 *   - 포인트  = point_ledger 에서 (ref_type='orders', ref_id=주문) 인 order_use + order_refund 순액.
 *   - 할인    = discount_uses.order_id = 주문 인 행.
 *   그래서 차감된 적 없는 포인트는 복원하지 않고, 사용 기록이 없는 할인은 감액하지 않는다.
 *   같은 함수를 두 번 불러도 두 번째는 되돌릴 것이 없다(멱등).
 *
 * 원자성: 0033 의 reserve_order_credits / release_order_credits RPC 가 주문 행 잠금 아래
 * 한 트랜잭션으로 처리한다. 마이그레이션 적용 전(RPC 없음)에는 기존 경로로 폴백한다 —
 * 선점은 사전 검사만 하고(차감은 finalizePaidOrder 가 캡처 후 실행), 복원은 원장 기준.
 */

type Admin = SupabaseClient<Database>;

export interface DbErrorLike {
  code?: string;
  message: string;
}

/**
 * PostgREST/Postgres "객체 없음" 오류 — 마이그레이션 미적용 판정용.
 *   PGRST202 함수 없음 · 42883 undefined_function · 42703 컬럼 없음(select/filter) ·
 *   PGRST204 컬럼 없음(insert/update 본문)
 */
export function isMissingDbObjectError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const code = (err as { code?: unknown }).code;
  return (
    code === "PGRST202" ||
    code === "42883" ||
    code === "42703" ||
    code === "PGRST204"
  );
}

function errMessage(err: unknown): string {
  if (err && typeof err === "object" && "message" in err) {
    return String((err as { message: unknown }).message);
  }
  return String(err);
}

/** 서버 오류를 failFromError 가 500 으로 변환할 수 있는 형태로. */
function serverError(code: string, message: string): Error {
  const e = new Error(message) as Error & { status: number; code: string };
  e.status = 500;
  e.code = code;
  return e;
}

/** 타입 정의(lib/db/types)에 없는 0033 RPC 호출용 느슨한 시그니처. */
type LooseRpcClient = {
  rpc: (
    fn: string,
    args: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: DbErrorLike | null }>;
};

function looseRpc(admin: Admin): LooseRpcClient {
  return admin as unknown as LooseRpcClient;
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
}

function asInt(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? Math.trunc(v) : 0;
}

/**
 * 이 주문에 잡혀 있는 포인트 (원장 순액, 양수 = 차감된 채 남아 있음).
 * 조회 실패는 throw — 추정으로 차감·복원하지 않는다.
 */
export async function sumHeldOrderPoints(
  admin: Admin,
  orderId: string,
): Promise<number> {
  const { data, error } = await admin
    .from("point_ledger")
    .select("amount")
    .eq("ref_type", "orders")
    .eq("ref_id", orderId)
    .in("reason", ["order_use", "order_refund"]);
  if (error) {
    throw serverError("POINT_LEDGER_QUERY_FAILED", error.message);
  }
  const net = (data ?? []).reduce(
    (acc, row) => acc + asInt((row as { amount?: unknown }).amount),
    0,
  );
  return net === 0 ? 0 : -net;
}

// =====================================================================
// 선점 (캡처 전)
// =====================================================================

export type ReserveFailureCode =
  | "NOT_FOUND"
  | "NOT_PENDING"
  | "ORDER_CHANGED"
  | "PAYMENT_KEY_CONFLICT"
  | "CREDITS_STATE_INVALID"
  | "POINTS_INSUFFICIENT"
  | "DISCOUNT_INVALID"
  | "INVALID_ARGS";

export type ReserveDiscountReason =
  | DiscountCodeStateReason
  | "not_found"
  | "already_used";

export type CreditsMode = "atomic" | "legacy";

export type ReserveOrderCreditsResult =
  | {
      ok: true;
      mode: CreditsMode;
      /** 이번 호출로 새로 차감한 포인트 (이미 잡혀 있었으면 0). */
      pointsReserved: number;
      /** 이번 호출로 할인 사용을 새로 기록했는가. */
      discountReserved: boolean;
    }
  | {
      ok: false;
      mode: CreditsMode;
      code: ReserveFailureCode;
      reason?: ReserveDiscountReason;
      balance?: number;
      requested?: number;
      status?: string;
    };

export interface ReserveOrderCreditsArgs {
  orderId: string;
  paymentKey: string;
  /** 클라이언트가 결제한 금액 — 주문 행과 다르면 ORDER_CHANGED. */
  amount: number;
  tossOrderId: string;
}

const RESERVE_FAILURE_CODES: ReadonlySet<string> = new Set<ReserveFailureCode>([
  "NOT_FOUND",
  "NOT_PENDING",
  "ORDER_CHANGED",
  "PAYMENT_KEY_CONFLICT",
  "CREDITS_STATE_INVALID",
  "POINTS_INSUFFICIENT",
  "DISCOUNT_INVALID",
  "INVALID_ARGS",
]);

/**
 * 캡처 전 크레딧 선점 + paymentKey 바인딩.
 *
 *   ok=true 이면 이 주문에 포인트·할인이 잡혀 있고(원자 모드), paymentKey 가 주문에 묶여
 *   다른 결제 시도·주문서 재사용(orders/create)이 이 주문을 건드리지 못한다.
 *   ok=false 이면 아무것도 바뀌지 않았다 — 캡처하지 말 것.
 *
 * DB 오류는 throw (호출측 500).
 */
export async function reserveOrderCredits(
  admin: Admin,
  args: ReserveOrderCreditsArgs,
): Promise<ReserveOrderCreditsResult> {
  const { data, error } = await looseRpc(admin).rpc("reserve_order_credits", {
    p_order_id: args.orderId,
    p_payment_key: args.paymentKey,
    p_amount: args.amount,
    p_toss_order_id: args.tossOrderId,
  });
  if (error) {
    if (isMissingDbObjectError(error)) {
      return legacyReserveOrderCredits(admin, args);
    }
    throw serverError("CREDITS_RESERVE_FAILED", error.message);
  }
  const r = asRecord(data);
  if (r.ok === true) {
    return {
      ok: true,
      mode: "atomic",
      pointsReserved: asInt(r.pointsReserved),
      discountReserved: r.discountReserved === true,
    };
  }
  const code = typeof r.code === "string" ? r.code : "";
  if (!RESERVE_FAILURE_CODES.has(code)) {
    throw serverError(
      "CREDITS_RESERVE_FAILED",
      `reserve_order_credits 응답을 해석할 수 없습니다: ${JSON.stringify(data)}`,
    );
  }
  return {
    ok: false,
    mode: "atomic",
    code: code as ReserveFailureCode,
    ...(typeof r.reason === "string"
      ? { reason: r.reason as ReserveDiscountReason }
      : {}),
    ...(r.balance !== undefined ? { balance: asInt(r.balance) } : {}),
    ...(r.requested !== undefined ? { requested: asInt(r.requested) } : {}),
    ...(typeof r.status === "string" ? { status: r.status } : {}),
  };
}

interface CreditOrderRow {
  id: string;
  user_id: string;
  status: OrderStatus;
  amount: number;
  toss_order_id: string | null;
  toss_payment_key: string | null;
  points_used: number;
  discount_code_id: string | null;
}

const CREDIT_ORDER_COLUMNS =
  "id, user_id, status, amount, toss_order_id, toss_payment_key, points_used, discount_code_id";

async function loadCreditOrder(
  admin: Admin,
  orderId: string,
): Promise<CreditOrderRow | null> {
  const { data, error } = await admin
    .from("orders")
    .select(CREDIT_ORDER_COLUMNS)
    .eq("id", orderId)
    .maybeSingle();
  if (error) throw serverError("ORDER_QUERY_FAILED", error.message);
  return (data as CreditOrderRow | null) ?? null;
}

function checkOrderIdentity(
  order: CreditOrderRow | null,
  args: ReserveOrderCreditsArgs,
): ReserveOrderCreditsResult | null {
  if (!order) return { ok: false, mode: "legacy", code: "NOT_FOUND" };
  if (order.status !== "pending") {
    return { ok: false, mode: "legacy", code: "NOT_PENDING", status: order.status };
  }
  if (order.amount !== args.amount || order.toss_order_id !== args.tossOrderId) {
    return { ok: false, mode: "legacy", code: "ORDER_CHANGED" };
  }
  if (order.toss_payment_key && order.toss_payment_key !== args.paymentKey) {
    return { ok: false, mode: "legacy", code: "PAYMENT_KEY_CONFLICT" };
  }
  return null;
}

/**
 * 0033 미적용 폴백 — 기존 경로(캡처 전 **조회만**, 차감은 캡처 후 finalize).
 * 주문 간 동시 이중 사용(SEC-7) 창은 남는다: 마이그레이션 적용이 해소 조건.
 * 대신 할인 코드의 active·expires_at·max_uses 재검증(DEBT-7 b)과 paymentKey 바인딩은 한다.
 */
async function legacyReserveOrderCredits(
  admin: Admin,
  args: ReserveOrderCreditsArgs,
): Promise<ReserveOrderCreditsResult> {
  if (!args.paymentKey) return { ok: false, mode: "legacy", code: "INVALID_ARGS" };
  const order = await loadCreditOrder(admin, args.orderId);
  const identityFail = checkOrderIdentity(order, args);
  if (identityFail || !order) {
    return identityFail ?? { ok: false, mode: "legacy", code: "NOT_FOUND" };
  }

  if (order.points_used > 0) {
    const { data: pts, error: ptsErr } = await admin
      .from("user_points")
      .select("balance")
      .eq("user_id", order.user_id)
      .maybeSingle();
    if (ptsErr) throw serverError("POINTS_QUERY_FAILED", ptsErr.message);
    const balance = pts?.balance ?? 0;
    if (balance < order.points_used) {
      return {
        ok: false,
        mode: "legacy",
        code: "POINTS_INSUFFICIENT",
        balance,
        requested: order.points_used,
      };
    }
  }

  if (order.discount_code_id) {
    const { data: dc, error: dcErr } = await admin
      .from("discount_codes")
      .select("id, active, expires_at, max_uses, used_count")
      .eq("id", order.discount_code_id)
      .maybeSingle();
    if (dcErr) throw serverError("DISCOUNT_QUERY_FAILED", dcErr.message);
    if (!dc) {
      return { ok: false, mode: "legacy", code: "DISCOUNT_INVALID", reason: "not_found" };
    }
    const stateReason = checkDiscountCodeState(dc);
    if (stateReason) {
      return { ok: false, mode: "legacy", code: "DISCOUNT_INVALID", reason: stateReason };
    }
    // 같은 사용자의 다른 주문(또는 주문이 지워진 기록)에서 이미 쓴 코드.
    const { count, error: duErr } = await admin
      .from("discount_uses")
      .select("id", { count: "exact", head: true })
      .eq("code_id", order.discount_code_id)
      .eq("user_id", order.user_id)
      .or(`order_id.is.null,order_id.neq.${order.id}`);
    if (duErr) throw serverError("DISCOUNT_QUERY_FAILED", duErr.message);
    if ((count ?? 0) > 0) {
      return { ok: false, mode: "legacy", code: "DISCOUNT_INVALID", reason: "already_used" };
    }
  }

  if (!order.toss_payment_key) {
    const { data: bound, error: bindErr } = await admin
      .from("orders")
      .update({ toss_payment_key: args.paymentKey })
      .eq("id", order.id)
      .eq("status", "pending")
      .eq("amount", args.amount)
      .eq("toss_order_id", args.tossOrderId)
      .is("toss_payment_key", null)
      .select("id")
      .maybeSingle();
    if (bindErr) throw serverError("ORDER_UPDATE_FAILED", bindErr.message);
    if (!bound) {
      // 그 사이 다른 요청이 바꿈 — 현재 상태로 다시 판정(같은 키로 묶였으면 통과).
      const again = await loadCreditOrder(admin, args.orderId);
      const fail = checkOrderIdentity(again, args);
      if (fail) return fail;
      if (!again || again.toss_payment_key !== args.paymentKey) {
        return { ok: false, mode: "legacy", code: "PAYMENT_KEY_CONFLICT" };
      }
    }
  }

  return { ok: true, mode: "legacy", pointsReserved: 0, discountReserved: false };
}

// =====================================================================
// 해제 (캡처 실패) / 복원 (환불·취소)
// =====================================================================

export type ReleaseFailureCode =
  | "NOT_FOUND"
  | "NOT_PENDING"
  | "PAYMENT_KEY_MISMATCH"
  | "NOT_RELEASABLE_STATE"
  | "INVALID_MODE"
  | "RELEASE_FAILED";

export type ReleaseCreditsResult =
  | {
      ok: true;
      mode: CreditsMode;
      pointsRestored: number;
      discountUsesRestored: number;
    }
  | {
      ok: false;
      mode: CreditsMode;
      code: ReleaseFailureCode;
      status?: string;
      message?: string;
    };

const RELEASE_FAILURE_CODES: ReadonlySet<string> = new Set<ReleaseFailureCode>([
  "NOT_FOUND",
  "NOT_PENDING",
  "PAYMENT_KEY_MISMATCH",
  "NOT_RELEASABLE_STATE",
  "INVALID_MODE",
]);

async function callReleaseRpc(
  admin: Admin,
  args: {
    orderId: string;
    mode: "abort" | "refund";
    paymentKey: string | null;
    clearPaymentKey: boolean;
  },
): Promise<ReleaseCreditsResult | "missing"> {
  const { data, error } = await looseRpc(admin).rpc("release_order_credits", {
    p_order_id: args.orderId,
    p_mode: args.mode,
    p_payment_key: args.paymentKey,
    p_clear_payment_key: args.clearPaymentKey,
  });
  if (error) {
    if (isMissingDbObjectError(error)) return "missing";
    return { ok: false, mode: "atomic", code: "RELEASE_FAILED", message: error.message };
  }
  const r = asRecord(data);
  if (r.ok === true) {
    return {
      ok: true,
      mode: "atomic",
      pointsRestored: asInt(r.pointsRestored),
      discountUsesRestored: asInt(r.discountUsesRestored),
    };
  }
  const code = typeof r.code === "string" ? r.code : "";
  return {
    ok: false,
    mode: "atomic",
    code: RELEASE_FAILURE_CODES.has(code) ? (code as ReleaseFailureCode) : "RELEASE_FAILED",
    ...(typeof r.status === "string" ? { status: r.status } : {}),
  };
}

/**
 * 캡처 실패·금액 불일치 시 선점 해제 (best-effort — throw 하지 않음).
 *
 *   주문이 아직 pending 이고 같은 paymentKey 로 묶여 있을 때만 되돌린다. 그 사이 다른 경로가
 *   paid 로 확정했다면 NOT_PENDING 으로 아무것도 하지 않는다.
 *   clearPaymentKey=false 는 "캡처는 됐지만 주문과 맞지 않는 결제" 처럼 추적용으로
 *   paymentKey 를 남겨야 할 때 쓴다.
 */
export async function releaseOrderCredits(
  admin: Admin,
  args: { orderId: string; paymentKey: string; clearPaymentKey: boolean },
): Promise<ReleaseCreditsResult> {
  try {
    const r = await callReleaseRpc(admin, {
      orderId: args.orderId,
      mode: "abort",
      paymentKey: args.paymentKey,
      clearPaymentKey: args.clearPaymentKey,
    });
    if (r !== "missing") {
      if (!r.ok && r.code === "RELEASE_FAILED") {
        console.error("[orders/credits] 선점 해제 실패:", args.orderId, r.message);
      }
      return r;
    }
    // 폴백: 원자 모드가 아니면 캡처 전에 잡은 크레딧이 없다 → paymentKey 바인딩만 푼다.
    if (args.clearPaymentKey) {
      const { error } = await admin
        .from("orders")
        .update({ toss_payment_key: null })
        .eq("id", args.orderId)
        .eq("status", "pending")
        .eq("toss_payment_key", args.paymentKey);
      if (error) {
        console.error("[orders/credits] paymentKey 바인딩 해제 실패:", error.message);
        return { ok: false, mode: "legacy", code: "RELEASE_FAILED", message: error.message };
      }
    }
    return { ok: true, mode: "legacy", pointsRestored: 0, discountUsesRestored: 0 };
  } catch (e) {
    console.error("[orders/credits] 선점 해제 예외:", args.orderId, errMessage(e));
    return { ok: false, mode: "legacy", code: "RELEASE_FAILED", message: errMessage(e) };
  }
}

/**
 * 환불·취소 시 사용 포인트 + 할인 복원 (best-effort — throw 하지 않음).
 *
 *   - 주문이 refunded 또는 cancelled 로 **이미 전이된 뒤** 호출한다(그 외 상태면 no-op).
 *   - 실제로 잡혀 있던 것만 되돌린다: 원장 순액 포인트, 이 주문의 discount_uses 행.
 *     차감에 실패했던 주문(DEBT-7 a)이나 23505 로 사용 기록이 없던 주문은 복원·감액하지 않는다.
 *   - 멱등: 두 번 불러도 두 번째는 되돌릴 것이 없다. 호출측의 조건부 클레임은 여전히 권장.
 *
 * 시그니처는 기존과 같다(관리자 transition·웹훅·결제 취소 경로가 호출). 반환값은 선택적으로 사용.
 */
export async function restoreOrderCredits(
  admin: Admin,
  order: {
    id: string;
    user_id: string;
    points_used: number;
    discount_code_id: string | null;
  },
): Promise<ReleaseCreditsResult> {
  try {
    const r = await callReleaseRpc(admin, {
      orderId: order.id,
      mode: "refund",
      paymentKey: null,
      clearPaymentKey: false,
    });
    if (r !== "missing") {
      if (!r.ok) {
        console.warn("[orders/refund] 크레딧 복원 안 됨:", order.id, r.code, r.message ?? "");
      }
      return r;
    }
    return await legacyRestoreOrderCredits(admin, order);
  } catch (e) {
    console.warn("[orders/refund] 크레딧 복원 예외:", order.id, errMessage(e));
    return { ok: false, mode: "legacy", code: "RELEASE_FAILED", message: errMessage(e) };
  }
}

const RELEASABLE_STATUSES: ReadonlySet<OrderStatus> = new Set<OrderStatus>([
  "refunded",
  "cancelled",
]);

/** 0033 미적용 폴백 — 원장·사용 기록 기준 복원 (원자성은 호출측 조건부 클레임에 의존). */
async function legacyRestoreOrderCredits(
  admin: Admin,
  order: { id: string; user_id: string },
): Promise<ReleaseCreditsResult> {
  const { data: row, error: rowErr } = await admin
    .from("orders")
    .select("id, status")
    .eq("id", order.id)
    .maybeSingle();
  if (rowErr) {
    return { ok: false, mode: "legacy", code: "RELEASE_FAILED", message: rowErr.message };
  }
  if (!row) return { ok: false, mode: "legacy", code: "NOT_FOUND" };
  if (!RELEASABLE_STATUSES.has(row.status)) {
    console.warn("[orders/refund] 환불/취소 상태가 아니라 복원하지 않음:", order.id, row.status);
    return { ok: false, mode: "legacy", code: "NOT_RELEASABLE_STATE", status: row.status };
  }

  let discountUsesRestored = 0;
  const { data: deleted, error: delErr } = await admin
    .from("discount_uses")
    .delete()
    .eq("order_id", order.id)
    .select("code_id");
  if (delErr) {
    console.warn("[orders/refund] 할인 사용 기록 삭제 실패:", delErr.message);
  } else {
    for (const d of deleted ?? []) {
      if (await decrementDiscountUsedCas(admin, d.code_id)) discountUsesRestored += 1;
    }
  }

  let pointsRestored = 0;
  const held = await sumHeldOrderPoints(admin, order.id);
  if (held > 0) {
    const { error } = await admin.rpc("add_user_points_v2", {
      p_user_id: order.user_id,
      p_amount: held,
      p_reason: "order_refund",
      p_ref_type: "orders",
      p_ref_id: order.id,
      p_memo: `주문 ${order.id.slice(0, 8)} 환불/취소 — 사용 포인트 복원`,
    });
    if (error) {
      console.warn("[orders/refund] 포인트 복원 실패:", error.message);
      return { ok: false, mode: "legacy", code: "RELEASE_FAILED", message: error.message };
    }
    pointsRestored = held;
  }

  return { ok: true, mode: "legacy", pointsRestored, discountUsesRestored };
}

/** used_count 1 감액 — 비교 후 교체(CAS)로 lost-update 방지. 0 미만으로 내리지 않는다. */
async function decrementDiscountUsedCas(admin: Admin, codeId: string): Promise<boolean> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const { data: dc, error } = await admin
      .from("discount_codes")
      .select("used_count")
      .eq("id", codeId)
      .maybeSingle();
    if (error || !dc) return false;
    if (dc.used_count <= 0) return true;
    const { data: updated, error: upErr } = await admin
      .from("discount_codes")
      .update({ used_count: dc.used_count - 1 })
      .eq("id", codeId)
      .eq("used_count", dc.used_count)
      .select("id")
      .maybeSingle();
    if (upErr) return false;
    if (updated) return true;
  }
  console.warn("[orders/refund] used_count 감액 경합 — 재시도 한도 초과:", codeId);
  return false;
}

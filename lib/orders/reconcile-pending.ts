import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database, OrderStatus } from "@/lib/db/types";
import {
  finalizePaidOrder,
  type FinalizePaidOrderResult,
  type PaidOrderEmailSender,
} from "@/lib/orders/finalize-paid";
import { releaseOrderCredits, type ReleaseCreditsResult } from "@/lib/orders/refund";
import type { TossOrderProbe } from "@/lib/orders/toss-order-probe";
import {
  classifyTossPaymentStatus,
  fetchTossPayment,
  findTossPaymentMismatch,
  isTossLookupNotFound,
  TossError,
  type TossConfirmResponse,
} from "@/lib/payments/toss";

/**
 * 결제 키가 묶인 채 남은 pending 주문을 토스 원장 기준으로 수렴시키는 관리자 도구 (런북 백로그
 * "결제 키가 남은 오래된 pending 주문", STATUS §0-11 D).
 *
 * 왜 필요한가:
 *   payments/confirm 은 토스 승인(캡처) **전에** toss_payment_key 를 바인딩한다(0033). 캡처 뒤
 *   확정(pending→paid)이 실패하면 주문은 키가 묶인 pending 으로 남고, 그 수렴은 웹훅 재전송과
 *   고객 새로고침에만 의존한다. 사용자 취소·만료 cron 은 키가 묶인 pending 을 건드리지 않고
 *   (돈이 캡처됐을 수 있으므로), 관리자 취소도 토스가 DONE 이면 409 다 — 확정 또는 정리로 보낼
 *   수단이 없었다. 토스 웹훅 URL 이 미등록인 동안에는 특히 영구히 남는다.
 *
 * 판정은 웹훅과 같은 겹을 쓴다: 주문에 묶인 결제 키로 토스를 직접 재조회하고, paymentKey·orderId·
 * totalAmount 가 이 주문과 일치할 때만 움직인다. 모든 DB 쓰기는 "읽은 시점의 status·결제 키가
 * 그대로일 때만" 조건부로 한다.
 *
 *   토스 결과                          → 계획
 *   DONE (일치)                        → finalize      : pending→paid 조건부 클레임 + finalizePaidOrder
 *   ABORTED · EXPIRED                  → release       : 선점 크레딧 해제 + 결제 키 바인딩 해제
 *                                                         (이후 일반 미결제 pending — 재사용·만료 cron 대상)
 *   404 (승인된 결제 없음)              → release 는 아래 두 조건을 **모두** 만족할 때만, 아니면 wait/manual:
 *       ① 결제 키 바인딩(= orders.updated_at) 후 RELEASE_MIN_BOUND_AGE_MS(30분) 경과 —
 *          confirm 이 토스 승인 응답을 기다리는 동안에도 조회는 404 다. 그 사이 키를 풀면 뒤늦은 DONE 이
 *          키 없는 pending 에 남고, 주문서 재사용(orders/create)이 toss_order_id 를 덮어 재결제(이중 과금)로
 *          이어진다(2026-10-05 적대 리뷰 HIGH). confirm maxDuration 300s·토스 결제창 30분을 모두 넘긴 뒤에만.
 *       ② 토스 주문번호 조회(probeTossOrder)도 no_payment — 키가 아닌 orderId 기준으로 한 번 더 확인.
 *   CANCELED (일치)                    → cancel        : 선점 크레딧 해제(키 유지) + pending→cancelled
 *                                                         (캡처 후 토스에서 전액 취소 = 돈이 돌아간 주문)
 *   READY · IN_PROGRESS                → wait          : 승인 진행 중 — 토스가 30분 뒤 EXPIRED 로 닫는다
 *   PARTIAL_CANCELED · 기타 · 불일치    → manual        : 자동 처리하지 않음(토스 콘솔 확인)
 *   조회 실패                           → unavailable   : 아무것도 하지 않음(fail-closed)
 *   pending 아님 · 키 없음              → not_applicable
 *
 * 웹훅 라우트와 판정 표가 다른 점은 CANCELED 하나다. 웹훅은 pending 을 그대로 두지만(자동 경로에서
 * 상태를 바꾸지 않는 보수적 선택), 관리자 도구의 목적이 "종착 상태로 수렴" 이므로 cancelled 로 닫는다.
 * 토스 CANCELED 는 종착이라 이후 DONE 웹훅으로 되살아날 수 없다.
 */

type Admin = SupabaseClient<Database>;

export interface ReconcileOrderRow {
  id: string;
  status: OrderStatus;
  amount: number;
  toss_payment_key: string | null;
  toss_order_id: string | null;
  /** 결제 키 바인딩(reserve) 시각의 근사 — orders 갱신 트리거가 채운다. */
  updated_at: string;
}

export const RECONCILE_ORDER_COLUMNS =
  "id, status, amount, toss_payment_key, toss_order_id, updated_at";

/** 404 로 키를 풀기 전 최소 경과 — 토스 결제창(30분)·confirm maxDuration(300s) 을 모두 넘긴다. */
export const RELEASE_MIN_BOUND_AGE_MS = 30 * 60 * 1000;

export type BoundPaymentResult =
  | { kind: "not_found" }
  | { kind: "failed"; code: string; message: string }
  | {
      kind: "found";
      payment: Pick<TossConfirmResponse, "paymentKey" | "orderId" | "totalAmount" | "status" | "approvedAt">;
    };

export type ReconcilePlan =
  | { kind: "finalize"; tossStatus: string; approvedAt: string | null }
  | { kind: "release"; tossStatus: string | null }
  | { kind: "cancel"; tossStatus: string }
  | { kind: "wait"; tossStatus: string | null; reason?: string }
  | { kind: "manual"; tossStatus: string | null; reason: string }
  | { kind: "unavailable"; code: string; message: string }
  | { kind: "not_applicable"; reason: "not_pending" | "no_payment_key" };

/** 실행 시 계획이 바뀌지 않았음을 확인할 때 쓰는 키(미리보기 → 실행 사이 토스 상태 변화 대비). */
export type ReconcilePlanKind = ReconcilePlan["kind"];

/** 이 계획이 DB 를 바꾸는가. */
export function isActionablePlan(
  plan: ReconcilePlan,
): plan is Extract<ReconcilePlan, { kind: "finalize" | "release" | "cancel" }> {
  return plan.kind === "finalize" || plan.kind === "release" || plan.kind === "cancel";
}

/** 주문 + 토스 조회 결과 → 계획. 순수 함수 (테스트 고정 대상). */
export function planPendingReconcile(
  order: ReconcileOrderRow,
  lookup: BoundPaymentResult | null,
  ctx: {
    now: Date;
    /** 결제 키 조회가 404 일 때만 필요 — 토스 주문번호 조회 결과. */
    orderProbe?: TossOrderProbe | null;
  },
): ReconcilePlan {
  if (order.status !== "pending") return { kind: "not_applicable", reason: "not_pending" };
  if (order.toss_payment_key === null) {
    return { kind: "not_applicable", reason: "no_payment_key" };
  }
  if (lookup === null) {
    return { kind: "unavailable", code: "NO_LOOKUP", message: "토스 조회 결과가 없습니다." };
  }
  if (lookup.kind === "failed") {
    return { kind: "unavailable", code: lookup.code, message: lookup.message };
  }
  if (lookup.kind === "not_found") {
    // 결제 키 조회 404 는 "아직 승인 전" 일 수도 있다 — confirm 이 승인 응답을 기다리는 중일 수 있다.
    const boundAt = new Date(order.updated_at).getTime();
    const ageMs = Number.isFinite(boundAt) ? ctx.now.getTime() - boundAt : 0;
    if (ageMs < RELEASE_MIN_BOUND_AGE_MS) {
      return {
        kind: "wait",
        tossStatus: null,
        reason: "결제 키가 묶인 지 30분이 지나지 않았습니다 — 결제 승인이 진행 중일 수 있습니다.",
      };
    }
    const probe = ctx.orderProbe ?? null;
    if (probe === null) {
      return { kind: "unavailable", code: "NO_ORDER_PROBE", message: "토스 주문번호 조회 결과가 없습니다." };
    }
    if (probe.kind === "unavailable") {
      return { kind: "unavailable", code: probe.code, message: probe.message };
    }
    if (probe.kind === "payment_found") {
      return {
        kind: "manual",
        tossStatus: probe.tossStatus,
        reason: `결제 키로는 조회되지 않지만 토스에 이 주문번호의 결제가 있습니다(${probe.tossStatus}). 토스 콘솔에서 확인하세요.`,
      };
    }
    return { kind: "release", tossStatus: null };
  }

  const p = lookup.payment;
  const mismatch = findTossPaymentMismatch(p, {
    paymentKey: order.toss_payment_key,
    orderId: order.toss_order_id,
    amount: order.amount,
  });
  if (mismatch.length > 0) {
    return {
      kind: "manual",
      tossStatus: p.status,
      reason: `토스 결제가 이 주문과 일치하지 않습니다(${mismatch.join(", ")}). 데이터를 확인하세요.`,
    };
  }

  switch (classifyTossPaymentStatus(p.status)) {
    case "captured":
      return {
        kind: "finalize",
        tossStatus: p.status,
        approvedAt: typeof p.approvedAt === "string" ? p.approvedAt : null,
      };
    case "not_captured":
      return { kind: "release", tossStatus: p.status };
    case "canceled":
      return { kind: "cancel", tossStatus: p.status };
    case "awaiting_confirm":
      return { kind: "wait", tossStatus: p.status };
    default:
      return {
        kind: "manual",
        tossStatus: p.status,
        reason: `자동 처리하지 않는 토스 상태입니다(${p.status}). 토스 콘솔에서 확인하세요.`,
      };
  }
}

/** 주문에 묶인 결제 키로 토스를 조회한다. throw 하지 않는다. */
export async function lookupBoundPayment(paymentKey: string): Promise<BoundPaymentResult> {
  try {
    const payment = await fetchTossPayment(paymentKey);
    return {
      kind: "found",
      payment: {
        paymentKey: payment.paymentKey,
        orderId: payment.orderId,
        totalAmount: payment.totalAmount,
        status: payment.status,
        ...(typeof payment.approvedAt === "string" ? { approvedAt: payment.approvedAt } : {}),
      },
    };
  } catch (e) {
    if (isTossLookupNotFound(e)) return { kind: "not_found" };
    return {
      kind: "failed",
      code: e instanceof TossError ? e.code : "TOSS_LOOKUP_FAILED",
      message: e instanceof Error ? e.message : "토스 결제 조회 실패",
    };
  }
}

export type ReconcileExecution =
  | {
      done: true;
      plan: "finalize";
      /** 이번 호출이 pending→paid 클레임 승자인가(false 면 그 사이 confirm·웹훅이 확정했다). */
      claimed: boolean;
      finalize: Pick<FinalizePaidOrderResult, "outcome" | "skipReason" | "issues" | "retryable" | "pdfJobId" | "pdfError">;
    }
  | { done: true; plan: "release"; credits: ReleaseCreditsResult }
  | { done: true; plan: "cancel"; credits: ReleaseCreditsResult; cancelled: boolean }
  | {
      done: false;
      code: "STATE_CHANGED" | "DB_ERROR" | "CREDITS_RELEASE_FAILED";
      message: string;
    };

/**
 * 계획 실행. 호출 측은 **실행 직전에 토스를 다시 조회해 만든 계획**을 넘긴다.
 * 모든 쓰기는 조건부 — 읽은 뒤 다른 경로(confirm·웹훅·사용자)가 상태를 바꿨으면 STATE_CHANGED.
 */
export async function executeReconcilePlan(
  admin: Admin,
  order: ReconcileOrderRow & { toss_payment_key: string },
  plan: Extract<ReconcilePlan, { kind: "finalize" | "release" | "cancel" }>,
  deps: { sendEmail: PaidOrderEmailSender; now?: () => Date },
): Promise<ReconcileExecution> {
  const paymentKey = order.toss_payment_key;

  if (plan.kind === "finalize") {
    // paid_at 은 토스 승인 시각 — 며칠 뒤 수렴해도 결제일이 실제 캡처일로 남게(정산·리포트).
    const approvedMs = plan.approvedAt ? new Date(plan.approvedAt).getTime() : Number.NaN;
    const paidAt = Number.isFinite(approvedMs)
      ? new Date(approvedMs).toISOString()
      : (deps.now ?? (() => new Date()))().toISOString();
    if (order.toss_order_id === null) {
      return { done: false, code: "STATE_CHANGED", message: "토스 주문번호가 없는 주문은 확정하지 않습니다." };
    }
    const { data: claimed, error } = await admin
      .from("orders")
      .update({ status: "paid", paid_at: paidAt })
      .eq("id", order.id)
      .eq("status", "pending")
      .eq("toss_payment_key", paymentKey)
      .eq("amount", order.amount)
      .eq("toss_order_id", order.toss_order_id)
      .select("id")
      .maybeSingle();
    if (error) return { done: false, code: "DB_ERROR", message: error.message };

    const claimedNow = Boolean(claimed);
    if (!claimedNow) {
      // 그 사이 confirm·웹훅이 확정했을 수 있다 — 같은 결제로 paid 계열이면 finalize 만 이어서 실행.
      const { data: cur, error: curErr } = await admin
        .from("orders")
        .select("status, toss_payment_key")
        .eq("id", order.id)
        .maybeSingle();
      if (curErr) return { done: false, code: "DB_ERROR", message: curErr.message };
      const paidLike =
        cur?.status === "paid" ||
        cur?.status === "in_production" ||
        cur?.status === "shipped" ||
        cur?.status === "delivered";
      if (!cur || !paidLike || cur.toss_payment_key !== paymentKey) {
        return {
          done: false,
          code: "STATE_CHANGED",
          message: `주문 상태가 바뀌어 확정하지 않았습니다(현재 ${cur?.status ?? "없음"}). 새로고침 후 다시 확인하세요.`,
        };
      }
    }

    // 클레임 승자는 too_old 검사를 건너뛴다 — 오래된 주문이라도 관리자가 확정하면 부수효과까지 실행.
    const fin = await finalizePaidOrder(admin, order.id, {
      claimed: claimedNow,
      trigger: "admin_reconcile",
      sendEmail: deps.sendEmail,
      ...(deps.now ? { now: deps.now } : {}),
    });
    return {
      done: true,
      plan: "finalize",
      claimed: claimedNow,
      finalize: {
        outcome: fin.outcome,
        skipReason: fin.skipReason,
        issues: fin.issues,
        retryable: fin.retryable,
        pdfJobId: fin.pdfJobId,
        pdfError: fin.pdfError,
      },
    };
  }

  if (plan.kind === "release") {
    const credits = await releaseOrderCredits(admin, {
      orderId: order.id,
      paymentKey,
      clearPaymentKey: true,
    });
    if (!credits.ok) {
      return credits.code === "RELEASE_FAILED"
        ? { done: false, code: "CREDITS_RELEASE_FAILED", message: credits.message ?? "크레딧 해제 실패" }
        : {
            done: false,
            code: "STATE_CHANGED",
            message: `주문 상태가 바뀌어 해제하지 않았습니다(${credits.code}). 새로고침 후 다시 확인하세요.`,
          };
    }
    return { done: true, plan: "release", credits };
  }

  // cancel — 선점 해제(키 유지: 추적용) 후 pending→cancelled. 해제 RPC 는 status=pending · 같은 키를
  // 잠금 아래 다시 확인하므로 그 사이 바뀐 주문은 건드리지 않는다.
  const credits = await releaseOrderCredits(admin, {
    orderId: order.id,
    paymentKey,
    clearPaymentKey: false,
  });
  if (!credits.ok) {
    return credits.code === "RELEASE_FAILED"
      ? { done: false, code: "CREDITS_RELEASE_FAILED", message: credits.message ?? "크레딧 해제 실패" }
      : {
          done: false,
          code: "STATE_CHANGED",
          message: `주문 상태가 바뀌어 취소하지 않았습니다(${credits.code}). 새로고침 후 다시 확인하세요.`,
        };
  }
  const { data: closed, error: closeErr } = await admin
    .from("orders")
    .update({ status: "cancelled" })
    .eq("id", order.id)
    .eq("status", "pending")
    .eq("toss_payment_key", paymentKey)
    .select("id")
    .maybeSingle();
  if (closeErr) return { done: false, code: "DB_ERROR", message: closeErr.message };
  return { done: true, plan: "cancel", credits, cancelled: Boolean(closed) };
}

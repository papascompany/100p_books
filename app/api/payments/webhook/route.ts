import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { fail, failFromError, ok } from "@/app/api/_lib/response";
import { createAdminSupabase } from "@/lib/db/admin";
import type { Database, OrderStatus } from "@/lib/db/types";
import { enqueueEmail } from "@/lib/email/queue";
import { refundCapturedPaymentOfCancelledOrder } from "@/lib/orders/cancelled-order-refund";
import { finalizePaidOrder, isPaidLikeStatus } from "@/lib/orders/finalize-paid";
import { enqueueOrderRefundedEmail } from "@/lib/orders/order-emails";
import { releaseOrderCredits, restoreOrderCredits } from "@/lib/orders/refund";
import { canTransition } from "@/lib/orders/state";
import {
  classifyTossPaymentStatus,
  fetchTossPayment,
  findTossPaymentMismatch,
} from "@/lib/payments/toss";
import { enforceRateLimit } from "@/lib/security/rate-limit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// paid 전이 시 finalizePaidOrder 가 PDF 빌드를 waitUntil 백그라운드로 실행한다.
export const maxDuration = 300;

/**
 * 토스 웹훅 페이로드는 이벤트별로 약간씩 다른데, 결제 관련 이벤트에서는 공통적으로
 * `data.paymentKey` `data.orderId` `data.status` 가 들어 있다.
 * (https://docs.tosspayments.com/reference/webhook)
 *
 * 본 단계는 `PAYMENT.STATUS_CHANGED` (또는 그에 준하는) 이벤트만 처리하고
 * 기타 이벤트는 200 OK 로 무시한다.
 */
const WebhookSchema = z.object({
  eventType: z.string().optional(),
  data: z
    .object({
      paymentKey: z.string().optional(),
      orderId: z.string().optional(),
      status: z.string().optional(),
    })
    .optional(),
  // 일부 이벤트는 최상위에 키가 직접 위치
  paymentKey: z.string().optional(),
  orderId: z.string().optional(),
  status: z.string().optional(),
});

/** 토스 status → 우리 OrderStatus 매핑. */
function mapTossStatus(s: string | undefined | null): OrderStatus | null {
  if (!s) return null;
  switch (s.toUpperCase()) {
    case "DONE":
      return "paid";
    case "CANCELED":
      return "refunded";
    // PARTIAL_CANCELED 는 **의도적으로 매핑하지 않는다**(null → 상태 전이 없음).
    // 부분 환불 모델이 없어서 refunded 로 넘기면 일부만 취소된 주문이 전액 환불로
    // 기록되고, restoreOrderCredits 가 사용 포인트·할인코드를 **전액** 복원한다.
    // 예: 30,000원 중 5,000원만 취소했는데 쓴 포인트 전부가 되돌아온다 — 금전 손실.
    // 부분 취소는 운영자가 관리자 콘솔에서 실제 금액을 보고 처리하도록 남긴다.
    // ABORTED/EXPIRED 는 응답 표기용 매핑이다 — pending 주문은 취소하지 않는다(POST 의 대기 주문 정책).
    case "ABORTED":
    case "EXPIRED":
      return "cancelled";
    default:
      return null;
  }
}

/**
 * POST /api/payments/webhook
 *
 *   - 본문은 토스가 보낸 이벤트 — paymentKey/orderId/status 추출.
 *   - 진위 검증: paymentKey 로 토스 API 직접 조회 → paymentKey·orderId·totalAmount 대조(SEC-8).
 *   - 상태 전이 가능하면 orders 업데이트.
 *     · pending → paid 클레임 승자, 또는 이미 paid 인 같은 결제 → finalizePaidOrder
 *       (포인트 차감 확정·할인 기록·PDF 잡·퍼널·메일을 confirm 과 같은 함수로 멱등 실행).
 *     · paid 계열 → refunded(CANCELED) 클레임 승자 → 실제로 잡힌 크레딧만 복원 + 환불 메일 1회.
 *       클레임은 읽은 시점의 status **와 toss_payment_key** 가 그대로일 때만 — 그 사이 다른 결제로
 *       바인딩된 행을 이 결제의 상태로 덮지 않는다.
 *     · pending + ABORTED/EXPIRED(캡처 안 됨) → **취소하지 않는다**. 이 결제로 선점된 크레딧·키만
 *       해제한다(confirm 의 토스 거절 처리와 같음). 결제 이탈·실패 pending 은 주문서 재사용
 *       (orders/create)으로 이어지고, 끝내 결제하지 않으면 만료 cron(24h, 토스 확인)이 정리한다 —
 *       실패마다 cancelled 가 쌓여 포토북 삭제가 막히는(HAS_ORDERS) 것을 피한다.
 *     · cancelled 주문 + 이 결제가 DONE(캡처 직전 취소 경합) → 전액 취소 + 크레딧 복원.
 *       CANCELED 면 크레딧 복원만(멱등). 토스 취소 실패는 503 으로 재전송 유도.
 *
 * ⚠️ 이 라우트는 **의도적으로 무인증**이다. 되돌리기 전에 아래를 읽을 것.
 *
 *   토스페이먼츠는 개발자가 지정한 커스텀 헤더를 웹훅에 실어 보낼 수 없다. 공식 문서 기준
 *   요청 헤더는 `tosspayments-webhook-transmission-{time,retried-count,id}` 와
 *   `tosspayments-webhook-signature` 4종뿐이고, **서명 헤더는 지급대행 이벤트
 *   (payout.changed / seller.changed) 전용**이다. 결제 이벤트에는 서명이 없고, 문서가
 *   제시하는 검증 수단은 가상계좌(DEPOSIT_CALLBACK) 본문의 `secret` 필드뿐이다.
 *
 *   이전 구현은 `x-webhook-secret` 헤더를 요구했는데, 그러면 미설정 시 500·설정 시 401 로
 *   **어느 쪽이든 토스 웹훅이 전량 거부**됐다(2026-08-07 실측·수정).
 *
 *   대신 진위는 아래 겹으로 보장한다 — 위조 페이로드가 상태를 바꿀 수 없다:
 *     ① 우리 DB 에 있는 주문만 처리(없으면 200 ack)
 *     ② paymentKey 없으면 상태를 건드리지 않음
 *     ③ 토스 API 재조회로 paymentKey·orderId·totalAmount·status 확인 — 페이로드의 status 는 신뢰하지 않음
 *     ④ 주문에 다른 paymentKey 가 묶여 있으면 무시(같은 토스 주문번호의 다른 결제 시도)
 *     ⑤ canTransition + 조건부 클레임(status 일치할 때만 UPDATE)
 *   남는 위험은 무인증 POST 폭주뿐이라 rate limit 으로 막는다.
 *
 *   응답 503 FINALIZE_IN_PROGRESS: 다른 요청(보통 confirm)이 부수효과를 실행 중이다. 토스는
 *   200 이 아니면 웹훅을 재전송하므로, 그 요청이 중간에 죽었더라도 재전송 때 복구된다.
 *   응답 503 FINALIZE_INCOMPLETE: 부수효과 일부가 일시 실패로 남았다 — 재전송 때 남은 것만 실행.
 */
export async function POST(req: Request) {
  try {
    // 폭주 차단 — 진위 검증이 아니라 가용성 보호. 정상 트래픽(결제당 소수 + 실패 재시도 7회)
    // 에는 걸리지 않는다. Upstash 미설정 시에는 fail-open (lib/security/rate-limit.ts).
    const rl = await enforceRateLimit("payment-webhook", req, null);
    if (!rl.success) {
      return fail("RATE_LIMITED", "웹훅 요청이 너무 잦습니다.", 429, {
        resetAt: rl.reset,
      });
    }

    const raw = (await req.json().catch(() => ({}))) as unknown;
    const parsed = WebhookSchema.safeParse(raw ?? {});
    if (!parsed.success) {
      return fail("INVALID_BODY", "웹훅 본문이 올바르지 않습니다.", 400);
    }
    const body = parsed.data;
    const paymentKey = body.data?.paymentKey ?? body.paymentKey;
    const tossOrderId = body.data?.orderId ?? body.orderId;
    const tossStatus = body.data?.status ?? body.status;

    if (!paymentKey && !tossOrderId) {
      // 우리가 처리하지 않는 이벤트 — 그냥 ack
      return ok({ received: true, ignored: true });
    }

    const admin = createAdminSupabase();

    // toss_payment_key 우선 조회, 없으면 toss_order_id
    type Row = WebhookOrderRow;
    const columns =
      "id, status, amount, toss_payment_key, toss_order_id, user_id, project_id, qty, address, points_used, discount_code_id";
    let order: Row | null = null;
    if (paymentKey) {
      const { data, error: qErr } = await admin
        .from("orders")
        .select(columns)
        .eq("toss_payment_key", paymentKey)
        .maybeSingle();
      if (qErr) return fail("ORDER_QUERY_FAILED", qErr.message, 500);
      order = (data as Row | null) ?? null;
    }
    if (!order && tossOrderId) {
      const { data, error: qErr } = await admin
        .from("orders")
        .select(columns)
        .eq("toss_order_id", tossOrderId)
        .maybeSingle();
      if (qErr) return fail("ORDER_QUERY_FAILED", qErr.message, 500);
      order = (data as Row | null) ?? null;
    }
    if (!order) {
      // 우리가 모르는 결제 — 200 으로 무시 (재시도 폭주 방지)
      return ok({ received: true, unknown: true });
    }

    // 상태 전이는 **반드시 토스 측 직접 조회로 검증된 경우에만** 수행한다.
    //   - paymentKey 없으면 검증 불가 → 상태 변경 없이 ack (위조 페이로드로 상태 위조 차단).
    //   - 토스 조회 실패면 상태 변경 없이 ack(retry) → 토스가 재시도.
    //   - 페이로드의 status 문자열만으로는 절대 전이하지 않는다(미검증 fallback 제거).
    void tossStatus;
    if (!paymentKey) {
      return ok({ received: true, orderId: order.id, ignored: true, reason: "no paymentKey" });
    }

    let tossRes: Awaited<ReturnType<typeof fetchTossPayment>>;
    try {
      tossRes = await fetchTossPayment(paymentKey);
    } catch (e) {
      console.warn("[payments/webhook] toss fetch failed", (e as Error).message);
      // 검증 실패 — 상태 변경 없이 ack. 토스 재시도 시 재검증.
      return ok({ received: true, orderId: order.id, retry: true });
    }

    // SEC-8 — 재조회한 결제가 **이 주문의** 결제인지 대조한다.
    //   금액만 같으면 다른 주문번호의 DONE 결제로 남의 pending 주문을 paid 로 만들 수 있었다.
    const mismatch = findTossPaymentMismatch(tossRes, {
      paymentKey,
      orderId: order.toss_order_id,
      amount: order.amount,
    });
    if (mismatch.includes("totalAmount")) {
      return fail("AMOUNT_MISMATCH", "웹훅 검증 — 결제 금액 불일치", 400);
    }
    if (mismatch.length > 0) {
      console.warn("[payments/webhook] 토스 결제와 주문 불일치 — 전이 안 함", {
        orderId: order.id,
        fields: mismatch,
      });
      return fail("TOSS_ORDER_MISMATCH", "웹훅 검증 — 결제·주문 식별자 불일치", 400, {
        fields: mismatch,
      });
    }
    // 같은 토스 주문번호로 다른 결제 시도가 이 주문에 묶여 있다 — 그 시도의 상태를 덮어쓰지 않는다.
    if (order.toss_payment_key && order.toss_payment_key !== paymentKey) {
      return ok({
        received: true,
        orderId: order.id,
        ignored: true,
        reason: "payment key not bound to order",
      });
    }

    const mapped = mapTossStatus(tossRes.status);
    const tossKind = classifyTossPaymentStatus(tossRes.status);

    // 취소된 주문 — 캡처된 결제가 남아 있으면 되돌린다(cancelled 는 종착 상태라 paid 로 갈 수 없다).
    if (order.status === "cancelled") {
      return settleCancelledOrder(admin, order, paymentKey, tossKind, mapped);
    }

    if (mapped === "paid") {
      let claimedNow = false;
      if (order.status === "pending") {
        // 조건부 클레임 — confirm 과 동시에 와도 한 곳만 전이한다.
        const { data: claimed, error: claimErr } = await admin
          .from("orders")
          .update({
            status: "paid",
            paid_at: new Date().toISOString(),
            toss_payment_key: paymentKey,
          })
          .eq("id", order.id)
          .eq("status", "pending")
          .eq("amount", order.amount)
          .eq("toss_order_id", tossRes.orderId)
          .select("id")
          .maybeSingle();
        if (claimErr) return fail("ORDER_UPDATE_FAILED", claimErr.message, 500);
        claimedNow = Boolean(claimed);
      }

      if (!claimedNow) {
        // 이미 paid(보통 confirm 이 먼저) 이거나 방금 다른 요청이 클레임 — 같은 결제일 때만 복구 트리거.
        const { data: current, error: curErr } = await admin
          .from("orders")
          .select("status, toss_payment_key")
          .eq("id", order.id)
          .maybeSingle();
        if (curErr) return fail("ORDER_QUERY_FAILED", curErr.message, 500);
        if (current?.status === "cancelled") {
          // 읽은 뒤 클레임 전에 취소됨(관리자 취소 등) — 캡처된 결제를 되돌린다.
          return settleCancelledOrder(
            admin,
            { ...order, status: "cancelled", toss_payment_key: current.toss_payment_key },
            paymentKey,
            tossKind,
            mapped,
          );
        }
        if (
          !current ||
          !isPaidLikeStatus(current.status) ||
          current.toss_payment_key !== paymentKey
        ) {
          // 토스는 승인(DONE)인데 우리 주문은 확정할 수 없는 상태(취소·재사용 등) — 수동 확인 대상.
          console.warn("[payments/webhook] 토스 DONE 이지만 주문을 확정하지 않음", {
            orderId: order.id,
            status: current?.status ?? null,
          });
          return ok({ received: true, orderId: order.id, mapped, transitioned: false });
        }
      }

      const fin = await finalizePaidOrder(admin, order.id, {
        claimed: claimedNow,
        trigger: "webhook",
        sendEmail: enqueueEmail,
      });
      if (fin.outcome === "skipped" && fin.skipReason === "in_progress") {
        return fail(
          "FINALIZE_IN_PROGRESS",
          "결제 확정 후처리가 진행 중입니다 — 재전송 시 다시 확인합니다.",
          503,
        );
      }
      // 일시 실패가 남았거나(PDF 잡·메일·원장 조회 등) 주문·리스 조회 자체가 실패 — 200 이면 토스가
      // 재전송하지 않아 복구가 사용자의 새로고침에만 의존한다. 503 으로 재전송을 유도한다.
      if (
        fin.outcome === "incomplete" ||
        (fin.outcome === "skipped" && fin.skipReason === "load_failed")
      ) {
        return fail(
          "FINALIZE_INCOMPLETE",
          "결제 확정 후처리가 끝나지 않았습니다 — 재전송 시 남은 작업을 다시 실행합니다.",
          503,
          { retryable: fin.retryable, skipReason: fin.skipReason ?? null },
        );
      }
      return ok({
        received: true,
        orderId: order.id,
        mapped,
        transitioned: claimedNow,
        finalize: fin.outcome,
      });
    }

    // 결제 승인이 실패·만료(캡처 안 됨)된 pending — 주문은 취소하지 않고 이 결제의 선점·키만 푼다.
    // 키가 없는(선점 전·이미 해제된) 주문은 할 일이 없다. 해제 RPC 가 status=pending · 같은 키를 잠금 아래
    // 다시 확인하므로, 그 사이 다른 결제로 바인딩된 주문의 선점은 건드리지 않는다.
    if (order.status === "pending" && tossKind === "not_captured") {
      if (order.toss_payment_key !== paymentKey) {
        return ok({
          received: true,
          orderId: order.id,
          mapped,
          transitioned: false,
          reason: "pending order kept for reuse",
        });
      }
      const released = await releaseOrderCredits(admin, {
        orderId: order.id,
        paymentKey,
        clearPaymentKey: true,
      });
      if (!released.ok && released.code === "RELEASE_FAILED") {
        return fail("CREDITS_RELEASE_FAILED", "크레딧 해제 실패 — 재전송 시 다시 시도합니다.", 500);
      }
      return ok({
        received: true,
        orderId: order.id,
        mapped,
        transitioned: false,
        creditsReleased: released.ok,
      });
    }

    // 캡처 후 토스에서 전액 취소됐는데 우리 주문은 아직 pending(클레임 실패 등으로 확정 전) —
    // pending→refunded 전이는 없으므로 상태는 두고, 선점된 크레딧만 되돌린다(키는 추적용으로 유지).
    if (
      order.status === "pending" &&
      order.toss_payment_key === paymentKey &&
      tossKind === "canceled"
    ) {
      const released = await releaseOrderCredits(admin, {
        orderId: order.id,
        paymentKey,
        clearPaymentKey: false,
      });
      if (!released.ok && released.code === "RELEASE_FAILED") {
        return fail("CREDITS_RELEASE_FAILED", "크레딧 해제 실패 — 재전송 시 다시 시도합니다.", 500);
      }
      console.error("[payments/webhook] 확정 전 pending 주문의 결제가 토스에서 취소됨 — 관리자 확인 필요", {
        orderId: order.id,
        creditsReleased: released.ok,
      });
      return ok({
        received: true,
        orderId: order.id,
        mapped,
        transitioned: false,
        creditsReleased: released.ok,
      });
    }

    if (mapped && canTransition(order.status, mapped)) {
      // 조건부 클레임 — 읽은 시점의 status **와 결제 키**가 그대로일 때만 전이. 동시 중복 웹훅이
      // 같은 전이를 두 번 적용해 환불 복원이 이중 실행되는 것과, 그 사이 다른 결제로 바인딩된 행을
      // 이 결제의 상태로 덮는 것을 막는다.
      const base = admin
        .from("orders")
        .update({ status: mapped })
        .eq("id", order.id)
        .eq("status", order.status);
      const { data: claimed, error: claimErr } = await (order.toss_payment_key === null
        ? base.is("toss_payment_key", null)
        : base.eq("toss_payment_key", order.toss_payment_key)
      )
        .select("id")
        .maybeSingle();
      if (claimErr) return fail("ORDER_UPDATE_FAILED", claimErr.message, 500);
      // 환불·취소 전이 클레임 승자만 크레딧 복원(실제로 잡혀 있던 것만) + 환불 메일 1회.
      if (claimed && (mapped === "refunded" || mapped === "cancelled")) {
        await restoreOrderCredits(admin, {
          id: order.id,
          user_id: order.user_id,
          points_used: order.points_used,
          discount_code_id: order.discount_code_id,
        });
        if (mapped === "refunded") {
          await enqueueOrderRefundedEmail(admin, order, enqueueEmail);
        }
      }
      return ok({ received: true, orderId: order.id, mapped, transitioned: Boolean(claimed) });
    }
    return ok({ received: true, orderId: order.id, mapped });
  } catch (err) {
    return failFromError(err);
  }
}

interface WebhookOrderRow {
  id: string;
  status: OrderStatus;
  amount: number;
  toss_payment_key: string | null;
  toss_order_id: string | null;
  user_id: string;
  project_id: string;
  qty: number;
  address: { name?: string } | null;
  points_used: number;
  discount_code_id: string | null;
}

/**
 * 취소된 주문의 결제 이벤트 (토스 재조회로 이 주문의 결제임을 확인한 뒤).
 *   - 이 결제로 바인딩된 주문만 자동 처리한다. 키가 없거나 다르면 로그만(관리자 확인).
 *   - DONE     → 전액 취소 + 크레딧 복원. 토스 취소 실패는 503(재전송 때 다시 시도).
 *   - CANCELED → 크레딧 복원(멱등) — 자동 취소 뒤 복원만 실패했던 경우의 수렴.
 */
async function settleCancelledOrder(
  admin: SupabaseClient<Database>,
  order: WebhookOrderRow,
  paymentKey: string,
  tossKind: ReturnType<typeof classifyTossPaymentStatus>,
  mapped: OrderStatus | null,
) {
  if (order.toss_payment_key !== paymentKey) {
    if (tossKind === "captured") {
      console.error("[payments/webhook] 결제 키가 묶이지 않은 취소 주문에 승인된 결제 — 관리자 확인 필요", {
        orderId: order.id,
      });
    }
    return ok({ received: true, orderId: order.id, mapped, transitioned: false });
  }
  if (tossKind === "captured") {
    const r = await refundCapturedPaymentOfCancelledOrder(admin, order, paymentKey, {
      trigger: "webhook",
    });
    if (!r.ok) {
      return fail(
        "PAYMENT_CANCEL_PENDING",
        "취소된 주문의 결제 자동 취소 실패 — 재전송 시 다시 시도합니다.",
        503,
        { tossCode: r.code },
      );
    }
    if (!r.credits.ok && r.credits.code === "RELEASE_FAILED") {
      return fail("CREDITS_RELEASE_FAILED", "크레딧 복원 실패 — 재전송 시 다시 시도합니다.", 500);
    }
    return ok({
      received: true,
      orderId: order.id,
      mapped,
      transitioned: false,
      paymentCanceled: true,
    });
  }
  if (tossKind === "canceled") {
    const credits = await restoreOrderCredits(admin, order);
    if (!credits.ok && credits.code === "RELEASE_FAILED") {
      return fail("CREDITS_RELEASE_FAILED", "크레딧 복원 실패 — 재전송 시 다시 시도합니다.", 500);
    }
    return ok({ received: true, orderId: order.id, mapped, transitioned: false });
  }
  return ok({ received: true, orderId: order.id, mapped, transitioned: false });
}

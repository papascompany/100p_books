import "server-only";

import { z } from "zod";

import { fail, failFromError, ok } from "@/app/api/_lib/response";
import { createAdminSupabase } from "@/lib/db/admin";
import type { OrderStatus } from "@/lib/db/types";
import { restoreOrderCredits } from "@/lib/orders/refund";
import { canTransition } from "@/lib/orders/state";
import { fetchTossPayment } from "@/lib/payments/toss";
import { enforceRateLimit } from "@/lib/security/rate-limit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

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
 *   - 진위 검증: paymentKey 로 토스 API 직접 조회 → totalAmount/status 비교.
 *   - 상태 전이 가능하면 orders 업데이트.
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
 *   대신 진위는 아래 4겹으로 보장한다 — 위조 페이로드가 상태를 바꿀 수 없다:
 *     ① 우리 DB 에 있는 주문만 처리(없으면 200 ack)
 *     ② paymentKey 없으면 상태를 건드리지 않음
 *     ③ 토스 API 재조회로 totalAmount·status 확인 — 페이로드의 status 는 신뢰하지 않음
 *     ④ canTransition + 조건부 클레임(status 일치할 때만 UPDATE)
 *   남는 위험은 무인증 POST 폭주뿐이라 rate limit 으로 막는다.
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
    type Row = {
      id: string;
      status: OrderStatus;
      amount: number;
      toss_payment_key: string | null;
      toss_order_id: string | null;
      user_id: string;
      points_used: number;
      discount_code_id: string | null;
    };
    let order: Row | null = null;
    if (paymentKey) {
      const { data, error: qErr } = await admin
        .from("orders")
        .select("id, status, amount, toss_payment_key, toss_order_id, user_id, points_used, discount_code_id")
        .eq("toss_payment_key", paymentKey)
        .maybeSingle();
      if (qErr) return fail("ORDER_QUERY_FAILED", qErr.message, 500);
      order = (data as Row | null) ?? null;
    }
    if (!order && tossOrderId) {
      const { data, error: qErr } = await admin
        .from("orders")
        .select("id, status, amount, toss_payment_key, toss_order_id, user_id, points_used, discount_code_id")
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

    if (tossRes.totalAmount !== order.amount) {
      return fail("AMOUNT_MISMATCH", "웹훅 검증 — 결제 금액 불일치", 400);
    }

    const mapped = mapTossStatus(tossRes.status);
    if (mapped && canTransition(order.status, mapped)) {
      const patch: Record<string, unknown> = { status: mapped };
      if (mapped === "paid") {
        patch.paid_at = new Date().toISOString();
        patch.toss_payment_key = paymentKey;
      }
      // 조건부 클레임 — status=현재값 일 때만 전이. 동시 중복 웹훅이 같은 전이를
      // 두 번 적용해 환불 복원이 이중 실행되는 것을 막는다.
      const { data: claimed } = await admin
        .from("orders")
        .update(patch)
        .eq("id", order.id)
        .eq("status", order.status)
        .select("id")
        .maybeSingle();
      // 환불 전이 클레임 승자만 사용 포인트 + 할인 복원 (1회).
      if (claimed && mapped === "refunded") {
        await restoreOrderCredits(admin, {
          id: order.id,
          user_id: order.user_id,
          points_used: order.points_used,
          discount_code_id: order.discount_code_id,
        });
      }
    }
    return ok({ received: true, orderId: order.id, mapped });
  } catch (err) {
    return failFromError(err);
  }
}

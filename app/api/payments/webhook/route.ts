import "server-only";

import { z } from "zod";

import { fail, failFromError, ok } from "@/app/api/_lib/response";
import { createAdminSupabase } from "@/lib/db/admin";
import type { OrderStatus } from "@/lib/db/types";
import { canTransition } from "@/lib/orders/state";
import { fetchTossPayment } from "@/lib/payments/toss";

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
    case "PARTIAL_CANCELED":
      // 부분 취소는 일단 "refunded" 로 매핑(향후 부분 환불은 별도 모델 필요)
      return "refunded";
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
 *   - 헤더 X-Webhook-Secret 가 TOSS_WEBHOOK_SECRET 과 일치해야 함 (운영에서 IP allowlist 추가).
 *   - 본문은 토스가 보낸 이벤트 — paymentKey/orderId/status 추출.
 *   - 이중 검증: paymentKey 로 토스 API 직접 조회 → totalAmount/status 비교.
 *   - 상태 전이 가능하면 orders 업데이트.
 */
export async function POST(req: Request) {
  try {
    // (옵션) 시크릿 검증
    const expectedSecret = process.env.TOSS_WEBHOOK_SECRET;
    if (expectedSecret) {
      const got = req.headers.get("x-webhook-secret") ?? req.headers.get("x-toss-webhook-secret");
      if (got !== expectedSecret) {
        return fail("WEBHOOK_UNAUTHORIZED", "웹훅 시크릿 불일치", 401);
      }
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
    };
    let order: Row | null = null;
    if (paymentKey) {
      const { data, error: qErr } = await admin
        .from("orders")
        .select("id, status, amount, toss_payment_key, toss_order_id")
        .eq("toss_payment_key", paymentKey)
        .maybeSingle();
      if (qErr) return fail("ORDER_QUERY_FAILED", qErr.message, 500);
      order = (data as Row | null) ?? null;
    }
    if (!order && tossOrderId) {
      const { data, error: qErr } = await admin
        .from("orders")
        .select("id, status, amount, toss_payment_key, toss_order_id")
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
      await admin.from("orders").update(patch).eq("id", order.id);
    }
    return ok({ received: true, orderId: order.id, mapped });
  } catch (err) {
    return failFromError(err);
  }
}

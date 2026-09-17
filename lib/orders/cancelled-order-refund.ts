import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/db/types";
import { type ReleaseCreditsResult, restoreOrderCredits } from "@/lib/orders/refund";
import { TossError } from "@/lib/payments/toss";
import {
  cancelledOrderCancelIdempotencyKey,
  cancelTossPaymentFully,
  type TossFullCancelOutcome,
} from "@/lib/payments/toss-cancel";

/**
 * 취소(cancelled)된 주문에 캡처된 결제 정리 — "돈은 빠졌는데 주문은 취소" 상태를 남기지 않는다.
 *
 * 언제 생기나:
 *   결제 confirm 은 캡처 **전에** paymentKey 를 바인딩하고 크레딧을 선점한다(0033). 그 뒤 토스 승인
 *   호출(수 초) 사이에 주문이 다른 경로(관리자 취소 등)로 cancelled 가 되면, 캡처는 성공했는데
 *   pending→paid 클레임이 빗나간다. cancelled 는 종착 상태라 웹훅 DONE 으로도 paid 가 될 수 없다.
 *
 * 처리:
 *   1) 토스 전액 취소(lib/payments/toss-cancel.ts) — (주문, paymentKey) 멱등 키, 재조회로 CANCELED 확인.
 *      이미 취소된 결제는 성공으로 수렴한다.
 *   2) 크레딧 복원(restoreOrderCredits, refund 모드) — cancelled 주문에서 실제로 잡힌 것만, 멱등.
 *
 * 전제(호출측 책임): 주문이 이미 cancelled 이고, paymentKey 가 토스 조회·승인 응답으로 **이 주문의**
 * 결제(토스 주문번호·금액 일치)임을 확인했다. cancelled 는 종착 상태라 확인 뒤 상태가 되돌아가지 않는다.
 *
 * throw 하지 않는다 — 토스 단계 실패는 ok=false 로 돌려 호출측이 재시도 가능한 응답을 고르게 한다
 * (confirm: 새로고침 안내, 웹훅: 5xx 로 토스 재전송 유도).
 */

type Admin = SupabaseClient<Database>;

/** 토스 cancelReason — 고객 결제내역에 보일 수 있어 내부 사정을 싣지 않는다. */
export const CANCELLED_ORDER_CANCEL_REASON = "주문 취소에 따른 결제 자동 취소";

export interface CancelledOrderRef {
  id: string;
  user_id: string;
  points_used: number;
  discount_code_id: string | null;
}

export type CancelledOrderRefundResult =
  | {
      ok: true;
      tossOutcome: TossFullCancelOutcome;
      credits: ReleaseCreditsResult;
    }
  | {
      ok: false;
      code: string;
      message: string;
      /** 같은 멱등 키 요청이 토스에서 처리 중 — 잠시 뒤 재시도하면 수렴한다. */
      inProgress: boolean;
    };

export async function refundCapturedPaymentOfCancelledOrder(
  admin: Admin,
  order: CancelledOrderRef,
  paymentKey: string,
  opts: { trigger: "confirm" | "webhook" },
): Promise<CancelledOrderRefundResult> {
  let tossOutcome: TossFullCancelOutcome;
  try {
    const res = await cancelTossPaymentFully({
      paymentKey,
      cancelReason: CANCELLED_ORDER_CANCEL_REASON,
      idempotencyKey: cancelledOrderCancelIdempotencyKey(order.id, paymentKey),
    });
    tossOutcome = res.outcome;
  } catch (e) {
    const code = e instanceof TossError ? e.code : "TOSS_UNKNOWN_ERROR";
    const message = e instanceof Error ? e.message : String(e);
    // 돈이 캡처된 채 주문은 취소 — 재시도(새로고침·웹훅 재전송)로 수렴하지 않으면 관리자가 토스 콘솔에서 취소해야 한다.
    console.error(
      "[orders/cancelled-refund] 취소된 주문의 캡처 결제 자동 취소 실패 — 재시도 대기, 계속되면 관리자 확인 필요",
      { orderId: order.id, trigger: opts.trigger, tossCode: code, message },
    );
    return { ok: false, code, message, inProgress: code === "IDEMPOTENT_REQUEST_PROCESSING" };
  }

  const credits = await restoreOrderCredits(admin, order);
  console.warn("[orders/cancelled-refund] 취소된 주문에 캡처된 결제를 전액 취소함", {
    orderId: order.id,
    trigger: opts.trigger,
    tossOutcome,
    creditsRestored: credits.ok,
    ...(credits.ok ? {} : { creditsCode: credits.code }),
  });
  return { ok: true, tossOutcome, credits };
}

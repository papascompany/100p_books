import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { NextResponse } from "next/server";
import { z } from "zod";

import { type ApiFail, fail, failFromError, ok } from "@/app/api/_lib/response";
import { requireActiveUser } from "@/lib/auth/session";
import { createAdminSupabase } from "@/lib/db/admin";
import { createServerSupabase } from "@/lib/db/server";
import type { Database, OrderStatus } from "@/lib/db/types";
import { reasonMessage } from "@/lib/discounts/validate";
import { enqueueEmail } from "@/lib/email/queue";
import { calcCoverDimensions } from "@/lib/layout/cover";
import { isPageDoc } from "@/lib/layout/types";
import { refundCapturedPaymentOfCancelledOrder } from "@/lib/orders/cancelled-order-refund";
import { finalizePaidOrder, isPaidLikeStatus } from "@/lib/orders/finalize-paid";
import { detectOrderPricingDrift } from "@/lib/orders/pricing";
import {
  releaseOrderCredits,
  reserveOrderCredits,
  type ReserveOrderCreditsResult,
  restoreOrderCredits,
} from "@/lib/orders/refund";
import { assertTransition } from "@/lib/orders/state";
import {
  buildConfirmIdempotencyKey,
  classifyTossConfirmError,
  classifyTossPaymentStatus,
  confirmTossPayment,
  fetchTossPayment,
  findTossPaymentMismatch,
  isTossLookupNotFound,
  TossError,
  type TossConfirmResponse,
} from "@/lib/payments/toss";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// PDF 빌드는 finalizePaidOrder 가 waitUntil 백그라운드로 분리 — 응답은 즉시, 함수 수명은
// 빌드가 끝날 때까지(최대 300s) 유지된다. 100p 사진북 빌드 시간 확보용.
export const maxDuration = 300;

const BodySchema = z.object({
  orderId: z.string().uuid(),
  paymentKey: z.string().min(1),
  amount: z.number().int().positive(),
  tossOrderId: z.string().min(1),
});

type Admin = SupabaseClient<Database>;

interface ConfirmOrderRow {
  id: string;
  project_id: string;
  user_id: string;
  qty: number;
  amount: number;
  status: OrderStatus;
  toss_payment_key: string | null;
  toss_order_id: string | null;
  discount_code_id: string | null;
  discount_amount: number;
  points_used: number;
}

interface ExpectedPayment {
  paymentKey: string;
  orderId: string;
  amount: number;
}

/**
 * POST /api/payments/confirm
 *
 *   body: { orderId, paymentKey, amount, tossOrderId }
 *
 *   1. requireActiveUser + orders 소유권 + status === "pending" + 자체 amount·tossOrderId 일치.
 *   2. 이미 이 paymentKey 로 선점된 주문(바인딩된 재시도)이면 토스 결제를 먼저 조회 — 이전 시도가
 *      캡처 뒤 중단됐다면(DONE) 캡처 없이 확정으로 수렴한다(DEBT-1). 조회 실패는 선점 유지 + 재확인
 *      안내, 취소된 결제(CANCELED)는 승인을 재시도하지 않는다. 가격 재검증은 하지 않는다.
 *   3. (첫 시도만) 결제 시점 재검증 — 현재 페이지 수·책 사이즈·표지 규격·할인으로 금액을 다시
 *      계산해 주문 행과 다르면 캡처하지 않는다(DEBT-2). 같은 paymentKey 가 다른 주문에 묶였으면 거부.
 *   4. 크레딧 선점 — 포인트 차감 + 할인 사용 기록을 캡처 **전**에 원자적으로(0033 RPC).
 *      주문 간 동시 confirm 의 이중 사용을 구조적으로 막는다(SEC-7, DEBT-7).
 *   5. 토스 승인 — Idempotency-Key(주문 id + paymentKey). ALREADY_PROCESSED 는 조회로 수렴,
 *      캡처 여부를 모르는 실패(타임아웃 등)는 선점을 유지한 채 재시도 안내, 확실한 거절만 해제.
 *   6. 응답 대조(paymentKey·orderId·금액·DONE) → pending→paid 조건부 클레임.
 *   7. finalizePaidOrder — 부수효과(차감 확정·할인 기록·PDF 잡·퍼널·메일) 멱등 실행.
 *
 * 멱등성·복구:
 *   - 이미 paid 인 주문 + 같은 paymentKey 재호출은 성공 응답 + finalize 복구 트리거.
 *   - 클레임 DB 오류로 pending 에 남아도 이 페이지를 새로고침하거나 웹훅이 오면 2번 경로로 확정된다.
 *   - 캡처 뒤 주문이 이미 cancelled(승인 호출 사이 관리자 취소 등)면 확정하지 않고 토스 결제를
 *     전액 취소 + 크레딧 복원 → 409 ORDER_CANCELLED. 토스 취소가 실패하면 재시도 가능한
 *     PAYMENT_CANCEL_PENDING 을 돌려주고, 새로고침(취소된 주문 + 같은 paymentKey)이 다시 정리한다.
 *   - 선점 해제가 DB 오류로 실패하면(RELEASE_FAILED) 재시도 가능한 CREDITS_RELEASE_FAILED —
 *     같은 paymentKey 로 다시 부르면 바인딩된 재시도로 수렴해 해제를 다시 시도한다.
 */
export async function POST(req: Request) {
  try {
    const user = await requireActiveUser();

    const raw = (await req.json().catch(() => ({}))) as unknown;
    const parsed = BodySchema.safeParse(raw ?? {});
    if (!parsed.success) {
      return fail(
        "INVALID_BODY",
        "요청 본문이 올바르지 않습니다.",
        400,
        parsed.error.flatten(),
      );
    }
    const { orderId, paymentKey, amount, tossOrderId } = parsed.data;

    const supabase = await createServerSupabase();
    const admin = createAdminSupabase();

    // 1) 소유권 + 상태 + amount 검증
    const { data: orderData, error: orderErr } = await supabase
      .from("orders")
      .select(
        "id, project_id, user_id, qty, amount, status, toss_payment_key, toss_order_id, discount_code_id, discount_amount, points_used",
      )
      .eq("id", orderId)
      .maybeSingle();
    if (orderErr) return fail("ORDER_QUERY_FAILED", orderErr.message, 500);
    const order = orderData as ConfirmOrderRow | null;
    if (!order) return fail("NOT_FOUND", "주문을 찾을 수 없습니다.", 404);
    if (order.user_id !== user.id) {
      return fail("FORBIDDEN", "해당 주문에 대한 권한이 없습니다.", 403);
    }

    // 멱등 — 이미 결제된 주문 + 동일 paymentKey 면 정상 응답(+ 빠진 부수효과 복구).
    if (order.status !== "pending") {
      if (
        order.toss_payment_key === paymentKey &&
        order.amount === amount &&
        isPaidLikeStatus(order.status)
      ) {
        return idempotentPaid(admin, order.id, order.status);
      }
      // 이 결제로 바인딩된 채 취소된 주문 — 이전 시도의 캡처 후 자동 취소가 끝나지 않았을 수 있다.
      if (
        order.status === "cancelled" &&
        order.toss_payment_key === paymentKey &&
        order.amount === amount &&
        order.toss_order_id === tossOrderId
      ) {
        return reconcileCancelledOrder(admin, order, { paymentKey, orderId: tossOrderId, amount });
      }
      return fail(
        "ORDER_NOT_PENDING",
        `이미 처리된 주문입니다 (현재 상태: ${order.status}).`,
        409,
      );
    }

    if (order.toss_order_id !== tossOrderId) {
      return fail(
        "TOSS_ORDER_ID_MISMATCH",
        "주문 식별자가 일치하지 않습니다.",
        400,
      );
    }
    if (order.amount !== amount) {
      return fail(
        "AMOUNT_MISMATCH",
        "결제 금액이 일치하지 않습니다.",
        400,
        { expected: order.amount, received: amount },
      );
    }
    if (order.toss_payment_key && order.toss_payment_key !== paymentKey) {
      return fail(
        "PAYMENT_KEY_CONFLICT",
        "이 주문은 다른 결제로 진행 중입니다. 주문 내역을 확인해주세요.",
        409,
      );
    }

    const expected: ExpectedPayment = { paymentKey, orderId: tossOrderId, amount };

    if (order.toss_payment_key === paymentKey) {
      // 2) 바인딩된 재시도 — 이전 시도가 이 paymentKey 로 선점·바인딩까지 갔다.
      //    캡처됐는지 모르므로 **토스가 확실히 답하기 전에는 아무것도 되돌리지 않는다.**
      //    가격 재검증(3)도 하지 않는다: 첫 시도가 바인딩 전에 이미 검증했고, 여기서 편집 드리프트나
      //    일시적 DB 오류로 선점·바인딩을 풀면 이미 캡처된 결제가 크레딧·키 없는 pending 주문으로
      //    떨어져 주문서 재사용 → 재결제(이중 과금) 경로가 열린다.
      let prior: TossConfirmResponse | null = null;
      try {
        prior = await fetchTossPayment(paymentKey);
      } catch (e) {
        if (!isTossLookupNotFound(e)) {
          console.warn("[payments/confirm] 바인딩된 결제 조회 실패 — 선점 유지", {
            orderId: order.id,
            tossCode: e instanceof TossError ? e.code : null,
          });
          return paymentStatusUnknown(
            e instanceof TossError ? e.code : "TOSS_LOOKUP_FAILED",
          );
        }
        // 404 — 승인된 결제가 없다. 아래 같은 멱등키 승인이 캡처하거나 확실히 거절한다.
      }
      if (prior) {
        // DONE → 재캡처 없이 확정 · ABORTED/EXPIRED → 해제 · CANCELED → 승인 재시도 금지.
        const resolved = await resolveTossPayment(admin, order, prior, expected);
        if (resolved !== "awaiting_confirm") return resolved;
      }
    } else {
      // 3) 결제 시점 재검증 (DEBT-2) — 아직 아무것도 잡지 않은 첫 시도에서만.
      const pricingFailure = await checkPricingBasis(admin, order);
      if (pricingFailure) return pricingFailure;

      // 같은 paymentKey 가 이미 다른 주문에 묶여 있으면 바인딩하지 않는다 — 한 결제 키가 두 주문에
      // 묶이면 웹훅의 키 조회가 다중 행 오류로 막히고(그 주문의 환불 처리 불가) 이 주문도 잠긴다.
      const { data: holders, error: holdersErr } = await admin
        .from("orders")
        .select("id")
        .eq("toss_payment_key", paymentKey)
        .neq("id", order.id)
        .limit(1);
      if (holdersErr) return fail("ORDER_QUERY_FAILED", holdersErr.message, 500);
      if ((holders ?? []).length > 0) {
        return fail(
          "PAYMENT_KEY_CONFLICT",
          "이미 다른 주문에 사용된 결제입니다. 주문 내역을 확인해주세요.",
          409,
        );
      }
    }

    // 4) 크레딧 선점 + paymentKey 바인딩 (캡처 전, 원자적)
    const reservation = await reserveOrderCredits(admin, {
      orderId: order.id,
      paymentKey,
      amount,
      tossOrderId,
    });
    if (!reservation.ok) {
      if (reservation.code === "NOT_PENDING") {
        // 같은 결제의 동시 confirm·웹훅이 먼저 확정했다면 실패가 아니라 멱등 성공이다.
        const paidStatus = await paidWithPaymentKey(admin, order.id, paymentKey);
        if (paidStatus) return idempotentPaid(admin, order.id, paidStatus);
      }
      return reserveFailure(reservation);
    }

    // 5) 토스 결제 승인 (멱등키)
    let tossRes: TossConfirmResponse;
    try {
      tossRes = await confirmTossPayment({
        paymentKey,
        orderId: tossOrderId,
        amount,
        idempotencyKey: buildConfirmIdempotencyKey(order.id, paymentKey),
      });
    } catch (e) {
      if (!(e instanceof TossError)) throw e;
      const kind = classifyTossConfirmError(e);
      if (kind === "already_processed") {
        const fetched = await fetchTossPayment(paymentKey).catch(() => null);
        if (!fetched) return paymentStatusUnknown(e.code);
        tossRes = fetched;
      } else if (kind === "in_progress") {
        return fail(
          "PAYMENT_CONFIRM_IN_PROGRESS",
          "결제 승인이 처리 중입니다. 잠시 후 이 페이지를 새로고침해주세요.",
          409,
          { tossCode: e.code },
        );
      } else if (kind === "outcome_unknown") {
        // 캡처됐을 수 있다 — 선점을 유지한다. 새로고침(같은 멱등키) 또는 웹훅이 확정/해제로 수렴.
        console.error("[payments/confirm] 토스 승인 결과 불명 — 선점 유지", {
          orderId: order.id,
          tossCode: e.code,
        });
        return paymentStatusUnknown(e.code, e.status >= 500 ? e.status : 502);
      } else {
        return releaseCreditsThen(
          admin,
          { orderId: order.id, paymentKey, clearPaymentKey: true },
          "PAYMENT_VERIFY_FAILED",
          () =>
            fail("PAYMENT_VERIFY_FAILED", e.message, e.status, {
              tossCode: e.code,
            }),
        );
      }
    }

    const resolved = await resolveTossPayment(admin, order, tossRes, expected);
    if (resolved === "awaiting_confirm") {
      // 승인 응답(또는 ALREADY_PROCESSED 뒤 조회)이 아직 승인 전 상태 — 선점 유지, 재확인 안내.
      return paymentStatusUnknown(tossRes.status);
    }
    return resolved;
  } catch (err) {
    return failFromError(err);
  }
}

/** 캡처 여부를 확인하지 못함 — 아무것도 되돌리지 않고 새로고침(같은 멱등키 재시도)을 안내. */
function paymentStatusUnknown(tossCode: string, status = 502): NextResponse<ApiFail> {
  return fail(
    "PAYMENT_STATUS_UNKNOWN",
    "결제 승인 결과를 확인하지 못했습니다. 잠시 후 이 페이지를 새로고침해주세요.",
    status,
    { tossCode },
  );
}

/**
 * 선점 해제 후 응답. 해제가 DB 오류(RELEASE_FAILED)면 키·크레딧이 잡힌 채 남으므로 재시도 불가 코드
 * 대신 CREDITS_RELEASE_FAILED(503) — 같은 paymentKey 로 다시 부르면 바인딩된 재시도가 토스 상태를
 * 다시 확인하고 해제를 재시도한다. NOT_PENDING·PAYMENT_KEY_MISMATCH 는 다른 요청이 이미 정리한 것.
 */
async function releaseCreditsThen(
  admin: Admin,
  args: { orderId: string; paymentKey: string; clearPaymentKey: boolean },
  reason: string,
  respond: () => NextResponse<ApiFail>,
): Promise<NextResponse<ApiFail>> {
  const released = await releaseOrderCredits(admin, args);
  if (!released.ok && released.code === "RELEASE_FAILED") {
    console.error("[payments/confirm] 선점 해제 실패 — 재시도 가능 응답", {
      orderId: args.orderId,
      reason,
      message: released.message ?? null,
    });
    return creditsReleaseFailed(reason);
  }
  return respond();
}

function creditsReleaseFailed(reason: string): NextResponse<ApiFail> {
  return fail(
    "CREDITS_RELEASE_FAILED",
    "주문의 포인트·할인 정리를 마치지 못했습니다. 잠시 후 이 페이지를 새로고침해주세요.",
    503,
    { reason },
  );
}

/** 취소된 주문 — 결제를 확정하지 않았고, 승인된 결제가 있었다면 전액 취소됐다. */
function orderCancelled(): NextResponse<ApiFail> {
  return fail(
    "ORDER_CANCELLED",
    "취소된 주문이라 결제를 확정하지 않았고, 승인된 결제는 전액 취소했습니다. 필요하면 주문서를 다시 작성해주세요.",
    409,
  );
}

/**
 * 캡처된 결제(DONE 확인됨) + 주문은 cancelled → 토스 전액 취소 + 크레딧 복원.
 * 토스 단계 실패는 재시도 가능한 PAYMENT_CANCEL_PENDING — 새로고침하면 reconcileCancelledOrder 가 다시 정리한다.
 */
async function refundCancelledOrderCapture(
  admin: Admin,
  order: ConfirmOrderRow,
  paymentKey: string,
): Promise<NextResponse<ApiFail>> {
  const r = await refundCapturedPaymentOfCancelledOrder(admin, order, paymentKey, {
    trigger: "confirm",
  });
  if (!r.ok) {
    return fail(
      "PAYMENT_CANCEL_PENDING",
      "취소된 주문이라 승인된 결제를 자동으로 취소하고 있지만 아직 끝나지 않았습니다. 잠시 후 이 페이지를 새로고침해주세요. 계속되면 고객센터로 문의해주세요.",
      r.inProgress ? 409 : 502,
      { tossCode: r.code },
    );
  }
  if (!r.credits.ok && r.credits.code === "RELEASE_FAILED") {
    return creditsReleaseFailed("ORDER_CANCELLED");
  }
  return orderCancelled();
}

/**
 * 이 paymentKey 로 바인딩된 채 cancelled 인 주문의 재호출(새로고침) — 토스 조회로 수렴.
 *   - DONE      → 전액 취소 + 크레딧 복원 (이전 시도의 자동 취소가 실패했던 경우)
 *   - CANCELED  → 크레딧 복원만(멱등) → ORDER_CANCELLED
 *   - 404·ABORTED·EXPIRED 등 → 캡처된 적 없음 → ORDER_NOT_PENDING
 *   - 조회 실패  → PAYMENT_STATUS_UNKNOWN (아무것도 하지 않음)
 */
async function reconcileCancelledOrder(
  admin: Admin,
  order: ConfirmOrderRow,
  expected: ExpectedPayment,
): Promise<NextResponse<ApiFail>> {
  const notPending = () =>
    fail("ORDER_NOT_PENDING", `이미 처리된 주문입니다 (현재 상태: ${order.status}).`, 409);

  let payment: TossConfirmResponse;
  try {
    payment = await fetchTossPayment(expected.paymentKey);
  } catch (e) {
    if (isTossLookupNotFound(e)) return notPending();
    return paymentStatusUnknown(e instanceof TossError ? e.code : "TOSS_LOOKUP_FAILED");
  }
  const mismatch = findTossPaymentMismatch(payment, expected);
  if (mismatch.length > 0) {
    console.error("[payments/confirm] 취소된 주문의 바인딩 결제가 주문과 다름 — 관리자 확인 필요", {
      orderId: order.id,
      fields: mismatch,
      tossStatus: payment.status,
    });
    return notPending();
  }
  switch (classifyTossPaymentStatus(payment.status)) {
    case "captured":
      console.error("[payments/confirm] 취소된 주문에 승인된 결제가 남아 있음 — 전액 취소", {
        orderId: order.id,
      });
      return refundCancelledOrderCapture(admin, order, expected.paymentKey);
    case "canceled": {
      const credits = await restoreOrderCredits(admin, order);
      if (!credits.ok && credits.code === "RELEASE_FAILED") {
        return creditsReleaseFailed("ORDER_CANCELLED");
      }
      return orderCancelled();
    }
    default:
      return notPending();
  }
}

/** 주문이 이 paymentKey 로 이미 확정(paid 계열)됐으면 그 상태, 아니면 null. */
async function paidWithPaymentKey(
  admin: Admin,
  orderId: string,
  paymentKey: string,
): Promise<OrderStatus | null> {
  const { data } = await admin
    .from("orders")
    .select("status, toss_payment_key")
    .eq("id", orderId)
    .maybeSingle();
  if (data && isPaidLikeStatus(data.status) && data.toss_payment_key === paymentKey) {
    return data.status;
  }
  return null;
}

/** 이미 확정된 주문의 재호출 — 성공 응답 + 빠진 부수효과 복구 트리거. */
async function idempotentPaid(
  admin: Admin,
  orderId: string,
  status: OrderStatus,
): Promise<NextResponse> {
  const fin = await finalizePaidOrder(admin, orderId, {
    claimed: false,
    trigger: "confirm_retry",
    sendEmail: enqueueEmail,
  });
  return ok({
    orderId,
    status,
    redirectUrl: `/order/${orderId}/success`,
    idempotent: true,
    pdfError: fin.pdfError,
    pdfJobId: fin.pdfJobId,
  });
}

/**
 * 토스 결제(승인 응답 또는 조회) 해석 → 대조 → 클레임 → finalize.
 *
 *   - 다른 주문·다른 결제의 응답           → 선점·바인딩 해제 (이 주문을 캡처할 수 없는 결제)
 *   - READY·IN_PROGRESS                   → "awaiting_confirm" (호출측이 승인 진행/재확인 안내)
 *   - ABORTED·EXPIRED                     → 선점·바인딩 해제
 *   - CANCELED                            → 선점 해제·키 유지, 승인 재시도 금지(관리자 확인)
 *   - PARTIAL_CANCELED·WAITING_FOR_DEPOSIT → 아무것도 하지 않음(관리자 확인)
 *   - DONE + 금액 불일치                   → 선점 해제·키 유지(캡처된 결제 추적)
 *   - DONE                                → pending→paid 클레임 → finalizePaidOrder
 */
async function resolveTossPayment(
  admin: Admin,
  order: ConfirmOrderRow,
  tossRes: TossConfirmResponse,
  expected: ExpectedPayment,
): Promise<NextResponse | "awaiting_confirm"> {
  const mismatch = findTossPaymentMismatch(tossRes, expected);
  if (mismatch.includes("paymentKey") || mismatch.includes("orderId")) {
    // 다른 주문(또는 다른 결제)의 응답 — 이 주문의 토스 주문번호로는 캡처될 수 없는 결제다.
    // 키를 남기면 한 결제 키가 두 주문에 묶이므로(웹훅 조회 다중 행) 바인딩까지 푼다.
    console.error("[payments/confirm] 토스 결제가 이 주문의 결제가 아님 — 선점 해제", {
      orderId: order.id,
      fields: mismatch,
      tossStatus: tossRes.status,
    });
    return releaseCreditsThen(
      admin,
      { orderId: order.id, paymentKey: expected.paymentKey, clearPaymentKey: true },
      "TOSS_PAYMENT_MISMATCH",
      () =>
        fail("TOSS_PAYMENT_MISMATCH", "토스 결제 정보가 주문과 일치하지 않습니다.", 400, {
          fields: mismatch,
        }),
    );
  }

  switch (classifyTossPaymentStatus(tossRes.status)) {
    case "awaiting_confirm":
      return "awaiting_confirm";
    case "not_captured":
      return releaseCreditsThen(
        admin,
        { orderId: order.id, paymentKey: expected.paymentKey, clearPaymentKey: true },
        "PAYMENT_NOT_DONE",
        () =>
          fail("PAYMENT_NOT_DONE", `토스 결제 상태가 정상이 아닙니다: ${tossRes.status}`, 400, {
            tossStatus: tossRes.status,
          }),
      );
    case "canceled":
      // 캡처 후 토스에서 취소된 결제(예: 클레임 실패로 pending 에 남은 주문을 운영자가 취소).
      // 승인을 다시 부르면 멱등키가 첫 DONE 응답을 재생해 무과금 확정이 되므로 여기서 끝낸다.
      // 돈이 전액 돌아갔으니 크레딧은 되돌리고, 키는 추적용으로 남긴다(같은 주문 재결제 방지).
      console.error("[payments/confirm] 토스에서 취소된 결제 — 확정하지 않음, 관리자 확인 필요", {
        orderId: order.id,
      });
      return releaseCreditsThen(
        admin,
        { orderId: order.id, paymentKey: expected.paymentKey, clearPaymentKey: false },
        "PAYMENT_NOT_DONE",
        () =>
          fail(
            "PAYMENT_NOT_DONE",
            "토스에서 취소된 결제라 주문을 확정하지 않았습니다. 주문 내역을 확인하거나 고객센터에 문의해주세요.",
            400,
            { tossStatus: tossRes.status },
          ),
      );
    case "needs_review":
      console.error("[payments/confirm] 자동 처리할 수 없는 토스 결제 상태 — 관리자 확인 필요", {
        orderId: order.id,
        tossStatus: tossRes.status,
      });
      return fail(
        "PAYMENT_NOT_DONE",
        `토스 결제 상태가 정상이 아닙니다: ${tossRes.status}`,
        400,
        { tossStatus: tossRes.status },
      );
    case "captured":
      break;
  }

  if (mismatch.includes("totalAmount")) {
    console.error("[payments/confirm] 캡처된 결제 금액이 주문과 다름 — 관리자 확인 필요", {
      orderId: order.id,
      expectedAmount: expected.amount,
      tossAmount: tossRes.totalAmount,
    });
    // 선점은 되돌리되 paymentKey 는 남긴다(캡처된 결제 추적 + 이 주문으로 재결제 방지).
    return releaseCreditsThen(
      admin,
      { orderId: order.id, paymentKey: expected.paymentKey, clearPaymentKey: false },
      "AMOUNT_MISMATCH",
      () =>
        fail("AMOUNT_MISMATCH", "토스 응답의 결제 금액이 일치하지 않습니다.", 400, {
          expected: expected.amount,
          toss: tossRes.totalAmount,
        }),
    );
  }

  // pending → paid 조건부 클레임 — 동시 중복 confirm·웹훅 중 단 한 요청만 행을 잡는다.
  // 금액·토스 주문번호·paymentKey 까지 조건에 넣어 그 사이 주문서 재사용 등으로 바뀐 행은 잡지 않는다.
  assertTransition("pending", "paid");
  const { data: claimed, error: upErr } = await admin
    .from("orders")
    .update({
      status: "paid",
      toss_payment_key: expected.paymentKey,
      paid_at: new Date().toISOString(),
    })
    .eq("id", order.id)
    .eq("status", "pending")
    .eq("amount", expected.amount)
    .eq("toss_order_id", expected.orderId)
    .eq("toss_payment_key", expected.paymentKey)
    .select("id")
    .maybeSingle();
  if (upErr) {
    // 결제는 캡처됨 — 주문은 pending + paymentKey 바인딩 상태로 남아 새로고침·웹훅이 복구한다.
    console.error("[payments/confirm] 캡처 후 주문 반영 실패", {
      orderId: order.id,
      message: upErr.message,
    });
    return fail(
      "ORDER_UPDATE_FAILED",
      "결제는 승인됐지만 주문 반영이 지연되고 있습니다. 잠시 후 이 페이지를 새로고침하면 자동으로 복구됩니다.",
      500,
    );
  }
  if (!claimed) {
    // 다른 요청(동시 confirm·웹훅)이 먼저 확정했는지, 캡처 사이에 주문이 취소됐는지 확인.
    const { data: current, error: curErr } = await admin
      .from("orders")
      .select("status, toss_payment_key")
      .eq("id", order.id)
      .maybeSingle();
    if (curErr) {
      // 결제는 캡처됨 — 상태를 모르므로 아무것도 되돌리지 않고 새로고침으로 수렴시킨다.
      console.error("[payments/confirm] 캡처 후 주문 재조회 실패", {
        orderId: order.id,
        message: curErr.message,
      });
      return fail(
        "ORDER_UPDATE_FAILED",
        "결제는 승인됐지만 주문 반영이 지연되고 있습니다. 잠시 후 이 페이지를 새로고침하면 자동으로 복구됩니다.",
        500,
      );
    }
    if (
      current &&
      isPaidLikeStatus(current.status) &&
      current.toss_payment_key === expected.paymentKey
    ) {
      return idempotentPaid(admin, order.id, current.status);
    }
    // 토스 승인 호출 사이에 주문이 취소됐다(관리자 취소 등) — 돈만 빠진 채 남기지 않는다.
    // 키가 비어 있어도(해제 경합) 방금 받은 DONE 응답은 이 주문번호·금액의 결제로 대조를 통과했다.
    if (
      current?.status === "cancelled" &&
      (current.toss_payment_key === expected.paymentKey || current.toss_payment_key === null)
    ) {
      console.error("[payments/confirm] 캡처 직후 주문이 이미 취소됨 — 결제 전액 취소", {
        orderId: order.id,
      });
      return refundCancelledOrderCapture(admin, order, expected.paymentKey);
    }
    return fail(
      "ORDER_NOT_PENDING",
      "주문 상태가 바뀌어 결제를 확정하지 못했습니다. 주문 내역을 확인해주세요.",
      409,
      { status: current?.status ?? null },
    );
  }

  const fin = await finalizePaidOrder(admin, order.id, {
    claimed: true,
    trigger: "confirm",
    sendEmail: enqueueEmail,
  });

  return ok({
    orderId: order.id,
    status: "paid" as const,
    redirectUrl: `/order/${order.id}/success`,
    // PDF 는 백그라운드 빌드 — 응답 시점엔 결과를 모른다.
    // enqueue 실패 시에만 pdfError 로 안내 (관리자 재처리 대상).
    pdfError: fin.pdfError,
    pdfJobId: fin.pdfJobId,
  });
}

const PRICING_CHANGED_MESSAGE =
  "주문서를 만든 뒤 책 구성(페이지 수·사이즈·할인)이 바뀌어 결제 금액이 달라졌어요. 주문서를 새로고침한 뒤 다시 결제해주세요.";

/**
 * 결제 시점 가격 기준 재검증 (DEBT-2).
 *   orders/create 와 같은 규칙(quoteOrder·표지 규격 게이트)으로 현재 프로젝트를 다시 계산한다.
 * @returns 캡처를 막아야 하면 fail 응답, 아니면 null.
 */
async function checkPricingBasis(
  admin: Admin,
  order: ConfirmOrderRow,
): Promise<NextResponse<ApiFail> | null> {
  const { data: project, error: projErr } = await admin
    .from("projects")
    .select("id, book_size_id, cover_json")
    .eq("id", order.project_id)
    .maybeSingle();
  if (projErr) return fail("PROJECT_QUERY_FAILED", projErr.message, 500);
  if (!project) return fail("ORDER_PRICING_CHANGED", PRICING_CHANGED_MESSAGE, 409);

  const { count: pageCount, error: pagesErr } = await admin
    .from("pages")
    .select("id", { count: "exact", head: true })
    .eq("project_id", order.project_id);
  if (pagesErr) return fail("PAGES_QUERY_FAILED", pagesErr.message, 500);

  const { data: bookSize, error: sizeErr } = await admin
    .from("book_sizes")
    .select("id, name, cover_width_mm, cover_height_mm, spine_formula_per_page")
    .eq("id", project.book_size_id)
    .maybeSingle();
  if (sizeErr) return fail("BOOK_SIZE_QUERY_FAILED", sizeErr.message, 500);

  const pages = pageCount ?? 0;
  const stored = project.cover_json as unknown;
  if (
    !bookSize ||
    pages === 0 ||
    !stored ||
    !isPageDoc(stored) ||
    stored.layoutMode !== "cover"
  ) {
    return fail("ORDER_PRICING_CHANGED", PRICING_CHANGED_MESSAGE, 409, {
      reason: !bookSize ? "book_size" : pages === 0 ? "no_pages" : "no_cover",
    });
  }

  // 표지 규격 게이트 — orders/create 와 동일(페이지 수가 바뀌면 책등 폭도 바뀐다).
  const expectedCover = calcCoverDimensions({ bookSize, pageCount: pages });
  if (Math.abs(expectedCover.totalWidthMm - stored.widthMm) > 0.5) {
    return fail(
      "COVER_FORMAT_OUTDATED",
      "표지 규격이 갱신되었어요. 표지 편집기에서 '새 규격으로 다시 만들기'를 실행한 뒤 다시 주문해주세요.",
      409,
    );
  }

  let discount: { type: "percent" | "amount"; value: number } | null = null;
  if (order.discount_code_id) {
    const { data: dc, error: dcErr } = await admin
      .from("discount_codes")
      .select("type, value")
      .eq("id", order.discount_code_id)
      .maybeSingle();
    if (dcErr) return fail("DISCOUNT_QUERY_FAILED", dcErr.message, 500);
    discount = dc ?? null;
  }

  const drift = detectOrderPricingDrift({
    order,
    bookSize: bookSize.name,
    pageCount: pages,
    discount,
  });
  if (drift) {
    return fail("ORDER_PRICING_CHANGED", PRICING_CHANGED_MESSAGE, 409, drift);
  }
  return null;
}

/** 선점 실패 → 응답. 선점 실패는 아무것도 바꾸지 않았으므로 되돌릴 것이 없다. */
function reserveFailure(
  r: Extract<ReserveOrderCreditsResult, { ok: false }>,
): NextResponse<ApiFail> {
  switch (r.code) {
    case "NOT_FOUND":
      return fail("NOT_FOUND", "주문을 찾을 수 없습니다.", 404);
    case "NOT_PENDING":
      return fail(
        "ORDER_NOT_PENDING",
        `이미 처리된 주문입니다 (현재 상태: ${r.status ?? "unknown"}).`,
        409,
      );
    case "ORDER_CHANGED":
      return fail(
        "ORDER_CHANGED",
        "주문 정보가 바뀌었습니다. 주문서를 새로고침한 뒤 다시 결제해주세요.",
        409,
      );
    case "PAYMENT_KEY_CONFLICT":
      return fail(
        "PAYMENT_KEY_CONFLICT",
        "이 주문은 다른 결제로 진행 중입니다. 주문 내역을 확인해주세요.",
        409,
      );
    case "POINTS_INSUFFICIENT":
      return fail(
        "POINTS_INSUFFICIENT",
        "포인트 잔액이 부족해 결제를 진행할 수 없습니다. 주문을 다시 생성해주세요.",
        400,
        { requested: r.requested, balance: r.balance },
      );
    case "DISCOUNT_INVALID":
      if (r.reason === "already_used") {
        return fail(
          "DISCOUNT_ALREADY_USED",
          "이미 사용한 할인 코드예요. 주문을 다시 만들어 주세요.",
          400,
        );
      }
      return fail(
        "DISCOUNT_INVALID",
        `${r.reason ? reasonMessage(r.reason) : "사용할 수 없는 코드입니다."} 주문서를 새로고침해 할인 코드를 확인해주세요.`,
        400,
        { reason: r.reason },
      );
    case "CREDITS_STATE_INVALID":
      return fail(
        "CREDITS_STATE_INVALID",
        "주문의 포인트·할인 상태를 확인할 수 없어 결제를 중단했습니다. 고객센터에 문의해주세요.",
        409,
      );
    case "INVALID_ARGS":
    default:
      return fail("INVALID_BODY", "요청 본문이 올바르지 않습니다.", 400);
  }
}

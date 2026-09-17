import "server-only";

import { z } from "zod";

import { fail, failFromError, ok } from "@/app/api/_lib/response";
import { requireActiveUser } from "@/lib/auth/session";
import { createAdminSupabase } from "@/lib/db/admin";
import { createServerSupabase } from "@/lib/db/server";
import type { OrderStatus } from "@/lib/db/types";
import { assertTransition, decideUserCancel } from "@/lib/orders/state";
import { probeCancelVerdict, probeTossOrder } from "@/lib/orders/toss-order-probe";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteCtx = { params: { id: string } };

const ParamsSchema = z.object({ id: z.string().uuid() });

/**
 * POST /api/orders/[id]/cancel
 *
 *   사용자가 **결제하지 않은** 대기 주문을 직접 취소한다 (DEBT-6).
 *   결제창을 닫거나 결제에 실패한 pending 주문이 남아 탈퇴·주문 내역을 막는 문제의 해소 경로.
 *
 *   응답: { orderId, status: 'cancelled', alreadyCancelled }
 *
 * 규칙:
 *   1) 상태 판정 (lib/orders/state.ts decideUserCancel)
 *      - 본인 주문 + status='pending' + toss_payment_key IS NULL 만 다음 단계로.
 *      - 이미 cancelled 면 성공으로 응답(멱등 — 더블클릭·결제 실패 페이지 자동 정리와 겹쳐도 안전).
 *      - 그 밖의 상태(paid 이후)는 409 ORDER_NOT_CANCELLABLE — 환불은 고객센터/관리자 경로.
 *      - toss_payment_key 가 있는 pending 은 409 PAYMENT_IN_PROGRESS. 현재 결제 키는 paid 전이와
 *        같은 UPDATE 에서만 기록돼 이 조합은 생기지 않는다 — 데이터 이상에 대비한 방어 분기다.
 *   2) 토스 원장 확인 (lib/orders/toss-order-probe.ts) — **실질적인 결제 안전장치**.
 *      캡처는 됐는데 confirm 클레임 UPDATE 가 실패한 주문도 DB 상으로는 "pending + 키 없음" 이다.
 *      토스에 toss_order_id 로 승인된 결제가 없다고 확인될 때만 취소한다.
 *      - 결제 기록 있음(DONE 등) → 409 PAYMENT_IN_PROGRESS + console.error (운영 복구 대상).
 *      - 조회 실패(timeout·5xx·키 미설정 등) → 503 PAYMENT_STATUS_UNAVAILABLE (fail-closed).
 *
 * 포인트·할인은 결제 confirm 이 성공해야 차감·기록되므로 pending 취소에는 복원할 것이 없다.
 *
 * 동시성: 조건부 UPDATE(status='pending' AND toss_payment_key IS NULL)로 전이한다.
 *   결제 confirm 이 먼저 paid 로 클레임하면 이 UPDATE 는 빗나가고, 최신 행으로 다시 판정해 응답한다.
 *   남는 창: confirm 이 토스 승인 호출(수 초) 중일 때 probe 가 404 를 보고 취소가 먼저 커밋되면,
 *   confirm 의 클레임이 빗나간다 — 그 분기의 토스 결제 취소는 결제 쪽(payments/confirm) 소관이다.
 */
export async function POST(_req: Request, { params }: RouteCtx) {
  try {
    const user = await requireActiveUser();

    const paramsParse = ParamsSchema.safeParse(params);
    if (!paramsParse.success) {
      return fail("INVALID_PARAMS", "주문 id 형식이 올바르지 않습니다.", 400);
    }
    const orderId = paramsParse.data.id;

    // 1) 주문 로드 (RLS: orders_select_own — 본인 주문만 SELECT 가능)
    const supabase = createServerSupabase();
    const { data: order, error: orderErr } = await supabase
      .from("orders")
      .select("id, user_id, status, toss_payment_key, toss_order_id")
      .eq("id", orderId)
      .maybeSingle();
    if (orderErr) return fail("ORDER_QUERY_FAILED", orderErr.message, 500);
    if (!order) return fail("NOT_FOUND", "주문을 찾을 수 없습니다.", 404);
    if (order.user_id !== user.id) {
      return fail("FORBIDDEN", "해당 주문에 대한 권한이 없습니다.", 403);
    }

    // 2) 상태 판정
    const decision = decideUserCancel({
      status: order.status as OrderStatus,
      toss_payment_key: order.toss_payment_key,
    });
    if (decision.kind === "already_cancelled") {
      return ok({ orderId, status: "cancelled" as const, alreadyCancelled: true });
    }
    if (decision.kind === "reject") {
      return fail(decision.code, decision.message, decision.status, {
        status: order.status,
      });
    }

    // 3) 토스 원장 확인 — 승인된 결제가 없다는 것이 확인될 때만 취소 (fail-closed)
    const probe = await probeTossOrder(order.toss_order_id);
    const verdict = probeCancelVerdict(probe);
    if (verdict.kind === "reject") {
      if (probe.kind === "payment_found") {
        // 돈은 토스에 기록됐는데 주문은 pending — confirm/웹훅 반영 실패. 운영자가 복구해야 한다.
        console.error(
          `[orders/cancel] 토스에 결제 기록이 있는 pending 주문 — 사용자 취소 거부 (order=${orderId}, tossStatus=${probe.tossStatus})`,
        );
      } else if (probe.kind === "unavailable") {
        console.warn(
          `[orders/cancel] 토스 결제 조회 실패로 취소 보류 (order=${orderId}, code=${probe.code}): ${probe.message}`,
        );
      }
      return fail(verdict.code, verdict.message, verdict.status, {
        status: order.status,
        ...(probe.kind === "payment_found" ? { tossStatus: probe.tossStatus } : {}),
      });
    }

    // 4) 조건부 전이 (orders 쓰기는 service_role 만 — RLS 에 사용자 UPDATE 정책 없음)
    assertTransition("pending", "cancelled");
    const admin = createAdminSupabase();
    const { data: claimed, error: updErr } = await admin
      .from("orders")
      .update({ status: "cancelled" })
      .eq("id", orderId)
      .eq("user_id", user.id)
      .eq("status", "pending")
      .is("toss_payment_key", null)
      .select("id")
      .maybeSingle();
    if (updErr) return fail("ORDER_UPDATE_FAILED", updErr.message, 500);
    if (claimed) {
      return ok({ orderId, status: "cancelled" as const, alreadyCancelled: false });
    }

    // 5) 빗나감 — 판정과 UPDATE 사이에 결제 confirm·다른 취소 요청이 끼어들었다. 최신 행으로 재판정.
    const { data: latest, error: latestErr } = await admin
      .from("orders")
      .select("id, status, toss_payment_key")
      .eq("id", orderId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (latestErr) return fail("ORDER_QUERY_FAILED", latestErr.message, 500);
    if (!latest) return fail("NOT_FOUND", "주문을 찾을 수 없습니다.", 404);

    const again = decideUserCancel({
      status: latest.status as OrderStatus,
      toss_payment_key: latest.toss_payment_key,
    });
    if (again.kind === "already_cancelled") {
      return ok({ orderId, status: "cancelled" as const, alreadyCancelled: true });
    }
    if (again.kind === "reject") {
      return fail(again.code, again.message, again.status, { status: latest.status });
    }
    return fail(
      "ORDER_STATE_CHANGED",
      "주문 상태가 바뀌어 취소하지 못했어요. 새로고침 후 다시 시도해 주세요.",
      409,
    );
  } catch (err) {
    return failFromError(err);
  }
}

import "server-only";

import { z } from "zod";

import { fail, failFromError, ok } from "@/app/api/_lib/response";
import { requireActiveUser } from "@/lib/auth/session";
import { createAdminSupabase } from "@/lib/db/admin";
import { createServerSupabase } from "@/lib/db/server";
import type { OrderStatus } from "@/lib/db/types";
import { restoreOrderCredits } from "@/lib/orders/refund";
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
 *      - 이미 cancelled 면 성공으로 응답(멱등 — 더블클릭·결제 실패 화면의 취소 버튼과 겹쳐도 안전).
 *      - 그 밖의 상태(paid 이후)는 409 ORDER_NOT_CANCELLABLE — 환불은 고객센터/관리자 경로.
 *      - toss_payment_key 가 있는 pending 은 409 PAYMENT_IN_PROGRESS. 결제 confirm 은 캡처 **전에**
 *        키를 바인딩하므로(0033 reserve_order_credits) 키가 있으면 승인 진행 중이거나, 캡처됐는데
 *        확정 반영이 실패해 복구를 기다리는 주문일 수 있다 — 사용자가 취소하지 않는다.
 *   2) 토스 원장 확인 (lib/orders/toss-order-probe.ts) — 추가 방어선.
 *      캡처는 키 바인딩 뒤에만 일어나므로 키 없는 pending 은 원칙적으로 미결제다. 그래도 바인딩 도입
 *      이전의 주문·해제 경합에 대비해, 토스에 toss_order_id 로 승인된 결제가 없다고 확인될 때만 취소한다.
 *      - 결제 기록 있음(DONE 등) → 409 PAYMENT_IN_PROGRESS + console.error (운영 복구 대상).
 *      - 조회 실패(timeout·5xx·키 미설정 등) → 503 PAYMENT_STATUS_UNAVAILABLE (fail-closed).
 *   3) 전이 클레임 승자는 restoreOrderCredits — 잡힌 것만 되돌리는 멱등 함수라 호출 계약을 맞춘다
 *      (0033 원자 모드에서는 선점 해제가 키 해제와 함께 일어나 키 없는 pending 에는 보통 되돌릴 것이 없다).
 *
 * 동시성: 조건부 UPDATE(status='pending' AND toss_payment_key IS NULL AND toss_order_id = 확인한 값)로
 *   전이한다. confirm 이 먼저 선점(키 바인딩)하거나 paid 로 클레임하면, 또는 주문서 재사용(orders/create)이
 *   토스 주문번호를 새로 발급하면 이 UPDATE 는 빗나가고, 최신 행으로 다시 판정해 응답한다.
 *   반대로 취소가 먼저 커밋되면 confirm 의 선점이 NOT_PENDING 으로 끝나 캡처가 일어나지 않는다.
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
      .select("id, user_id, status, toss_payment_key, toss_order_id, points_used, discount_code_id")
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
    //    토스에 확인한 주문번호와 전이 대상이 같은 행일 때만 — 그 사이 주문서 재사용으로 새 결제창이
    //    열린 주문을 취소하지 않는다.
    assertTransition("pending", "cancelled");
    const admin = createAdminSupabase();
    const claim = admin
      .from("orders")
      .update({ status: "cancelled" })
      .eq("id", orderId)
      .eq("user_id", user.id)
      .eq("status", "pending")
      .is("toss_payment_key", null);
    const { data: claimed, error: updErr } = await (order.toss_order_id === null
      ? claim.is("toss_order_id", null)
      : claim.eq("toss_order_id", order.toss_order_id)
    )
      .select("id")
      .maybeSingle();
    if (updErr) return fail("ORDER_UPDATE_FAILED", updErr.message, 500);
    if (claimed) {
      // 클레임 승자만 — 잡힌 크레딧이 있으면 되돌린다(없으면 no-op). 실패해도 취소 응답은 유지.
      const restored = await restoreOrderCredits(admin, {
        id: order.id,
        user_id: order.user_id,
        points_used: order.points_used,
        discount_code_id: order.discount_code_id,
      });
      if (!restored.ok) {
        console.error("[orders/cancel] 취소 후 크레딧 복원 실패 — 관리자 확인 필요", {
          orderId,
          code: restored.code,
        });
      }
      return ok({ orderId, status: "cancelled" as const, alreadyCancelled: false });
    }

    // 5) 빗나감 — 판정과 UPDATE 사이에 결제 confirm(선점)·다른 취소 요청·주문서 재사용이 끼어들었다.
    //    최신 행으로 재판정.
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

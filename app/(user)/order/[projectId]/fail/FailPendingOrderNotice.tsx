"use client";

import { useState } from "react";

import CancelOrderButton from "@/app/(user)/mypage/orders/CancelOrderButton";
import { PENDING_ORDER_EXPIRY_HOURS } from "@/lib/orders/pending-expiry";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * 결제 실패 화면의 대기 주문 안내 (DEBT-6) — **자동으로 취소하지 않는다.**
 *
 * 대기 주문 정책(결제·주문 샤드 공통):
 *   - 결제창 이탈·결제 실패로 남은 pending 은 같은 포토북에서 다시 결제하면 orders/create 가 재사용한다
 *     (토스 주문번호를 새로 발급). 실패 화면에서 바로 취소하면 재사용 후보가 사라져 실패할 때마다
 *     cancelled 주문이 쌓이고, 주문이 달린 포토북은 삭제할 수 없게 된다(HAS_ORDERS).
 *   - 끝내 결제하지 않은 주문은 만료 cron 이 {PENDING_ORDER_EXPIRY_HOURS}시간 뒤 토스 확인을 거쳐 정리한다.
 *   - 지금 정리하고 싶은 사용자만 버튼으로 직접 취소한다 — 서버(POST /api/orders/[id]/cancel)가
 *     결제 키 없음 + 토스에 승인된 결제 없음을 확인한 뒤에만 취소한다.
 * GET 렌더에서 상태를 바꾸지 않는다(프리페치·미리보기 안전).
 */
export default function FailPendingOrderNotice({ orderId }: { orderId?: string }) {
  const [cancelled, setCancelled] = useState(false);
  if (typeof orderId !== "string" || !UUID_RE.test(orderId)) return null;

  return (
    <div className="mt-4 rounded-xl bg-muted/60 px-3 py-3 text-xs text-muted-foreground">
      <p aria-live="polite">
        {cancelled
          ? "결제 대기 주문을 취소했어요. 다시 주문하려면 '다시 시도'를 눌러 주세요."
          : `주문은 결제 대기 상태로 남아 있어요. '다시 시도'를 누르면 주문서에서 다시 결제할 수 있고, 결제하지 않은 대기 주문은 ${PENDING_ORDER_EXPIRY_HOURS}시간 뒤 자동으로 정리돼요.`}
      </p>
      {cancelled ? null : (
        <div className="mt-2 flex justify-center">
          <CancelOrderButton orderId={orderId} size="sm" onCancelled={() => setCancelled(true)} />
        </div>
      )}
    </div>
  );
}

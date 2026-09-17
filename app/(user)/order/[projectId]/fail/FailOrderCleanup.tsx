"use client";

import { useEffect, useRef, useState } from "react";

type Phase =
  | "idle"
  | "working"
  | "cancelled"
  | "in_progress"
  | "not_cancellable"
  | "unavailable"
  | "error";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const MESSAGE: Record<Exclude<Phase, "idle">, string> = {
  working: "결제되지 않은 주문을 정리하고 있어요…",
  cancelled: "결제 내역이 없는 것을 확인하고 이 주문을 자동으로 취소했어요.",
  in_progress:
    "결제 내역이 확인되는 주문이라 자동으로 취소하지 않았어요. 주문 내역에서 상태를 확인해 주시고, 결제 대기로 계속 보이면 고객센터로 문의해 주세요.",
  not_cancellable: "이 주문은 이미 결제 처리가 진행됐어요. 주문 내역에서 확인해 주세요.",
  unavailable:
    "지금은 결제 상태를 확인하지 못해 주문을 정리하지 않았어요. 잠시 후 주문 내역에서 '주문 취소'를 눌러 주세요.",
  error:
    "주문을 자동으로 정리하지 못했어요. 주문 내역에서 '주문 취소'를 눌러 직접 정리할 수 있어요.",
};

interface CancelResponse {
  ok: boolean;
  error?: { code?: string; message?: string };
}

/**
 * 결제 실패 페이지의 대기 주문 정리 (DEBT-6).
 *
 * 토스 failUrl 로 돌아왔다는 것은 결제 승인이 일어나지 않았다는 뜻이다. '다시 시도' 는 주문서에서
 * 새 주문을 만들므로, 방금 실패한 pending 주문은 더 쓰이지 않는다 — 남겨 두면 주문 내역·탈퇴를 막는다.
 * 그래서 진입 즉시 POST /api/orders/[id]/cancel 을 1회 호출한다.
 *   - 서버는 본인 주문 + pending + 결제 키 없음 + 토스 원장에 승인된 결제 없음일 때만 취소하고,
 *     이미 취소됐으면 성공(멱등)으로 응답한다.
 *   - 토스에 결제 기록이 있거나 조회가 실패하면 서버가 거부하므로 결제된 주문을 잘못 취소하지 않는다.
 *   - GET 렌더에서 상태를 바꾸지 않도록(프리페치·미리보기) 클라이언트 POST 로 한다.
 */
export default function FailOrderCleanup({ orderId }: { orderId?: string }) {
  const valid = typeof orderId === "string" && UUID_RE.test(orderId);
  const [phase, setPhase] = useState<Phase>(valid ? "working" : "idle");
  const calledRef = useRef(false);

  useEffect(() => {
    // StrictMode 이중 실행 방지 — 서버가 멱등이라 두 번 가도 안전하지만 요청을 줄인다.
    if (!valid || calledRef.current) return;
    calledRef.current = true;

    (async () => {
      try {
        const res = await fetch(`/api/orders/${orderId}/cancel`, { method: "POST" });
        const json = (await res.json().catch(() => null)) as CancelResponse | null;
        if (res.ok && json?.ok) {
          setPhase("cancelled");
          return;
        }
        const code = json?.error?.code;
        setPhase(
          code === "PAYMENT_IN_PROGRESS"
            ? "in_progress"
            : code === "ORDER_NOT_CANCELLABLE"
              ? "not_cancellable"
              : code === "PAYMENT_STATUS_UNAVAILABLE"
                ? "unavailable"
                : "error",
        );
      } catch {
        setPhase("error");
      }
    })();
  }, [valid, orderId]);

  if (phase === "idle") return null;

  return (
    <p
      role="status"
      aria-live="polite"
      className="mt-4 rounded-xl bg-muted/60 px-3 py-2 text-xs text-muted-foreground"
    >
      {MESSAGE[phase]}
    </p>
  );
}

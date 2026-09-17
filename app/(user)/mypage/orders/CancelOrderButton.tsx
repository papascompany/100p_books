"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/components/ui/use-toast";

export interface CancelOrderButtonProps {
  orderId: string;
  orderTitle?: string | null;
  /** 주변 버튼과 높이를 맞춘다 — 목록은 sm, 상세는 default. */
  size?: "sm" | "default";
  /** 취소 성공(이미 취소 포함) 후 호출 — 결제 실패 화면처럼 새로고침으로 버튼이 사라지지 않는 곳에서 사용. */
  onCancelled?: () => void;
}

interface CancelResponse {
  ok: boolean;
  data?: { orderId: string; status: string; alreadyCancelled: boolean };
  error?: { code?: string; message?: string };
}

/**
 * 결제 대기(결제 키 없는 pending) 주문의 "주문 취소" 버튼 + 확인 다이얼로그 (DEBT-6).
 * 노출 여부는 호출 측이 lib/orders/state.ts isUserCancellable 로 판정한다 —
 * 서버(POST /api/orders/[id]/cancel)는 같은 규칙에 더해 토스 원장에 승인된 결제가 없음을 확인한 뒤에만
 * 취소한다. 그래서 다이얼로그(확인 전)는 "청구 없음" 을 단정하지 않고, 성공 토스트에서만 말한다.
 */
export default function CancelOrderButton({
  orderId,
  orderTitle,
  size = "sm",
  onCancelled,
}: CancelOrderButtonProps) {
  const router = useRouter();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  async function handleCancel() {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/orders/${orderId}/cancel`, { method: "POST" });
      const json = (await res.json().catch(() => null)) as CancelResponse | null;
      if (!res.ok || !json?.ok) {
        throw new Error(json?.error?.message ?? "주문을 취소하지 못했어요.");
      }
      toast({
        variant: "success",
        title: "주문을 취소했어요.",
        description: "결제 내역이 없는 것을 확인하고 취소했어요.",
      });
      setOpen(false);
      onCancelled?.();
    } catch (e) {
      toast({
        variant: "destructive",
        title: "주문 취소 실패",
        description: e instanceof Error ? e.message : "알 수 없는 오류",
      });
    } finally {
      setBusy(false);
      // 성공이든 실패든(그 사이 결제가 완료됐을 수 있음) 최신 주문 상태로 다시 그린다.
      router.refresh();
    }
  }

  return (
    <>
      <Button
        type="button"
        size={size}
        variant="outline"
        onClick={() => setOpen(true)}
        disabled={busy}
      >
        주문 취소
      </Button>

      <Dialog
        open={open}
        onOpenChange={(next) => {
          // 요청 중에는 바깥 클릭·Esc 로 닫지 않는다(결과 토스트를 놓치지 않게).
          if (!busy) setOpen(next);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>결제 대기 주문을 취소할까요?</DialogTitle>
            <DialogDescription>
              {orderTitle ? `'${orderTitle}' 주문은 ` : "이 주문은 "}
              아직 결제가 확인되지 않았어요. 취소 전에 결제 내역을 한 번 더 확인하고, 결제
              기록이 있으면 취소하지 않아요. 취소한 주문은 되돌릴 수 없고, 다시 주문하려면
              주문서를 새로 작성하면 돼요.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-5">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setOpen(false)}
              disabled={busy}
            >
              닫기
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => void handleCancel()}
              disabled={busy}
            >
              {busy ? "취소 중..." : "주문 취소"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

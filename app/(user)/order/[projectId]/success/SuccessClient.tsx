"use client";

import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { GiftDialog } from "@/components/orders/GiftDialog";
import { Button } from "@/components/ui/button";

export interface SuccessClientProps {
  projectId: string;
  orderId: string;
  paymentKey: string;
  tossOrderId: string;
  amount: number;
}

type Phase = "confirming" | "success" | "failed";

interface ConfirmResponse {
  ok: boolean;
  data?: {
    orderId: string;
    status: string;
    redirectUrl: string;
    pdfError?: string | null;
    idempotent?: boolean;
  };
  error?: { message: string; code?: string };
}

/**
 * 결제 성공 콜백 — confirm API 호출.
 *   - StrictMode 중복 호출 방지: ref guard.
 *   - 응답에 따라 success/failed phase 표시.
 *   - PDF 빌드는 confirm 내부에서 인라인으로 실행되므로 응답이 길어질 수 있음 (최대 5분).
 */
export default function SuccessClient(props: SuccessClientProps) {
  const [phase, setPhase] = useState<Phase>("confirming");
  const [error, setError] = useState<string | null>(null);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const calledRef = useRef(false);

  useEffect(() => {
    if (calledRef.current) return;
    calledRef.current = true;

    (async () => {
      try {
        const res = await fetch("/api/payments/confirm", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            orderId: props.orderId,
            paymentKey: props.paymentKey,
            amount: props.amount,
            tossOrderId: props.tossOrderId,
          }),
        });
        const json = (await res.json()) as ConfirmResponse;
        if (!res.ok || !json.ok || !json.data) {
          throw new Error(json.error?.message ?? "결제 확정 실패");
        }
        setPhase("success");
        if (json.data.pdfError) setPdfError(json.data.pdfError);
      } catch (e) {
        setError(e instanceof Error ? e.message : "결제 확정 실패");
        setPhase("failed");
      }
    })();
  }, [props.orderId, props.paymentKey, props.amount, props.tossOrderId]);

  if (phase === "confirming") {
    return (
      <div className="mx-auto max-w-xl rounded-2xl border border-hairline bg-card p-8 text-center shadow-soft">
        <Loader2 className="mx-auto h-10 w-10 animate-spin text-coral" />
        <h1 className="mt-4 font-display text-xl font-semibold">
          결제 확정 중…
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          PDF 파일을 만들고 있습니다. 잠시만 기다려주세요. (최대 1~2분)
        </p>
      </div>
    );
  }

  if (phase === "failed") {
    return (
      <div className="mx-auto max-w-xl rounded-2xl border border-hairline bg-card p-8 text-center shadow-soft">
        <XCircle className="mx-auto h-10 w-10 text-destructive" />
        <h1 className="mt-4 font-display text-xl font-semibold">
          결제 확정 실패
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {error ?? "알 수 없는 오류가 발생했습니다."}
        </p>
        <p className="mt-2 text-xs text-muted-foreground">
          결제가 이미 처리되었다면 마이페이지에서 확인할 수 있습니다.
        </p>
        <div className="mt-5 flex justify-center gap-2">
          <Button asChild variant="outline">
            <Link href={`/order/${props.projectId}`}>다시 시도</Link>
          </Button>
          <Button asChild variant="coral">
            <Link href="/mypage/orders">주문 내역</Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-xl rounded-2xl border border-hairline bg-card p-8 text-center shadow-soft">
      <CheckCircle2 className="mx-auto h-10 w-10 text-coral" />
      <h1 className="mt-4 font-display text-2xl font-semibold">
        결제가 완료되었습니다
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">
        주문이 접수되었습니다. 마이페이지에서 진행 상황을 확인할 수 있습니다.
      </p>
      {pdfError ? (
        <p className="mx-auto mt-3 max-w-md rounded-md border border-coral-200 bg-coral-50 p-2 text-xs text-coral-700 dark:border-coral-700 dark:bg-coral-950/30 dark:text-coral-300">
          PDF 자동 생성에 일시적인 문제가 있었습니다. 관리자가 확인 후 빠르게
          재처리합니다.
        </p>
      ) : null}
      <div className="mt-5 flex flex-wrap justify-center gap-2">
        <Button asChild variant="outline">
          <Link href="/">홈</Link>
        </Button>
        <GiftDialog orderId={props.orderId} />
        <Button asChild variant="coral">
          <Link href={`/mypage/orders/${props.orderId}`}>주문 상세</Link>
        </Button>
      </div>
    </div>
  );
}

"use client";

import { useRouter } from "next/navigation";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/use-toast";
import type { OrderStatus } from "@/lib/db/types";
import { canTransition } from "@/lib/orders/state";

const NEXT: Array<{ to: OrderStatus; label: string; tone?: "default" | "destructive" }> = [
  { to: "in_production", label: "제작 시작" },
  { to: "shipped", label: "발송 처리 (송장 입력)" },
  { to: "delivered", label: "배송 완료" },
  { to: "cancelled", label: "주문 취소", tone: "destructive" },
  { to: "refunded", label: "환불 처리", tone: "destructive" },
];

const CARRIER_OPTIONS = [
  { value: "cj", label: "CJ대한통운" },
  { value: "hanjin", label: "한진택배" },
  { value: "lotte", label: "롯데택배" },
  { value: "post", label: "우체국택배" },
  { value: "logen", label: "로젠택배" },
  { value: "etc", label: "기타" },
];

export interface PdfJobBrief {
  id: string;
  status: string;
  attempt: number;
  maxAttempts: number;
  lastError: string | null;
}

export default function OrderActions({
  orderId,
  status,
  trackingNo,
  trackingCarrier,
  pdfJob,
}: {
  orderId: string;
  status: OrderStatus;
  trackingNo: string | null;
  trackingCarrier: string | null;
  pdfJob?: PdfJobBrief | null;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [busy, setBusy] = React.useState(false);
  const [tNo, setTNo] = React.useState(trackingNo ?? "");
  const [tCarrier, setTCarrier] = React.useState(trackingCarrier ?? "cj");
  const [showShip, setShowShip] = React.useState(false);

  const transition = async (
    to: OrderStatus,
    extras?: { trackingNo?: string; trackingCarrier?: string },
  ) => {
    if (extras && (!extras.trackingNo || !extras.trackingCarrier)) {
      toast({
        variant: "destructive",
        title: "송장 정보 누락",
        description: "송장번호와 배송사를 입력하세요.",
      });
      return;
    }
    if (
      to === "cancelled" || to === "refunded"
        ? !confirm(
            to === "refunded"
              ? "환불 처리하시겠습니까? 결제 환불은 별도 토스 콘솔에서 진행해야 합니다."
              : "주문을 취소하시겠습니까?",
          )
        : !confirm(`상태를 '${to}' 로 변경하시겠습니까?`)
    ) {
      return;
    }
    setBusy(true);
    try {
      const r = await fetch(`/api/admin/orders/${orderId}/transition`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ to, ...extras }),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.ok) {
        toast({
          variant: "destructive",
          title: "상태 변경 실패",
          description: j?.error?.message ?? "알 수 없는 오류",
        });
        return;
      }
      toast({ variant: "success", title: `상태 변경: ${to}` });
      setShowShip(false);
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  const rebuildPdf = async () => {
    if (!confirm("표지/내지 PDF 를 재생성합니다. 계속하시겠습니까?")) return;
    setBusy(true);
    try {
      const r = await fetch(`/api/admin/orders/${orderId}/rebuild-pdf`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ target: "all" }),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.ok) {
        toast({
          variant: "destructive",
          title: "PDF 재생성 실패",
          description: j?.error?.message ?? "알 수 없는 오류",
        });
        return;
      }
      toast({
        variant: "success",
        title: "PDF 재생성 완료",
        description: "표지/내지 PDF 가 갱신되었습니다.",
      });
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  const retryPdfJob = async () => {
    if (!confirm("실패한 PDF 빌드 잡을 재시도합니다. 계속하시겠습니까?")) return;
    setBusy(true);
    try {
      const r = await fetch(`/api/admin/orders/${orderId}/retry-pdf`, {
        method: "POST",
      });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.ok) {
        toast({
          variant: "destructive",
          title: "PDF 재시도 실패",
          description: j?.error?.message ?? "알 수 없는 오류",
        });
        return;
      }
      toast({
        variant: "success",
        title: "PDF 재시도 완료",
        description: "잡 상태를 확인하세요.",
      });
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  const showRetry = pdfJob && pdfJob.status === "failed";
  const retryDisabled = pdfJob ? pdfJob.attempt >= pdfJob.maxAttempts : true;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {NEXT.filter((opt) => canTransition(status, opt.to)).map((opt) => {
          if (opt.to === "shipped") {
            return (
              <Button
                key={opt.to}
                variant="default"
                size="sm"
                onClick={() => setShowShip((v) => !v)}
                disabled={busy}
                type="button"
              >
                {opt.label}
              </Button>
            );
          }
          return (
            <Button
              key={opt.to}
              variant={opt.tone === "destructive" ? "destructive" : "default"}
              size="sm"
              onClick={() => transition(opt.to)}
              disabled={busy}
              type="button"
            >
              {opt.label}
            </Button>
          );
        })}
        <Button
          variant="outline"
          size="sm"
          onClick={rebuildPdf}
          disabled={busy}
          type="button"
        >
          PDF 재생성
        </Button>
        {showRetry ? (
          <Button
            variant="outline"
            size="sm"
            onClick={retryPdfJob}
            disabled={busy || retryDisabled}
            type="button"
            title={
              retryDisabled
                ? `최대 시도(${pdfJob.maxAttempts}) 초과`
                : `시도 ${pdfJob.attempt}/${pdfJob.maxAttempts}`
            }
          >
            PDF 빌드 재시도
            <span className="ml-1 text-[10px] text-muted-foreground">
              ({pdfJob.attempt}/{pdfJob.maxAttempts})
            </span>
          </Button>
        ) : null}
      </div>

      {pdfJob && pdfJob.status === "failed" && pdfJob.lastError ? (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive">
          <strong>마지막 빌드 에러:</strong>
          <pre className="mt-1 whitespace-pre-wrap font-mono text-[11px]">
            {pdfJob.lastError}
          </pre>
        </div>
      ) : null}

      {showShip ? (
        <div className="rounded-xl border bg-muted/30 p-3">
          <p className="mb-2 text-xs text-muted-foreground">
            발송 처리에는 송장번호와 배송사가 필요합니다.
          </p>
          <div className="flex flex-wrap items-end gap-2">
            <label className="block">
              <span className="block text-[11px] font-medium text-muted-foreground">
                배송사
              </span>
              <select
                value={tCarrier}
                onChange={(e) => setTCarrier(e.target.value)}
                className="mt-1 h-10 rounded-md border border-input bg-background px-3 text-sm"
              >
                {CARRIER_OPTIONS.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block flex-1 min-w-[200px]">
              <span className="block text-[11px] font-medium text-muted-foreground">
                송장번호
              </span>
              <Input
                value={tNo}
                onChange={(e) => setTNo(e.target.value)}
                className="h-10"
              />
            </label>
            <Button
              size="sm"
              variant="gradient"
              onClick={() =>
                transition("shipped", {
                  trackingNo: tNo.trim(),
                  trackingCarrier: tCarrier,
                })
              }
              disabled={busy || !tNo.trim()}
              type="button"
            >
              확정
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setShowShip(false)}
              disabled={busy}
              type="button"
            >
              취소
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

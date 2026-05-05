"use client";

import { useRouter } from "next/navigation";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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

export default function OrderActions({
  orderId,
  status,
  trackingNo,
  trackingCarrier,
}: {
  orderId: string;
  status: OrderStatus;
  trackingNo: string | null;
  trackingCarrier: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [tNo, setTNo] = React.useState(trackingNo ?? "");
  const [tCarrier, setTCarrier] = React.useState(trackingCarrier ?? "cj");
  const [showShip, setShowShip] = React.useState(false);

  const transition = async (
    to: OrderStatus,
    extras?: { trackingNo?: string; trackingCarrier?: string },
  ) => {
    if (extras && (!extras.trackingNo || !extras.trackingCarrier)) {
      alert("송장번호와 배송사를 입력하세요.");
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
        alert(j?.error?.message ?? "상태 변경 실패");
        return;
      }
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
        alert(j?.error?.message ?? "재생성 실패");
        return;
      }
      alert("PDF 재생성 완료.");
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

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
      </div>

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

"use client";

import { Check, Copy } from "lucide-react";
import { useEffect, useState } from "react";

import { toast } from "@/components/ui/use-toast";

/** 송장번호 클립보드 복사 — 주문 상세 배송 정보 영역에서 쓴다. */
export default function CopyTrackingButton({ trackingNo }: { trackingNo: string }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(t);
  }, [copied]);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(trackingNo);
      setCopied(true);
      toast({ title: "송장번호를 복사했어요", variant: "success" });
    } catch {
      toast({
        title: "복사하지 못했어요",
        description: "송장번호를 길게 눌러 직접 복사해 주세요.",
        variant: "destructive",
      });
    }
  }

  return (
    <button
      type="button"
      onClick={() => void handleCopy()}
      aria-label="송장번호 복사"
      className="inline-flex min-h-8 min-w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {copied ? (
        <Check className="h-4 w-4 text-emerald-600" aria-hidden />
      ) : (
        <Copy className="h-4 w-4" aria-hidden />
      )}
    </button>
  );
}

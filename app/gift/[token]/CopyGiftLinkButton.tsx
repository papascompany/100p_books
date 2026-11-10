"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/use-toast";

/**
 * 보낸 사람이 자기 사본 링크를 열었을 때 — 지금 보고 있는 주소(쿼리·해시 제외)를 복사한다.
 * 서버가 APP_URL 을 몰라도 되도록 브라우저의 현재 origin 을 쓴다.
 */
export function CopyGiftLinkButton() {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    const url = `${window.location.origin}${window.location.pathname}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      toast({ title: "링크를 복사했어요", variant: "success" });
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast({
        title: "링크를 복사하지 못했어요",
        description: "주소창의 링크를 직접 복사해 주세요.",
        variant: "destructive",
      });
    }
  }

  return (
    <Button
      type="button"
      variant="gradient"
      size="lg"
      onClick={handleCopy}
      className="w-full gap-2"
    >
      {copied ? (
        <Check className="h-4 w-4" aria-hidden="true" />
      ) : (
        <Copy className="h-4 w-4" aria-hidden="true" />
      )}
      {copied ? "복사했어요" : "받기 링크 복사"}
    </Button>
  );
}

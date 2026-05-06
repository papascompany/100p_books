"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Check, Copy, Gift, Loader2, X } from "lucide-react";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/use-toast";
import { cn } from "@/lib/utils";

// ─── Radix Dialog 래퍼 (shadcn 패턴) ───────────────────────────────────────

const Dialog = DialogPrimitive.Root;
const DialogTrigger = DialogPrimitive.Trigger;

const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      "fixed inset-0 z-50 bg-black/50 backdrop-blur-sm",
      "data-[state=open]:animate-in data-[state=open]:fade-in-0",
      "data-[state=closed]:animate-out data-[state=closed]:fade-out-0",
      className,
    )}
    {...props}
  />
));
DialogOverlay.displayName = "DialogOverlay";

const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(({ className, children, ...props }, ref) => (
  <DialogPrimitive.Portal>
    <DialogOverlay />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        "fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2",
        "rounded-2xl border bg-card p-6 shadow-[0_8px_32px_rgba(0,0,0,0.12)]",
        "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95",
        "data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95",
        "focus:outline-none",
        className,
      )}
      {...props}
    >
      {children}
      <DialogPrimitive.Close
        className={cn(
          "absolute right-4 top-4 rounded-md p-1 text-muted-foreground",
          "transition-colors hover:text-foreground",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        )}
        aria-label="닫기"
      >
        <X className="h-4 w-4" />
      </DialogPrimitive.Close>
    </DialogPrimitive.Content>
  </DialogPrimitive.Portal>
));
DialogContent.displayName = "DialogContent";

// ─── 응답 타입 ────────────────────────────────────────────────────────────

interface GiftApiSuccess {
  ok: true;
  data: {
    giftId: string;
    giftToken: string;
    shareUrl: string;
    expiresAt: string;
  };
}

interface GiftApiError {
  ok: false;
  error: { message: string; code?: string };
}

type GiftApiResponse = GiftApiSuccess | GiftApiError;

// ─── 메인 컴포넌트 ─────────────────────────────────────────────────────────

export interface GiftDialogProps {
  /** orders.id (UUID) */
  orderId: string;
  /** 트리거가 될 자식 요소. 없으면 내부 기본 버튼 사용. */
  children?: React.ReactNode;
}

type Phase = "form" | "sending" | "success";

const MAX_MSG = 200;

export function GiftDialog({ orderId, children }: GiftDialogProps) {
  const [open, setOpen] = React.useState(false);
  const [phase, setPhase] = React.useState<Phase>("form");
  const [email, setEmail] = React.useState("");
  const [message, setMessage] = React.useState("");
  const [emailError, setEmailError] = React.useState<string | null>(null);
  const [apiError, setApiError] = React.useState<string | null>(null);
  const [shareUrl, setShareUrl] = React.useState<string | null>(null);
  const [copied, setCopied] = React.useState(false);

  // 다이얼로그 열릴 때 상태 초기화
  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      // 닫힐 때 — 애니메이션이 끝난 뒤 리셋 (300ms)
      setTimeout(() => {
        setPhase("form");
        setEmail("");
        setMessage("");
        setEmailError(null);
        setApiError(null);
        setShareUrl(null);
        setCopied(false);
      }, 300);
    }
  }

  function validateEmail(val: string): boolean {
    if (!val.trim()) {
      setEmailError("수신자 이메일을 입력해주세요.");
      return false;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val.trim())) {
      setEmailError("올바른 이메일 주소를 입력해주세요.");
      return false;
    }
    setEmailError(null);
    return true;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validateEmail(email)) return;
    setApiError(null);
    setPhase("sending");

    try {
      const res = await fetch(`/api/orders/${orderId}/gift`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          recipientEmail: email.trim(),
          message: message.trim() || undefined,
        }),
      });
      const json = (await res.json()) as GiftApiResponse;

      if (!res.ok || !json.ok) {
        const errMsg =
          (json as GiftApiError).error?.message ?? "선물 발송에 실패했습니다.";
        setApiError(errMsg);
        setPhase("form");
        return;
      }

      setShareUrl(json.data.shareUrl);
      setPhase("success");
    } catch {
      setApiError("네트워크 오류가 발생했습니다. 잠시 후 다시 시도해주세요.");
      setPhase("form");
    }
  }

  async function handleCopy() {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      toast({ title: "링크가 복사되었습니다", variant: "success" });
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard API 실패 시 선택 폴백
      const el = document.createElement("input");
      el.value = shareUrl;
      document.body.appendChild(el);
      el.select();
      document.execCommand("copy");
      document.body.removeChild(el);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  const trigger = children ?? (
    <Button variant="outline" size="sm" className="gap-1.5">
      <Gift className="h-4 w-4" aria-hidden="true" />
      선물하기
    </Button>
  );

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>

      <DialogContent aria-describedby="gift-dialog-desc">
        {/* 헤더 */}
        <div className="flex items-center gap-3 mb-5">
          <span
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-rose-100 to-amber-100 dark:from-rose-900/30 dark:to-amber-900/30"
            aria-hidden="true"
          >
            <Gift className="h-5 w-5 text-rose-500" />
          </span>
          <div>
            <DialogPrimitive.Title className="text-base font-semibold leading-tight">
              선물하기
            </DialogPrimitive.Title>
            <p
              id="gift-dialog-desc"
              className="text-sm text-muted-foreground mt-0.5"
            >
              포토북을 소중한 분께 선물해보세요
            </p>
          </div>
        </div>

        {/* 성공 화면 */}
        {phase === "success" && shareUrl ? (
          <div className="space-y-4">
            <div className="rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900/50 p-4 text-center">
              <Check
                className="mx-auto h-8 w-8 text-emerald-500 mb-2"
                aria-hidden="true"
              />
              <p className="text-sm font-medium text-emerald-800 dark:text-emerald-200">
                선물 링크가 전송되었습니다
              </p>
              <p className="mt-1 text-xs text-emerald-600 dark:text-emerald-400">
                {email} 으로 이메일을 발송했습니다
              </p>
            </div>

            <div>
              <p className="text-xs text-muted-foreground mb-1.5">
                직접 링크 공유
              </p>
              <div className="flex items-center gap-2">
                <input
                  readOnly
                  value={shareUrl}
                  className="h-10 flex-1 rounded-lg border border-input bg-muted/50 px-3 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background"
                  aria-label="선물 링크"
                  onFocus={(e) => e.target.select()}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleCopy}
                  aria-label="선물 링크 복사"
                  className="shrink-0 gap-1.5"
                >
                  {copied ? (
                    <Check className="h-4 w-4 text-emerald-500" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                  {copied ? "복사됨" : "복사"}
                </Button>
              </div>
            </div>

            <Button
              type="button"
              variant="outline"
              className="w-full"
              onClick={() => handleOpenChange(false)}
            >
              닫기
            </Button>
          </div>
        ) : (
          /* 폼 화면 */
          <form onSubmit={handleSubmit} noValidate className="space-y-4">
            {/* 수신자 이메일 */}
            <div className="space-y-1.5">
              <label
                htmlFor="gift-recipient-email"
                className="text-sm font-medium"
              >
                수신자 이메일
                <span className="text-rose-500 ml-0.5" aria-hidden="true">
                  *
                </span>
              </label>
              <Input
                id="gift-recipient-email"
                type="email"
                placeholder="example@email.com"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  if (emailError) validateEmail(e.target.value);
                }}
                onBlur={() => validateEmail(email)}
                disabled={phase === "sending"}
                aria-required="true"
                aria-describedby={
                  emailError ? "gift-email-error" : undefined
                }
                aria-invalid={emailError ? "true" : undefined}
                autoComplete="email"
                autoFocus
              />
              {emailError && (
                <p
                  id="gift-email-error"
                  role="alert"
                  className="text-xs text-destructive"
                >
                  {emailError}
                </p>
              )}
            </div>

            {/* 메시지 */}
            <div className="space-y-1.5">
              <label
                htmlFor="gift-message"
                className="text-sm font-medium"
              >
                메시지{" "}
                <span className="text-xs font-normal text-muted-foreground">
                  (선택)
                </span>
              </label>
              <textarea
                id="gift-message"
                rows={3}
                placeholder="따뜻한 메시지를 남겨보세요…"
                maxLength={MAX_MSG}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                disabled={phase === "sending"}
                className={cn(
                  "flex w-full rounded-md border border-input bg-background px-4 py-2.5 text-sm",
                  "placeholder:text-muted-foreground resize-none",
                  "transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                  "disabled:cursor-not-allowed disabled:opacity-50",
                )}
              />
              <p className="text-right text-xs text-muted-foreground">
                {message.length} / {MAX_MSG}
              </p>
            </div>

            {/* API 에러 */}
            {apiError && (
              <div
                role="alert"
                className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive"
              >
                {apiError}
              </div>
            )}

            {/* 액션 버튼 */}
            <div className="flex gap-2 pt-1">
              <Button
                type="button"
                variant="outline"
                className="flex-1"
                onClick={() => handleOpenChange(false)}
                disabled={phase === "sending"}
              >
                취소
              </Button>
              <Button
                type="submit"
                variant="gradient"
                className="flex-1"
                disabled={phase === "sending"}
              >
                {phase === "sending" ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    발송 중…
                  </>
                ) : (
                  <>
                    <Gift className="h-4 w-4" aria-hidden="true" />
                    선물 보내기
                  </>
                )}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

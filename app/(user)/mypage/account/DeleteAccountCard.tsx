"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { AlertTriangle, Loader2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/use-toast";
import { getBrowserSupabase } from "@/lib/db/browser";
import { cn } from "@/lib/utils";

const REASONS = [
  { value: "no-need", label: "더 이상 사용하지 않아요" },
  { value: "privacy", label: "개인정보 보안이 걱정돼요" },
  { value: "service-issue", label: "서비스/품질 불만이 있어요" },
  { value: "duplicate", label: "다른 계정을 사용해요" },
  { value: "other", label: "기타" },
] as const;

interface ApiResponse<T> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string; details?: unknown };
}

export default function DeleteAccountCard({
  email,
  blockingOrderCount,
}: {
  email: string;
  blockingOrderCount: number;
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [confirmEmail, setConfirmEmail] = React.useState("");
  const [confirmText, setConfirmText] = React.useState("");
  const [reason, setReason] = React.useState<string>(REASONS[0].value);
  const [reasonText, setReasonText] = React.useState("");
  const [agreed, setAgreed] = React.useState(false);

  const CONFIRM_PHRASE = "회원 탈퇴";
  const blocked = blockingOrderCount > 0;
  const emailMatches =
    confirmEmail.trim().toLowerCase() === (email ?? "").trim().toLowerCase();
  const textMatches = confirmText.trim() === CONFIRM_PHRASE;
  const canSubmit =
    !busy && !blocked && emailMatches && textMatches && agreed && !!email;

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    try {
      const composedReason =
        reason === "other" ? reasonText.slice(0, 500) : reason;

      const res = await fetch("/api/account/delete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          confirmEmail: confirmEmail.trim(),
          confirmText: confirmText.trim(),
          reason: composedReason || undefined,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as ApiResponse<unknown>;
      if (!res.ok || !json.ok) {
        const code = json.error?.code ?? "UNKNOWN";
        const msg = json.error?.message ?? "탈퇴 처리에 실패했습니다.";
        toast({
          variant: "destructive",
          title:
            code === "ORDERS_IN_PROGRESS"
              ? "처리 중인 주문이 있어요"
              : "탈퇴에 실패했어요",
          description: msg,
        });
        return;
      }

      // 클라이언트 세션 정리
      try {
        await getBrowserSupabase().auth.signOut();
      } catch {
        /* 무시 */
      }

      toast({
        variant: "success",
        title: "탈퇴가 완료됐어요",
        description: "그동안 이용해 주셔서 감사합니다.",
      });
      setOpen(false);
      router.replace("/");
      router.refresh();
    } catch (err) {
      toast({
        variant: "destructive",
        title: "네트워크 오류",
        description:
          err instanceof Error ? err.message : "잠시 후 다시 시도해 주세요.",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="border-destructive/40">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base text-destructive">
          <AlertTriangle className="size-4" />
          회원 탈퇴
        </CardTitle>
        <CardDescription>
          탈퇴 시 프로필이 즉시 익명화되며 다시 로그인할 수 없어요. 주문·결제
          기록은 전자상거래법에 따라 5년간 보존됩니다.
        </CardDescription>
      </CardHeader>
      <CardContent className="text-sm text-muted-foreground">
        {blocked ? (
          <p className="rounded-md bg-amber-50 px-3 py-2 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
            처리 중인 주문이 <strong>{blockingOrderCount}건</strong> 있어요.
            결제 취소 또는 배송 완료 후 다시 시도해 주세요.
          </p>
        ) : (
          <ul className="list-disc space-y-1 pl-5">
            <li>업로드한 사진과 작업 중인 프로젝트는 더 이상 접근할 수 없어요.</li>
            <li>이메일은 비워지고, 프로필명은 &lsquo;탈퇴회원&rsquo;으로 변경돼요.</li>
            <li>
              주문·결제·배송 기록은 법정 보존 기간 동안 식별 정보 없이
              보관됩니다.
            </li>
          </ul>
        )}
      </CardContent>
      <CardFooter>
        <Button
          type="button"
          variant="destructive"
          disabled={blocked}
          onClick={() => setOpen(true)}
        >
          회원 탈퇴 진행
        </Button>
      </CardFooter>

      <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay
            className={cn(
              "fixed inset-0 z-50 bg-black/40 backdrop-blur-sm",
              "data-[state=open]:animate-in data-[state=open]:fade-in-0",
              "data-[state=closed]:animate-out data-[state=closed]:fade-out-0",
            )}
          />
          <DialogPrimitive.Content
            className={cn(
              "fixed left-1/2 top-1/2 z-50 w-[92vw] max-w-md -translate-x-1/2 -translate-y-1/2",
              "rounded-xl border bg-card p-5 shadow-soft-lg",
              "data-[state=open]:animate-fade-in",
              "focus:outline-none",
            )}
          >
            <div className="flex items-start gap-3">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-destructive/10 text-destructive">
                <AlertTriangle className="size-5" aria-hidden />
              </span>
              <div className="flex-1">
                <DialogPrimitive.Title className="text-base font-semibold">
                  정말로 탈퇴할까요?
                </DialogPrimitive.Title>
                <DialogPrimitive.Description className="mt-1 text-sm text-muted-foreground">
                  본인 확인을 위해 이메일을 다시 입력해 주세요.
                </DialogPrimitive.Description>
              </div>
              <DialogPrimitive.Close
                aria-label="닫기"
                className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <X className="size-4" />
              </DialogPrimitive.Close>
            </div>

            <form className="mt-5 flex flex-col gap-4" onSubmit={onSubmit}>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="confirm-email" className="text-sm font-medium">
                  이메일 ({email || "이메일 없음"})
                </label>
                <Input
                  id="confirm-email"
                  type="email"
                  inputMode="email"
                  autoComplete="off"
                  placeholder={email || "you@example.com"}
                  value={confirmEmail}
                  onChange={(e) => setConfirmEmail(e.target.value)}
                  required
                  disabled={busy}
                />
                {confirmEmail && !emailMatches ? (
                  <p className="text-xs text-destructive">
                    이메일이 일치하지 않습니다.
                  </p>
                ) : null}
              </div>

              <div className="flex flex-col gap-1.5">
                <label htmlFor="confirm-text" className="text-sm font-medium">
                  의도 확인 — <span className="font-bold text-destructive">{CONFIRM_PHRASE}</span> 을(를) 정확히 입력하세요
                </label>
                <Input
                  id="confirm-text"
                  type="text"
                  autoComplete="off"
                  placeholder={CONFIRM_PHRASE}
                  value={confirmText}
                  onChange={(e) => setConfirmText(e.target.value)}
                  required
                  disabled={busy}
                  aria-describedby="confirm-text-help"
                />
                {confirmText && !textMatches ? (
                  <p id="confirm-text-help" className="text-xs text-destructive">
                    문구가 정확히 일치하지 않습니다. ('{CONFIRM_PHRASE}')
                  </p>
                ) : null}
              </div>

              <div className="flex flex-col gap-1.5">
                <label htmlFor="reason" className="text-sm font-medium">
                  탈퇴 사유 (선택)
                </label>
                <select
                  id="reason"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  disabled={busy}
                  className={cn(
                    "h-11 rounded-md border border-input bg-background px-3 text-sm",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  )}
                >
                  {REASONS.map((r) => (
                    <option key={r.value} value={r.value}>
                      {r.label}
                    </option>
                  ))}
                </select>
                {reason === "other" ? (
                  <textarea
                    rows={3}
                    maxLength={500}
                    value={reasonText}
                    onChange={(e) => setReasonText(e.target.value)}
                    disabled={busy}
                    placeholder="사유를 자유롭게 입력해 주세요 (최대 500자)"
                    className={cn(
                      "mt-1 rounded-md border border-input bg-background px-3 py-2 text-sm",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    )}
                  />
                ) : null}
              </div>

              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  className="mt-0.5 size-4 cursor-pointer rounded border-input"
                  checked={agreed}
                  onChange={(e) => setAgreed(e.target.checked)}
                  disabled={busy}
                />
                <span className="text-muted-foreground">
                  탈퇴 시 프로필이 익명화되며, 주문 내역은 전자상거래법에 따라
                  5년간 보존된다는 점에 동의합니다.
                </span>
              </label>

              <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setOpen(false)}
                  disabled={busy}
                >
                  취소
                </Button>
                <Button
                  type="submit"
                  variant="destructive"
                  disabled={!canSubmit}
                >
                  {busy ? (
                    <>
                      <Loader2 className="animate-spin" /> 처리 중…
                    </>
                  ) : (
                    "탈퇴하기"
                  )}
                </Button>
              </div>
            </form>
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
    </Card>
  );
}

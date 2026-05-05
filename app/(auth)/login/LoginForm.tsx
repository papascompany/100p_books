"use client";

import { Loader2, Mail } from "lucide-react";
import { useSearchParams } from "next/navigation";
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
import { getBrowserSupabase } from "@/lib/db/browser";
import { cn } from "@/lib/utils";

type Status =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "sent"; email: string }
  | { kind: "error"; message: string };

function sanitizeNext(next: string | null): string {
  if (!next) return "/";
  // 오픈 리다이렉트 방지 — 내부 경로만 허용
  if (next.startsWith("/") && !next.startsWith("//")) return next;
  return "/";
}

export default function LoginForm() {
  const searchParams = useSearchParams();
  const next = sanitizeNext(searchParams.get("next"));
  const errorParam = searchParams.get("error");

  const [email, setEmail] = React.useState("");
  const [status, setStatus] = React.useState<Status>(
    errorParam ? { kind: "error", message: errorParam } : { kind: "idle" },
  );

  const isSubmitting = status.kind === "submitting";
  const isSent = status.kind === "sent";

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (isSubmitting) return;

    const trimmed = email.trim();
    if (!trimmed) {
      setStatus({ kind: "error", message: "이메일을 입력해주세요." });
      return;
    }

    setStatus({ kind: "submitting" });

    try {
      const supabase = getBrowserSupabase();
      const origin = window.location.origin;
      const redirectTo = `${origin}/api/auth/callback?next=${encodeURIComponent(next)}`;

      const { error } = await supabase.auth.signInWithOtp({
        email: trimmed,
        options: {
          emailRedirectTo: redirectTo,
        },
      });

      if (error) {
        setStatus({
          kind: "error",
          message: error.message || "로그인 메일 전송에 실패했습니다.",
        });
        return;
      }

      setStatus({ kind: "sent", email: trimmed });
    } catch (err) {
      setStatus({
        kind: "error",
        message:
          err instanceof Error ? err.message : "알 수 없는 오류가 발생했습니다.",
      });
    }
  }

  return (
    <Card className="w-full max-w-md shadow-soft-lg">
      <CardHeader className="text-center">
        <CardTitle className="font-display text-3xl font-semibold tracking-tight">
          다시 만나 반가워요
        </CardTitle>
        <CardDescription className="mt-2 text-[15px]">
          이메일로 매직링크를 보내드릴게요. 비밀번호가 필요 없어요.
        </CardDescription>
      </CardHeader>

      <CardContent>
        {isSent ? (
          <div
            role="status"
            aria-live="polite"
            className="rounded-lg border bg-accent/50 p-5 text-center"
          >
            <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-background shadow-soft">
              <Mail className="size-6 text-rose-500" aria-hidden />
            </div>
            <p className="mt-3 text-base font-medium">이메일을 확인해주세요</p>
            <p className="mt-1 text-sm text-muted-foreground">
              <span className="font-medium text-foreground">
                {status.email}
              </span>
              로 로그인 링크를 보냈어요. 메일이 보이지 않는다면 스팸함을
              확인해주세요.
            </p>
            <button
              type="button"
              onClick={() => setStatus({ kind: "idle" })}
              className="mt-4 text-sm font-medium text-rose-600 underline-offset-4 hover:underline"
            >
              다른 이메일로 다시 보내기
            </button>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
            <div className="flex flex-col gap-1.5">
              <label
                htmlFor="email"
                className="text-sm font-medium text-foreground"
              >
                이메일
              </label>
              <Input
                id="email"
                type="email"
                inputMode="email"
                autoComplete="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                disabled={isSubmitting}
                aria-invalid={status.kind === "error"}
              />
            </div>

            {status.kind === "error" ? (
              <p
                role="alert"
                className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
              >
                {status.message}
              </p>
            ) : null}

            <Button
              type="submit"
              size="lg"
              variant="gradient"
              className={cn("mt-1 w-full", isSubmitting && "opacity-90")}
              disabled={isSubmitting}
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="animate-spin" aria-hidden /> 전송 중...
                </>
              ) : (
                <>
                  <Mail aria-hidden /> 로그인 링크 받기
                </>
              )}
            </Button>
          </form>
        )}

        {/* 카카오 OAuth — 공급자 등록 후 활성화 */}
        {/*
        <div className="relative my-5">
          <div className="absolute inset-0 flex items-center">
            <span className="w-full border-t" />
          </div>
          <div className="relative flex justify-center text-xs uppercase tracking-wide">
            <span className="bg-card px-2 text-muted-foreground">또는</span>
          </div>
        </div>
        <Button
          type="button"
          variant="outline"
          size="lg"
          className="w-full bg-[#FEE500] text-black hover:bg-[#FEE500]/90 border-transparent"
          onClick={async () => {
            const supabase = getBrowserSupabase();
            await supabase.auth.signInWithOAuth({
              provider: "kakao",
              options: { redirectTo: `${window.location.origin}/api/auth/callback?next=${encodeURIComponent(next)}` },
            });
          }}
        >
          카카오로 시작하기
        </Button>
        */}
      </CardContent>

      <CardFooter className="justify-center text-xs text-muted-foreground">
        로그인함으로써 서비스 이용약관과 개인정보처리방침에 동의합니다.
      </CardFooter>
    </Card>
  );
}

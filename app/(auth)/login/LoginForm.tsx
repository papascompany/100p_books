"use client";

import { KeyRound, Loader2, Mail } from "lucide-react";
import Link from "next/link";
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
  | { kind: "oauth"; provider: string }
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
  const [password, setPassword] = React.useState("");
  const [usePassword, setUsePassword] = React.useState(false);
  const [agreed, setAgreed] = React.useState(false);
  const [status, setStatus] = React.useState<Status>(
    errorParam ? { kind: "error", message: errorParam } : { kind: "idle" },
  );

  const isSubmitting = status.kind === "submitting" || status.kind === "oauth";
  const isOauth = status.kind === "oauth";
  const isSent = status.kind === "sent";

  async function onKakaoLogin() {
    if (isSubmitting) return;
    if (!agreed) {
      setStatus({
        kind: "error",
        message: "이용약관과 개인정보 처리방침에 동의해주세요.",
      });
      return;
    }
    setStatus({ kind: "oauth", provider: "kakao" });
    try {
      const supabase = getBrowserSupabase();
      const origin = window.location.origin;
      const redirectTo = `${origin}/api/auth/callback?next=${encodeURIComponent(next)}`;
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "kakao",
        options: {
          redirectTo,
          // Kakao 프로필 정보 (닉네임, 프로필 이미지) 요청.
          // 실제 동의 항목은 Kakao Developers 콘솔에서도 활성화되어 있어야 한다.
          scopes: "profile_nickname profile_image",
        },
      });
      if (error) {
        setStatus({
          kind: "error",
          message: error.message || "카카오 로그인에 실패했습니다.",
        });
        return;
      }
      // signInWithOAuth 는 redirect 를 트리거하므로 이후 코드는 실행되지 않음.
    } catch (err) {
      setStatus({
        kind: "error",
        message:
          err instanceof Error
            ? err.message
            : "카카오 로그인 중 오류가 발생했습니다.",
      });
    }
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (isSubmitting) return;

    const trimmed = email.trim();
    if (!trimmed) {
      setStatus({ kind: "error", message: "이메일을 입력해주세요." });
      return;
    }
    if (!agreed) {
      setStatus({
        kind: "error",
        message: "이용약관과 개인정보 처리방침에 동의해주세요.",
      });
      return;
    }
    if (usePassword && !password) {
      setStatus({ kind: "error", message: "비밀번호를 입력해주세요." });
      return;
    }

    setStatus({ kind: "submitting" });

    try {
      const supabase = getBrowserSupabase();

      if (usePassword) {
        // 비밀번호 로그인 (이메일 전송 한도 초과 시 폴백)
        const { error } = await supabase.auth.signInWithPassword({
          email: trimmed,
          password,
        });
        if (error) {
          setStatus({
            kind: "error",
            message: error.message || "로그인에 실패했습니다.",
          });
          return;
        }
        // 세션 쿠키가 설정되면 next 경로로 이동
        window.location.assign(next);
        return;
      }

      const origin = window.location.origin;
      const redirectTo = `${origin}/api/auth/callback?next=${encodeURIComponent(next)}`;
      const { error } = await supabase.auth.signInWithOtp({
        email: trimmed,
        options: { emailRedirectTo: redirectTo },
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
    <Card className="w-full max-w-md rounded-2xl shadow-soft">
      <CardHeader className="text-center">
        <CardTitle className="text-3xl font-semibold tracking-tight">
          다시 만나 반가워요
        </CardTitle>
        <CardDescription className="mt-2 text-[15px]">
          {usePassword
            ? "이메일과 비밀번호로 로그인해주세요."
            : "이메일로 매직링크를 보내드릴게요. 비밀번호가 필요 없어요."}
        </CardDescription>
      </CardHeader>

      <CardContent>
        {isSent ? (
          <div
            role="status"
            aria-live="polite"
            className="rounded-2xl border border-hairline bg-soft-cloud p-5 text-center"
          >
            <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-white border border-hairline">
              <Mail className="size-6 text-ink" aria-hidden />
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
              className="mt-4 text-sm font-medium text-coral underline-offset-4 hover:underline"
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

            {usePassword ? (
              <div className="flex flex-col gap-1.5">
                <label
                  htmlFor="password"
                  className="text-sm font-medium text-foreground"
                >
                  비밀번호
                </label>
                <Input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  disabled={isSubmitting}
                />
              </div>
            ) : null}

            <label className="flex items-start gap-2 text-sm text-muted-foreground">
              <input
                type="checkbox"
                className="mt-0.5 size-4 cursor-pointer rounded border-input"
                checked={agreed}
                onChange={(e) => setAgreed(e.target.checked)}
                disabled={isSubmitting}
                aria-describedby="agree-desc"
                required
              />
              <span id="agree-desc">
                <Link
                  href="/terms"
                  target="_blank"
                  className="font-medium text-foreground underline-offset-2 hover:underline"
                >
                  이용약관
                </Link>{" "}
                및{" "}
                <Link
                  href="/privacy"
                  target="_blank"
                  className="font-medium text-foreground underline-offset-2 hover:underline"
                >
                  개인정보 처리방침
                </Link>
                에 동의합니다. (필수)
              </span>
            </label>

            {status.kind === "error" ? (
              <p
                role="alert"
                className="rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive"
              >
                {status.message}
              </p>
            ) : null}

            <Button
              type="submit"
              size="lg"
              variant="coral"
              className={cn("mt-1 w-full", isSubmitting && "opacity-90")}
              disabled={isSubmitting || !agreed}
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="animate-spin" aria-hidden />
                  {usePassword ? " 로그인 중..." : " 전송 중..."}
                </>
              ) : usePassword ? (
                <>
                  <KeyRound aria-hidden /> 비밀번호로 로그인
                </>
              ) : (
                <>
                  <Mail aria-hidden /> 로그인 링크 받기
                </>
              )}
            </Button>

            <button
              type="button"
              onClick={() => {
                setUsePassword((v) => !v);
                setStatus({ kind: "idle" });
              }}
              className="text-center text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            >
              {usePassword
                ? "← 매직링크로 로그인"
                : "비밀번호로 로그인 (이메일 한도 초과 시)"}
            </button>
          </form>
        )}

        {!isSent ? (
          <>
            <div className="relative my-5" aria-hidden>
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
              onClick={() => void onKakaoLogin()}
              disabled={isSubmitting || !agreed}
              aria-label="카카오로 시작하기"
            >
              {isOauth ? (
                <>
                  <Loader2 className="animate-spin" aria-hidden /> 카카오 연결
                  중...
                </>
              ) : (
                <>
                  {/* 카카오 말풍선 SVG (인라인) */}
                  <svg
                    className="size-4"
                    viewBox="0 0 18 18"
                    fill="currentColor"
                    aria-hidden
                  >
                    <path d="M9 1.5C4.58 1.5 1 4.31 1 7.78c0 2.24 1.49 4.2 3.74 5.32l-.96 3.49c-.07.25.21.45.43.31l4.18-2.77c.2.02.4.03.61.03 4.42 0 8-2.81 8-6.28S13.42 1.5 9 1.5z" />
                  </svg>
                  카카오로 시작하기
                </>
              )}
            </Button>
          </>
        ) : null}
      </CardContent>

      <CardFooter className="justify-center text-xs text-muted-foreground">
        <Link href="/refund" className="hover:text-foreground">
          교환·환불 정책 보기
        </Link>
      </CardFooter>
    </Card>
  );
}

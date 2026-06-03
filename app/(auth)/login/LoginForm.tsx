"use client";

import { KeyRound, Loader2, Mail, UserPlus } from "lucide-react";
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

/** 로그인 폼 모드. */
type Mode = "signin" | "signup" | "forgot";

type Status =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "oauth"; provider: string }
  | { kind: "signup-sent"; email: string } // 가입 확인 메일 발송됨
  | { kind: "reset-sent"; email: string } // 비번 재설정 메일 발송됨
  | { kind: "error"; message: string };

function sanitizeNext(next: string | null): string {
  if (!next) return "/";
  // 오픈 리다이렉트 방지 — 내부 경로만 허용
  if (next.startsWith("/") && !next.startsWith("//")) return next;
  return "/";
}

/** Supabase 에러 메시지를 사용자 친화적으로 변환. */
function friendlyAuthError(message: string, mode: Mode): string {
  const m = message.toLowerCase();
  if (m.includes("invalid login credentials")) {
    return "이메일 또는 비밀번호가 올바르지 않습니다. 비밀번호를 잊으셨다면 아래 비밀번호 찾기를 이용하세요.";
  }
  if (m.includes("email not confirmed")) {
    return "이메일 인증이 완료되지 않았어요. 받은 편지함의 확인 메일을 먼저 클릭해주세요.";
  }
  if (m.includes("user already registered") || m.includes("already registered")) {
    return "이미 가입된 이메일이에요. 로그인하거나 비밀번호 찾기를 이용하세요.";
  }
  if (m.includes("password should be at least")) {
    return "비밀번호는 최소 6자 이상이어야 합니다.";
  }
  if (mode === "signup") return message || "회원가입에 실패했습니다.";
  if (mode === "forgot") return message || "재설정 메일 전송에 실패했습니다.";
  return message || "로그인에 실패했습니다.";
}

export default function LoginForm() {
  const searchParams = useSearchParams();
  const next = sanitizeNext(searchParams.get("next"));
  const errorParam = searchParams.get("error");

  const [mode, setMode] = React.useState<Mode>("signin");
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [agreed, setAgreed] = React.useState(false);
  const [status, setStatus] = React.useState<Status>(
    errorParam ? { kind: "error", message: errorParam } : { kind: "idle" },
  );

  const isSubmitting = status.kind === "submitting" || status.kind === "oauth";
  const isOauth = status.kind === "oauth";
  const isSent = status.kind === "signup-sent" || status.kind === "reset-sent";

  function switchMode(nextMode: Mode) {
    setMode(nextMode);
    setStatus({ kind: "idle" });
    setPassword("");
  }

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
      // signInWithOAuth 는 redirect 를 트리거 → 이후 코드 미실행.
    } catch (err) {
      setStatus({
        kind: "error",
        message:
          err instanceof Error ? err.message : "카카오 로그인 중 오류가 발생했습니다.",
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
    // 가입/로그인은 약관 동의 + 비밀번호 필요. 비번찾기는 이메일만.
    if (mode !== "forgot") {
      if (!agreed) {
        setStatus({
          kind: "error",
          message: "이용약관과 개인정보 처리방침에 동의해주세요.",
        });
        return;
      }
      if (!password) {
        setStatus({ kind: "error", message: "비밀번호를 입력해주세요." });
        return;
      }
      if (mode === "signup" && password.length < 6) {
        setStatus({ kind: "error", message: "비밀번호는 최소 6자 이상이어야 합니다." });
        return;
      }
    }

    setStatus({ kind: "submitting" });

    try {
      const supabase = getBrowserSupabase();
      const origin = window.location.origin;

      // ── 로그인 ──────────────────────────────────────────────
      if (mode === "signin") {
        const { error } = await supabase.auth.signInWithPassword({
          email: trimmed,
          password,
        });
        if (error) {
          setStatus({ kind: "error", message: friendlyAuthError(error.message, mode) });
          return;
        }
        window.location.assign(next);
        return;
      }

      // ── 회원가입 ────────────────────────────────────────────
      if (mode === "signup") {
        // 서버에서 즉시 확인된 계정 생성 (이메일 인증 없이 바로 가입).
        const res = await fetch("/api/auth/signup", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ email: trimmed, password }),
        });
        const json = (await res.json().catch(() => ({}))) as {
          ok?: boolean;
          error?: { message?: string };
        };
        if (!res.ok || !json.ok) {
          setStatus({
            kind: "error",
            message: json.error?.message ?? "회원가입에 실패했습니다.",
          });
          return;
        }
        // 가입 완료 → 바로 로그인하여 세션 발급.
        const { error: signinError } = await supabase.auth.signInWithPassword({
          email: trimmed,
          password,
        });
        if (signinError) {
          // 가입은 됐으나 자동 로그인 실패 → 로그인 화면으로 안내.
          setStatus({
            kind: "error",
            message: "가입은 완료됐어요. 로그인해주세요.",
          });
          return;
        }
        window.location.assign(next);
        return;
      }

      // ── 비밀번호 찾기 ────────────────────────────────────────
      const { error } = await supabase.auth.resetPasswordForEmail(trimmed, {
        redirectTo: `${origin}/api/auth/callback?next=/reset-password`,
      });
      if (error) {
        setStatus({ kind: "error", message: friendlyAuthError(error.message, mode) });
        return;
      }
      setStatus({ kind: "reset-sent", email: trimmed });
    } catch (err) {
      setStatus({
        kind: "error",
        message:
          err instanceof Error ? err.message : "알 수 없는 오류가 발생했습니다.",
      });
    }
  }

  const heading =
    mode === "signin"
      ? "다시 만나 반가워요"
      : mode === "signup"
        ? "100p Books 시작하기"
        : "비밀번호 찾기";
  const subhead =
    mode === "signin"
      ? "이메일과 비밀번호로 로그인해주세요."
      : mode === "signup"
        ? "이메일과 비밀번호로 간편하게 가입하세요."
        : "가입한 이메일로 재설정 링크를 보내드려요.";

  return (
    <Card className="w-full max-w-md rounded-2xl shadow-soft">
      <CardHeader className="text-center">
        <CardTitle className="text-3xl font-semibold tracking-tight">
          {heading}
        </CardTitle>
        <CardDescription className="mt-2 text-[15px]">{subhead}</CardDescription>
      </CardHeader>

      <CardContent>
        {status.kind === "signup-sent" || status.kind === "reset-sent" ? (
          <div
            role="status"
            aria-live="polite"
            className="rounded-2xl border border-hairline bg-soft-cloud p-5 text-center"
          >
            <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-card border border-hairline">
              <Mail className="size-6 text-ink" aria-hidden />
            </div>
            <p className="mt-3 text-base font-medium">이메일을 확인해주세요</p>
            <p className="mt-1 text-sm text-muted-foreground">
              <span className="font-medium text-foreground">{status.email}</span>
              {status.kind === "signup-sent"
                ? " 로 인증 메일을 보냈어요. 메일의 링크를 클릭하면 가입이 완료됩니다."
                : " 로 비밀번호 재설정 링크를 보냈어요. 메일이 보이지 않으면 스팸함을 확인해주세요."}
            </p>
            <button
              type="button"
              onClick={() => switchMode("signin")}
              className="mt-4 text-sm font-medium text-coral underline-offset-4 hover:underline"
            >
              로그인으로 돌아가기
            </button>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="email" className="text-sm font-medium text-foreground">
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

            {mode !== "forgot" ? (
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between">
                  <label
                    htmlFor="password"
                    className="text-sm font-medium text-foreground"
                  >
                    비밀번호
                  </label>
                  {mode === "signin" ? (
                    <button
                      type="button"
                      onClick={() => switchMode("forgot")}
                      className="text-xs text-muted-foreground underline-offset-4 hover:text-coral hover:underline"
                    >
                      비밀번호 찾기
                    </button>
                  ) : null}
                </div>
                <Input
                  id="password"
                  type="password"
                  autoComplete={
                    mode === "signup" ? "new-password" : "current-password"
                  }
                  placeholder={mode === "signup" ? "6자 이상" : undefined}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  disabled={isSubmitting}
                />
              </div>
            ) : null}

            {mode !== "forgot" ? (
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
            ) : null}

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
              disabled={isSubmitting || (mode !== "forgot" && !agreed)}
            >
              {status.kind === "submitting" ? (
                <>
                  <Loader2 className="animate-spin" aria-hidden />
                  {mode === "signin"
                    ? " 로그인 중..."
                    : mode === "signup"
                      ? " 가입 중..."
                      : " 전송 중..."}
                </>
              ) : mode === "signin" ? (
                <>
                  <KeyRound aria-hidden /> 로그인
                </>
              ) : mode === "signup" ? (
                <>
                  <UserPlus aria-hidden /> 회원가입
                </>
              ) : (
                <>
                  <Mail aria-hidden /> 재설정 링크 받기
                </>
              )}
            </Button>

            {/* 모드 전환 */}
            <div className="text-center text-sm text-muted-foreground">
              {mode === "signin" ? (
                <>
                  계정이 없으신가요?{" "}
                  <button
                    type="button"
                    onClick={() => switchMode("signup")}
                    className="font-medium text-coral underline-offset-4 hover:underline"
                  >
                    회원가입
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => switchMode("signin")}
                  className="underline-offset-4 hover:text-foreground hover:underline"
                >
                  ← 로그인으로 돌아가기
                </button>
              )}
            </div>
          </form>
        )}

        {!isSent && mode !== "forgot" ? (
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
                  <Loader2 className="animate-spin" aria-hidden /> 카카오 연결 중...
                </>
              ) : (
                <>
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

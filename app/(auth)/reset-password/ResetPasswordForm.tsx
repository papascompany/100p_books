"use client";

import { CheckCircle2, KeyRound, Loader2 } from "lucide-react";
import Link from "next/link";
import * as React from "react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { getBrowserSupabase } from "@/lib/db/browser";
import { cn } from "@/lib/utils";

/**
 * 비밀번호 재설정 페이지.
 *
 * 흐름:
 *   1. 로그인 화면 "비밀번호 찾기" → resetPasswordForEmail(redirectTo=/api/auth/callback?next=/reset-password)
 *   2. 메일의 링크 클릭 → callback 이 code 교환으로 recovery 세션 생성 → /reset-password 로 이동
 *   3. 이 폼에서 새 비밀번호 입력 → updateUser({ password })
 *
 * 세션이 없으면(직접 접근/만료) 안내 + 재요청 링크.
 */
type Phase =
  | { kind: "checking" }
  | { kind: "ready" }
  | { kind: "no-session" }
  | { kind: "submitting" }
  | { kind: "done" }
  | { kind: "error"; message: string };

export default function ResetPasswordForm() {
  const [phase, setPhase] = React.useState<Phase>({ kind: "checking" });
  const [password, setPassword] = React.useState("");
  const [confirm, setConfirm] = React.useState("");

  // 진입 시 recovery 세션 존재 확인.
  React.useEffect(() => {
    let active = true;
    const supabase = getBrowserSupabase();
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setPhase(data.session ? { kind: "ready" } : { kind: "no-session" });
    });
    // PASSWORD_RECOVERY 이벤트로 세션이 늦게 잡히는 경우 대비.
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (!active) return;
      if (session) setPhase((p) => (p.kind === "no-session" ? { kind: "ready" } : p));
      if (event === "PASSWORD_RECOVERY" && session) setPhase({ kind: "ready" });
    });
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (phase.kind === "submitting") return;

    if (password.length < 6) {
      setPhase({ kind: "error", message: "비밀번호는 최소 6자 이상이어야 합니다." });
      return;
    }
    if (password !== confirm) {
      setPhase({ kind: "error", message: "두 비밀번호가 일치하지 않습니다." });
      return;
    }

    setPhase({ kind: "submitting" });
    try {
      const supabase = getBrowserSupabase();
      const { error } = await supabase.auth.updateUser({ password });
      if (error) {
        setPhase({
          kind: "error",
          message: error.message || "비밀번호 변경에 실패했습니다.",
        });
        return;
      }
      setPhase({ kind: "done" });
    } catch (err) {
      setPhase({
        kind: "error",
        message: err instanceof Error ? err.message : "알 수 없는 오류가 발생했습니다.",
      });
    }
  }

  // 완료
  if (phase.kind === "done") {
    return (
      <Card className="w-full max-w-md rounded-2xl shadow-soft">
        <CardHeader className="text-center">
          <div className="mx-auto mb-2 flex size-12 items-center justify-center rounded-full bg-coral-50 border border-coral-200">
            <CheckCircle2 className="size-6 text-coral" aria-hidden />
          </div>
          <CardTitle className="text-2xl font-semibold tracking-tight">
            비밀번호가 변경됐어요
          </CardTitle>
          <CardDescription className="mt-2">
            새 비밀번호로 로그인할 수 있습니다.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild size="lg" variant="coral" className="w-full">
            <Link href="/login">로그인하러 가기</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  // 세션 확인 중
  if (phase.kind === "checking") {
    return (
      <Card className="w-full max-w-md rounded-2xl shadow-soft">
        <CardContent className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden /> 링크 확인 중...
        </CardContent>
      </Card>
    );
  }

  // 세션 없음(만료/직접 접근)
  if (phase.kind === "no-session") {
    return (
      <Card className="w-full max-w-md rounded-2xl shadow-soft">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl font-semibold tracking-tight">
            링크가 유효하지 않아요
          </CardTitle>
          <CardDescription className="mt-2">
            재설정 링크가 만료되었거나 잘못된 접근입니다. 다시 요청해주세요.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild size="lg" variant="coral" className="w-full">
            <Link href="/login">비밀번호 찾기 다시 하기</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="w-full max-w-md rounded-2xl shadow-soft">
      <CardHeader className="text-center">
        <CardTitle className="text-2xl font-semibold tracking-tight">
          새 비밀번호 설정
        </CardTitle>
        <CardDescription className="mt-2">
          앞으로 사용할 새 비밀번호를 입력하세요.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="new-password" className="text-sm font-medium text-foreground">
              새 비밀번호
            </label>
            <Input
              id="new-password"
              type="password"
              autoComplete="new-password"
              placeholder="6자 이상"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              disabled={phase.kind === "submitting"}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="confirm-password" className="text-sm font-medium text-foreground">
              새 비밀번호 확인
            </label>
            <Input
              id="confirm-password"
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              required
              disabled={phase.kind === "submitting"}
            />
          </div>

          {phase.kind === "error" ? (
            <p
              role="alert"
              className="rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive"
            >
              {phase.message}
            </p>
          ) : null}

          <Button
            type="submit"
            size="lg"
            variant="coral"
            className={cn("mt-1 w-full")}
            disabled={phase.kind === "submitting"}
          >
            {phase.kind === "submitting" ? (
              <>
                <Loader2 className="animate-spin" aria-hidden /> 변경 중...
              </>
            ) : (
              <>
                <KeyRound aria-hidden /> 비밀번호 변경
              </>
            )}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

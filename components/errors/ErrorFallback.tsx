"use client";

import { AlertTriangle, RotateCcw } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * 라우트 세그먼트 `error.tsx` 공용 복구 화면 (GAP-5).
 *
 * - 렌더 예외가 나도 흰 화면 대신 재시도·이동 경로를 준다.
 * - `error.digest` 는 서버 로그와 대조하는 키다. 콘솔에 남기고 화면에도 "오류 코드" 로 보여
 *   CS 문의 때 받아 적을 수 있게 한다(원문 메시지는 화면에 내지 않는다 — 운영 빌드에서
 *   서버 오류 메시지는 어차피 가려지고, 클라이언트 오류 메시지는 내부 구현을 드러낸다).
 * - 에러 추적 SDK 는 아직 없다(벤더 결정 대기). 도입 시 `logRouteError` 한 곳에서 보고하면 된다.
 * - 이벤트 핸들러·비동기 콜백 안의 예외는 React 경계가 잡지 않는다 — 렌더 중 예외 전용.
 */

export type RouteError = Error & { digest?: string };

export interface ErrorFallbackLink {
  href: string;
  label: string;
}

export interface ErrorFallbackProps {
  error: RouteError;
  reset: () => void;
  /** 로그 태그 — 어느 경계에서 잡혔는지 (예: "user", "editor"). */
  scope: string;
  title?: string;
  description?: string;
  /** 주 이동 링크. 기본: 홈. */
  primaryLink?: ErrorFallbackLink;
  /** 보조 이동 링크 — 예: 내 프로젝트, 주문 내역. */
  secondaryLink?: ErrorFallbackLink;
  className?: string;
}

/** 경계에서 잡힌 오류를 남긴다. 추적 SDK 도입 시 여기서 함께 보고한다. */
export function logRouteError(scope: string, error: RouteError): void {
  console.error(
    `[error-boundary:${scope}] digest=${error.digest ?? "none"}`,
    error,
  );
}

export default function ErrorFallback({
  error,
  reset,
  scope,
  title = "화면을 불러오지 못했어요",
  description = "일시적인 문제일 수 있어요. 다시 시도하거나 홈으로 이동해 주세요.",
  primaryLink = { href: "/", label: "홈으로 가기" },
  secondaryLink,
  className,
}: ErrorFallbackProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    logRouteError(scope, error);
  }, [scope, error]);

  const retry = () => {
    // 서버 컴포넌트에서 난 오류는 reset() 만으로는 같은 RSC payload 를 다시 그린다.
    // router.refresh() 로 서버 데이터를 다시 받게 한 뒤 경계를 리셋한다.
    startTransition(() => {
      router.refresh();
      reset();
    });
  };

  return (
    <div
      className={cn(
        "flex flex-1 items-center justify-center px-4 py-16",
        className,
      )}
    >
      <div role="alert" className="w-full max-w-md text-center">
        <AlertTriangle
          aria-hidden
          className="mx-auto size-10 text-coral-700 dark:text-coral-600"
        />
        <h1 className="mt-4 text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
          {title}
        </h1>
        <p className="mt-3 text-mute">{description}</p>
        {error.digest ? (
          <p className="mt-2 text-xs text-mute">
            오류 코드 <span className="font-mono">{error.digest}</span>
          </p>
        ) : null}

        {/* 버튼 높이 h-12(48px) — 44px 터치 타깃 이상 */}
        <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:justify-center">
          <Button
            type="button"
            variant="coral"
            onClick={retry}
            disabled={isPending}
          >
            <RotateCcw aria-hidden />
            {isPending ? "다시 불러오는 중…" : "다시 시도"}
          </Button>
          <Button asChild variant="secondary">
            <Link href={primaryLink.href}>{primaryLink.label}</Link>
          </Button>
          {secondaryLink ? (
            <Button asChild variant="outline">
              <Link href={secondaryLink.href}>{secondaryLink.label}</Link>
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

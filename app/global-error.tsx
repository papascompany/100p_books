"use client";

import "./globals.css";

import { AlertTriangle, RotateCcw } from "lucide-react";
import { useEffect } from "react";

import { logRouteError, type RouteError } from "@/components/errors/ErrorFallback";
import { Button } from "@/components/ui/button";

/**
 * 최후 오류 경계 — 루트 레이아웃(app/layout.tsx) 자체가 렌더에 실패했을 때.
 *
 * 루트 레이아웃을 **대체**하므로 자체 `<html>`/`<body>` 를 그리고, 전역 CSS 도 직접 import 한다.
 * ThemeProvider·폰트·App Router 컨텍스트가 없을 수 있어서:
 *   - 다크 모드는 루트의 THEME_INIT_SCRIPT 와 같은 규칙(localStorage "theme" → 시스템 설정)을
 *     effect 로 다시 적용한다.
 *   - 재시도는 reset() 만 쓰고(useRouter 불가), 홈 이동은 `<a>` 전체 새로고침으로 한다 —
 *     루트가 깨진 상태의 클라이언트 라우터 상태를 이어 쓰지 않기 위함이다.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: RouteError;
  reset: () => void;
}) {
  useEffect(() => {
    logRouteError("global", error);
  }, [error]);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem("theme");
      const dark =
        stored === "dark" ||
        (stored !== "light" &&
          window.matchMedia("(prefers-color-scheme: dark)").matches);
      const root = document.documentElement;
      root.classList.toggle("dark", dark);
      root.style.colorScheme = dark ? "dark" : "light";
    } catch {
      // 저장소 접근 불가(프라이빗 모드 등) — 라이트 토큰 유지.
    }
  }, []);

  return (
    <html lang="ko">
      <body className="min-h-screen bg-background font-sans text-foreground antialiased">
        <main className="flex min-h-screen items-center justify-center bg-canvas px-4 py-16">
          <div role="alert" className="w-full max-w-md text-center">
            <AlertTriangle
              aria-hidden
              className="mx-auto size-10 text-coral-700 dark:text-coral-600"
            />
            <h1 className="mt-4 text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
              서비스에 일시적인 문제가 생겼어요
            </h1>
            <p className="mt-3 text-mute">
              잠시 후 다시 시도해 주세요. 문제가 계속되면 아래 오류 코드와 함께 문의해 주세요.
            </p>
            {error.digest ? (
              <p className="mt-2 text-xs text-mute">
                오류 코드 <span className="font-mono">{error.digest}</span>
              </p>
            ) : null}

            {/* 버튼 높이 h-12(48px) — 44px 터치 타깃 이상 */}
            <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:justify-center">
              <Button type="button" variant="coral" onClick={() => reset()}>
                <RotateCcw aria-hidden />
                다시 시도
              </Button>
              <Button asChild variant="secondary">
                {/* 전체 새로고침 이동 — 깨진 라우터 상태를 버린다 */}
                {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
                <a href="/">홈으로 가기</a>
              </Button>
            </div>
          </div>
        </main>
      </body>
    </html>
  );
}

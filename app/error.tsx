"use client";

import ErrorFallback, { type RouteError } from "@/components/errors/ErrorFallback";

/**
 * 루트 세그먼트 오류 경계 — 더 가까운 error.tsx 가 없는 라우트
 * ((auth)·(legal)·gallery·gift·share)와 하위 레이아웃 자체의 렌더 예외를 잡는다.
 * 루트 레이아웃 안에서 그려지므로 테마·토스트는 살아 있고, 헤더/푸터는 없다.
 * 루트 레이아웃 자체의 예외는 app/global-error.tsx 담당.
 */
export default function RootError({
  error,
  reset,
}: {
  error: RouteError;
  reset: () => void;
}) {
  return (
    <main className="flex flex-1 flex-col bg-canvas">
      <ErrorFallback scope="root" error={error} reset={reset} />
    </main>
  );
}

"use client";

import ErrorFallback, { type RouteError } from "@/components/errors/ErrorFallback";

/**
 * (user) 세그먼트 오류 경계 — 헤더/푸터가 있는 (user) 레이아웃의 `<main>` 안에서 그려진다.
 * editor·cover·order 는 각자 더 구체적인 안내를 가진 error.tsx 가 있다.
 */
export default function UserError({
  error,
  reset,
}: {
  error: RouteError;
  reset: () => void;
}) {
  return (
    <ErrorFallback
      scope="user"
      error={error}
      reset={reset}
      secondaryLink={{ href: "/projects", label: "내 프로젝트" }}
    />
  );
}

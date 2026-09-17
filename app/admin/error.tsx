"use client";

import ErrorFallback, { type RouteError } from "@/components/errors/ErrorFallback";

/**
 * 관리자 세그먼트 오류 경계 — 사이드바가 있는 admin 레이아웃의 `<main>` 안에서 그려진다.
 * 레이아웃 자체(권한 확인) 예외는 app/error.tsx 로 올라간다.
 */
export default function AdminError({
  error,
  reset,
}: {
  error: RouteError;
  reset: () => void;
}) {
  return (
    <ErrorFallback
      scope="admin"
      error={error}
      reset={reset}
      title="관리자 화면을 불러오지 못했어요"
      description="다시 시도해도 반복되면 오류 코드로 Vercel 런타임 로그를 확인해 주세요."
      primaryLink={{ href: "/admin", label: "관리자 홈" }}
      secondaryLink={{ href: "/", label: "사이트 홈" }}
    />
  );
}

"use client";

import ErrorFallback, { type RouteError } from "@/components/errors/ErrorFallback";

/** 표지 에디터 오류 경계 — 저장 여부를 모른 채 이탈하지 않도록 저장 범위를 안내한다. */
export default function CoverError({
  error,
  reset,
}: {
  error: RouteError;
  reset: () => void;
}) {
  return (
    <ErrorFallback
      scope="cover"
      error={error}
      reset={reset}
      title="표지 편집 화면에 문제가 생겼어요"
      description="마지막으로 저장된 표지는 프로젝트에 남아 있어요. 저장 전의 최근 편집은 사라졌을 수 있어요."
      primaryLink={{ href: "/projects", label: "내 프로젝트로" }}
      secondaryLink={{ href: "/", label: "홈으로 가기" }}
    />
  );
}

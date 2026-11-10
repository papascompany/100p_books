"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { isEditorOnlyPath } from "@/lib/layout/chrome";

/**
 * 사이트 크롬(Header·Footer) 게이트.
 *
 * Header·Footer 는 서버 컴포넌트라 layout 에서 렌더한 결과를 children 으로 넘겨받는다.
 * 캔버스 편집 화면(표지·내지 단일 페이지)에서는 렌더하지 않는다 — 판정은 isEditorOnlyPath.
 * usePathname 은 서버 렌더에서도 요청 경로를 돌려주므로 SSR·hydration 결과가 같다.
 */
export default function ChromeGate({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  if (isEditorOnlyPath(pathname)) return null;
  return <>{children}</>;
}

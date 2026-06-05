import Link from "next/link";

import { getSiteContent } from "@/lib/content/get";

import HeaderClient from "./HeaderClient";

/**
 * Modern Casual primary navigation — 코랄 포인트 디자인 시스템.
 * 56px height · white/80 backdrop-blur · 1px hairline bottom
 *
 * ⚡ 성능: cookies() 등 동적 API 를 쓰지 않아 이 헤더(및 layout)가 정적/ISR
 *   가능. 로그인 여부는 HeaderClient 가 클라이언트 세션으로 판단한다.
 *   → 공개 페이지(랜딩 등)가 매 요청 서버 렌더 없이 CDN 으로 즉시 응답.
 */
export default async function Header() {
  const headerContent = await getSiteContent("header");

  return (
    <header className="sticky top-0 z-40 w-full border-b border-hairline bg-card/80 backdrop-blur-md">
      <div className="container flex h-14 items-center justify-between gap-4">
        {/* Logo */}
        <Link
          href="/"
          className="flex items-center gap-1 text-ink"
          aria-label="100p Books 홈"
        >
          <span className="font-display-num text-2xl font-bold leading-none">
            <span>100</span><span className="text-coral">p</span>
          </span>
          <span className="text-base font-semibold tracking-tight">
            {headerContent.brand}
          </span>
        </Link>
        <HeaderClient nav={headerContent.nav} />
      </div>
    </header>
  );
}

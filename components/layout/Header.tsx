import { cookies } from "next/headers";
import Link from "next/link";

import { getSiteContent } from "@/lib/content/get";

import HeaderClient from "./HeaderClient";

/**
 * Modern Casual primary navigation — 코랄 포인트 디자인 시스템.
 * 56px height · white/80 backdrop-blur · 1px hairline bottom
 */
function readIsAuthedFromCookie(): boolean {
  try {
    const cookieStore = cookies();
    const projectRef =
      process.env.NEXT_PUBLIC_SUPABASE_URL?.match(/\/\/([^.]+)/)?.[1] ?? "";
    if (!projectRef) return false;
    const base = `sb-${projectRef}-auth-token`;
    return (
      Boolean(cookieStore.get(base)?.value) ||
      Boolean(cookieStore.get(`${base}.0`)?.value)
    );
  } catch {
    return false;
  }
}

export default async function Header() {
  const isAuthed = readIsAuthedFromCookie();
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
        <HeaderClient isAuthed={isAuthed} nav={headerContent.nav} />
      </div>
    </header>
  );
}

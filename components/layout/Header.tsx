import { cookies } from "next/headers";
import Link from "next/link";

import { cn } from "@/lib/utils";

import HeaderClient from "./HeaderClient";

/**
 * 상단 글로벌 헤더.
 * 인증 여부는 Supabase SSR 쿠키를 직접 읽어 판단 — 네트워크 호출 0회.
 * (미들웨어가 모든 요청에서 쿠키를 최신 상태로 갱신함)
 */
function readIsAuthedFromCookie(): boolean {
  try {
    const cookieStore = cookies();
    const projectRef =
      process.env.NEXT_PUBLIC_SUPABASE_URL?.match(/\/\/([^.]+)/)?.[1] ?? "";
    if (!projectRef) return false;
    // @supabase/ssr 은 토큰을 청크로 나눌 수 있음: -auth-token, -auth-token.0 …
    const base = `sb-${projectRef}-auth-token`;
    return (
      Boolean(cookieStore.get(base)?.value) ||
      Boolean(cookieStore.get(`${base}.0`)?.value)
    );
  } catch {
    return false;
  }
}

export default function Header() {
  const isAuthed = readIsAuthedFromCookie();

  return (
    <header
      className={cn(
        "sticky top-0 z-40 w-full border-b border-border/60",
        "bg-background/70 backdrop-blur supports-[backdrop-filter]:bg-background/60",
      )}
    >
      <div className="container flex h-16 items-center justify-between gap-4">
        <Link
          href="/"
          className="font-display text-2xl font-semibold tracking-tight"
          aria-label="100p Books 홈"
        >
          100p <span className="text-rose-500">Books</span>
        </Link>
        <HeaderClient isAuthed={isAuthed} />
      </div>
    </header>
  );
}

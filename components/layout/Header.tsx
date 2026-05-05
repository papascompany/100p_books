import Link from "next/link";

import { getSession } from "@/lib/auth/session";
import { cn } from "@/lib/utils";

import HeaderClient from "./HeaderClient";

/**
 * 상단 글로벌 헤더.
 * 서버 컴포넌트에서 세션 유무만 판단해 HeaderClient 에 넘긴다.
 */
export default async function Header() {
  let isAuthed = false;
  try {
    const session = await getSession();
    isAuthed = Boolean(session?.user);
  } catch {
    // env 미설정 / 세션 조회 실패 시 비로그인으로 간주
    isAuthed = false;
  }

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

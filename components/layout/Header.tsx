import { cookies } from "next/headers";
import Link from "next/link";

import HeaderClient from "./HeaderClient";

/**
 * Nike-style primary navigation.
 * 56px height · flat white · 1px hairline bottom · no blur
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

export default function Header() {
  const isAuthed = readIsAuthedFromCookie();

  return (
    <header className="sticky top-0 z-40 w-full border-b border-[#cacacb] bg-white">
      <div className="container flex h-14 items-center justify-between gap-4">
        {/* Logo */}
        <Link
          href="/"
          className="font-campaign text-2xl tracking-tight text-[#111111]"
          aria-label="100p Books 홈"
        >
          100P BOOKS
        </Link>
        <HeaderClient isAuthed={isAuthed} />
      </div>
    </header>
  );
}

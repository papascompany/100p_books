"use client";

import { Menu, UserRound, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import * as React from "react";

import ThemeToggle from "@/components/theme/ThemeToggle";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type NavItem = { href: string; label: string };

const NAV: NavItem[] = [
  { href: "/gallery", label: "갤러리" },
  { href: "/attendance", label: "출석체크" },
  { href: "/projects", label: "내 포토북" },
  { href: "/upload", label: "만들기" },
];

export default function HeaderClient({ isAuthed }: { isAuthed: boolean }) {
  const pathname = usePathname();
  const [open, setOpen] = React.useState(false);

  React.useEffect(() => {
    setOpen(false);
  }, [pathname]);

  return (
    <>
      {/* Desktop nav */}
      <nav
        aria-label="주요 네비게이션"
        className="hidden items-center gap-1 md:flex"
      >
        {NAV.map((item) => {
          const active = pathname === item.href || pathname.startsWith(item.href + "/");
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "relative px-3 py-2 text-sm font-medium transition-colors",
                "after:absolute after:bottom-0 after:left-3 after:right-3 after:h-0.5 after:bg-coral after:transition-opacity",
                active
                  ? "text-coral after:opacity-100"
                  : "text-mute hover:text-foreground after:opacity-0",
              )}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>

      {/* Desktop right cluster */}
      <div className="hidden items-center gap-2 md:flex">
        <ThemeToggle />
        {isAuthed ? (
          <Link
            href="/mypage"
            className="flex h-10 w-10 items-center justify-center rounded-full bg-soft-cloud text-ink transition-colors hover:bg-hairline"
            aria-label="내 프로필"
          >
            <UserRound className="size-4" />
          </Link>
        ) : (
          <Button asChild size="sm">
            <Link href="/login">로그인</Link>
          </Button>
        )}
      </div>

      {/* Mobile hamburger */}
      <div className="flex items-center gap-2 md:hidden">
        <button
          type="button"
          aria-label={open ? "메뉴 닫기" : "메뉴 열기"}
          aria-expanded={open}
          aria-controls="mobile-nav"
          onClick={() => setOpen((v) => !v)}
          className="flex h-10 w-10 items-center justify-center rounded-full bg-soft-cloud text-ink transition-colors hover:bg-hairline"
        >
          {open ? <X className="size-5" /> : <Menu className="size-5" />}
        </button>
      </div>

      {/* Mobile drawer */}
      {open ? (
        <div
          id="mobile-nav"
          className="absolute inset-x-0 top-14 z-50 border-b border-hairline bg-card/95 backdrop-blur-md animate-fade-in md:hidden"
        >
          <nav
            aria-label="모바일 네비게이션"
            className="container flex flex-col py-2"
          >
            {NAV.map((item) => {
              const active = pathname === item.href || pathname.startsWith(item.href + "/");
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "px-3 py-4 text-base font-medium border-b border-hairline last:border-0 transition-colors",
                    active
                      ? "text-coral"
                      : "text-mute hover:text-foreground",
                  )}
                >
                  {item.label}
                </Link>
              );
            })}
            <div className="py-4">
              {isAuthed ? (
                <Link
                  href="/mypage"
                  className="flex items-center gap-2 px-3 py-3 text-base font-medium text-ink"
                >
                  <UserRound className="size-4" />
                  내 프로필
                </Link>
              ) : (
                <Button asChild className="w-full">
                  <Link href="/login">로그인</Link>
                </Button>
              )}
            </div>
          </nav>
        </div>
      ) : null}
    </>
  );
}

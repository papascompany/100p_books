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
  { href: "/", label: "홈" },
  { href: "/gallery", label: "갤러리" },
  { href: "/attendance", label: "출석체크" },
  { href: "/projects", label: "내 포토북" },
  { href: "/upload", label: "만들기" },
];

export default function HeaderClient({ isAuthed }: { isAuthed: boolean }) {
  const pathname = usePathname();
  const [open, setOpen] = React.useState(false);

  // 라우트 변경 시 모바일 메뉴 자동 닫힘
  React.useEffect(() => {
    setOpen(false);
  }, [pathname]);

  return (
    <>
      {/* 데스크탑 네비 */}
      <nav
        aria-label="주요 네비게이션"
        className="hidden items-center gap-1 md:flex"
      >
        {NAV.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "rounded-md px-3 py-2 text-sm font-medium transition-colors",
              pathname === item.href
                ? "text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {item.label}
          </Link>
        ))}
      </nav>

      <div className="hidden items-center gap-2 md:flex">
        <ThemeToggle />
        {isAuthed ? (
          <Button asChild variant="ghost" size="icon" aria-label="내 프로필">
            <Link href="/mypage">
              <UserRound />
            </Link>
          </Button>
        ) : (
          <Button asChild variant="outline" size="sm">
            <Link href="/login">로그인</Link>
          </Button>
        )}
      </div>

      {/* 모바일 햄버거 */}
      <div className="flex items-center gap-2 md:hidden">
        <ThemeToggle />
        <Button
          variant="ghost"
          size="icon"
          aria-label={open ? "메뉴 닫기" : "메뉴 열기"}
          aria-expanded={open}
          aria-controls="mobile-nav"
          onClick={() => setOpen((v) => !v)}
        >
          {open ? <X /> : <Menu />}
        </Button>
      </div>

      {/* 모바일 드로어 */}
      {open ? (
        <div
          id="mobile-nav"
          className={cn(
            "absolute inset-x-0 top-16 z-50 border-b border-border/60",
            "bg-background/95 backdrop-blur md:hidden",
            "animate-fade-in",
          )}
        >
          <nav
            aria-label="모바일 네비게이션"
            className="container flex flex-col py-3"
          >
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "rounded-md px-3 py-3 text-base font-medium",
                  pathname === item.href
                    ? "bg-accent text-accent-foreground"
                    : "text-foreground hover:bg-accent/60",
                )}
              >
                {item.label}
              </Link>
            ))}
            <div className="mt-2 border-t border-border/60 pt-3">
              {isAuthed ? (
                <Link
                  href="/mypage"
                  className="flex items-center gap-2 rounded-md px-3 py-3 text-base font-medium hover:bg-accent/60"
                >
                  <UserRound className="size-4" />
                  내 프로필
                </Link>
              ) : (
                <Button asChild className="w-full" size="lg">
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

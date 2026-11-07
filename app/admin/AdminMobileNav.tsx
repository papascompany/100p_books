"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

import { activeNavHref, NAV } from "./AdminSidebar";

/**
 * 모바일(md 미만) 관리자 메뉴 — 사이드바가 `hidden md:flex` 라 모바일에서는 이동 수단이 없었다.
 * 헤더 아래 가로 스크롤 탭. 메뉴 목록·활성 판정은 사이드바와 공유한다.
 */
export default function AdminMobileNav() {
  const pathname = usePathname() ?? "/admin";
  const activeHref = activeNavHref(pathname);

  return (
    <nav aria-label="관리자 메뉴" className="border-b bg-card md:hidden">
      <ul className="flex gap-1 overflow-x-auto px-2 py-1">
        {NAV.map((item) => {
          const active = item.href === activeHref;
          return (
            <li key={item.href} className="shrink-0">
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex min-h-11 items-center whitespace-nowrap rounded-md px-3 text-sm transition-colors",
                  active
                    ? "bg-rose-50 font-medium text-rose-700"
                    : "text-foreground/80 hover:bg-muted hover:text-foreground",
                )}
              >
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

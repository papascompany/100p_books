"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

interface NavItem {
  href: string;
  label: string;
  /** 자식 경로도 active 처리하려면 prefix 매칭. */
  match?: "exact" | "prefix";
}

const NAV: NavItem[] = [
  { href: "/admin", label: "대시보드", match: "exact" },
  { href: "/admin/orders", label: "주문", match: "prefix" },
  { href: "/admin/orders/export", label: "송장 Excel", match: "exact" },
  { href: "/admin/book-sizes", label: "책 사이즈", match: "prefix" },
  { href: "/admin/resources/font", label: "폰트", match: "prefix" },
  { href: "/admin/resources/clipart", label: "클립아트", match: "prefix" },
  { href: "/admin/resources/background", label: "배경", match: "prefix" },
  { href: "/admin/users", label: "사용자", match: "prefix" },
];

export default function AdminSidebar({ email }: { email?: string | null }) {
  const pathname = usePathname() ?? "/admin";

  const isActive = (item: NavItem) => {
    if (item.match === "exact") return pathname === item.href;
    // prefix — /admin/resources/font 등 정확한 prefix 매칭
    return pathname === item.href || pathname.startsWith(item.href + "/");
  };

  return (
    <aside className="hidden border-r bg-card/60 md:flex md:w-60 md:shrink-0 md:flex-col">
      <div className="border-b px-5 py-5">
        <Link
          href="/admin"
          className="font-display text-xl font-semibold tracking-tight"
        >
          100p <span className="text-rose-500">Admin</span>
        </Link>
        {email ? (
          <p className="mt-1 truncate text-xs text-muted-foreground">{email}</p>
        ) : null}
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-4">
        <ul className="space-y-1">
          {NAV.map((item) => (
            <li key={item.href}>
              <Link
                href={item.href}
                className={cn(
                  "block rounded-md px-3 py-2 text-sm transition-colors",
                  isActive(item)
                    ? "bg-rose-50 text-rose-700 font-medium"
                    : "text-foreground/80 hover:bg-muted hover:text-foreground",
                )}
              >
                {item.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      <div className="border-t px-3 py-3">
        <Link
          href="/"
          className="block rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          ← 사용자 페이지로
        </Link>
        <form action="/api/auth/sign-out" method="post">
          <button
            type="submit"
            className="mt-1 block w-full rounded-md px-3 py-2 text-left text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            로그아웃
          </button>
        </form>
      </div>
    </aside>
  );
}

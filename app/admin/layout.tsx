import { redirect } from "next/navigation";

import { getSession, requireAdmin } from "@/lib/auth/session";

import AdminSidebar from "./AdminSidebar";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * 관리자 영역 레이아웃.
 *
 * 미들웨어가 1차 방어 (cookie + role 검증) — 본 레이아웃은 2차 방어.
 * env 미설정 등으로 미들웨어 검증이 스킵된 경우에도 여기서 차단된다.
 */
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  try {
    await requireAdmin();
  } catch {
    redirect("/login?next=/admin");
  }
  const session = await getSession().catch(() => null);

  return (
    <div className="flex min-h-screen flex-col bg-muted/20 md:flex-row">
      <AdminSidebar email={session?.user.email ?? null} />
      <div className="flex min-w-0 flex-1 flex-col">
        {/* 모바일 상단 바 (사이드바 미노출 환경) */}
        <header className="flex items-center justify-between border-b bg-card px-4 py-3 md:hidden">
          <span className="font-display text-lg font-semibold">
            100p <span className="text-rose-500">Admin</span>
          </span>
          <span className="truncate text-xs text-muted-foreground">
            {session?.user.email ?? ""}
          </span>
        </header>
        <main className="flex-1 px-4 py-6 md:px-8 md:py-8">{children}</main>
      </div>
    </div>
  );
}

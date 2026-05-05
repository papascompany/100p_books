import Link from "next/link";

import StatCard from "@/components/admin/StatCard";
import StatusBadge from "@/components/admin/StatusBadge";
import { Button } from "@/components/ui/button";
import { createAdminSupabase } from "@/lib/db/admin";
import type { OrderStatus } from "@/lib/db/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const KRW = new Intl.NumberFormat("ko-KR");
const DT = new Intl.DateTimeFormat("ko-KR", {
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

interface RecentOrder {
  id: string;
  amount: number;
  status: OrderStatus;
  created_at: string;
  paid_at: string | null;
  user_id: string;
  projects: { title: string | null } | null;
  profiles: { email: string | null } | null;
}

export default async function AdminDashboardPage() {
  // RLS 우회 — 집계 쿼리. requireAdmin 은 layout 에서 이미 검사됨.
  const admin = createAdminSupabase();

  const now = new Date();
  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const [
    todayOrdersRes,
    todayPaidRes,
    weekUsersRes,
    inProductionRes,
    recentOrdersRes,
  ] = await Promise.all([
    admin
      .from("orders")
      .select("id", { count: "exact", head: true })
      .gte("created_at", startOfDay.toISOString()),
    admin
      .from("orders")
      .select("amount")
      .gte("paid_at", startOfDay.toISOString())
      .not("paid_at", "is", null),
    admin
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .gte("created_at", sevenDaysAgo.toISOString()),
    admin
      .from("orders")
      .select("id", { count: "exact", head: true })
      .eq("status", "in_production"),
    admin
      .from("orders")
      .select(
        "id, amount, status, created_at, paid_at, user_id, projects(title), profiles(email)",
      )
      .order("created_at", { ascending: false })
      .limit(5),
  ]);

  const todayOrderCount = todayOrdersRes.count ?? 0;
  const todayPaidAmount = (todayPaidRes.data ?? []).reduce(
    (sum, r) => sum + (r.amount ?? 0),
    0,
  );
  const newUserCount = weekUsersRes.count ?? 0;
  const inProductionCount = inProductionRes.count ?? 0;
  const recent = (recentOrdersRes.data ?? []) as unknown as RecentOrder[];

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight md:text-3xl">
            대시보드
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            오늘 {DT.format(now)} 기준
          </p>
        </div>
        <div className="flex gap-2">
          <Button asChild size="sm" variant="outline">
            <Link href="/admin/orders">주문 관리</Link>
          </Button>
          <Button asChild size="sm" variant="gradient">
            <Link href="/admin/orders/export">송장 Excel</Link>
          </Button>
        </div>
      </header>

      <section className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatCard
          tone="rose"
          label="오늘 주문"
          value={todayOrderCount}
          hint="자정 기준"
        />
        <StatCard
          tone="amber"
          label="오늘 결제 금액"
          value={`${KRW.format(todayPaidAmount)}원`}
          hint="paid_at 기준"
        />
        <StatCard
          tone="sky"
          label="신규 가입 (7일)"
          value={newUserCount}
        />
        <StatCard
          tone="violet"
          label="제작 중"
          value={inProductionCount}
          hint="in_production 상태"
        />
      </section>

      <section>
        <div className="mb-2 flex items-baseline justify-between">
          <h2 className="text-base font-semibold">최근 주문 5건</h2>
          <Link
            href="/admin/orders"
            className="text-xs text-rose-600 hover:underline"
          >
            전체 보기 →
          </Link>
        </div>
        <ul className="divide-y rounded-2xl border bg-card shadow-soft">
          {recent.length === 0 ? (
            <li className="px-4 py-6 text-center text-sm text-muted-foreground">
              아직 주문이 없습니다.
            </li>
          ) : (
            recent.map((o) => (
              <li
                key={o.id}
                className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-accent/30"
              >
                <div className="min-w-0">
                  <Link
                    href={`/admin/orders/${o.id}`}
                    className="block truncate text-sm font-medium hover:underline"
                  >
                    {o.projects?.title ?? "Untitled"}
                  </Link>
                  <p className="truncate text-xs text-muted-foreground">
                    {o.profiles?.email ?? "—"} · {DT.format(new Date(o.created_at))}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <StatusBadge status={o.status} />
                  <span className="font-display text-sm font-semibold">
                    {KRW.format(o.amount)}원
                  </span>
                </div>
              </li>
            ))
          )}
        </ul>
      </section>
    </div>
  );
}

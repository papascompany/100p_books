import Link from "next/link";
import { redirect } from "next/navigation";

import ReviewDialog from "@/components/reviews/ReviewDialog";
import { Button } from "@/components/ui/button";
import { requireUser } from "@/lib/auth/session";
import { createServerSupabase } from "@/lib/db/server";
import type { OrderStatus } from "@/lib/db/types";
import { ORDER_STATUS_BADGE, ORDER_STATUS_LABEL } from "@/lib/orders/state";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const KRW = new Intl.NumberFormat("ko-KR");
const DT = new Intl.DateTimeFormat("ko-KR", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

interface OrderRow {
  id: string;
  qty: number;
  amount: number;
  status: OrderStatus;
  created_at: string;
  paid_at: string | null;
  project_id: string;
  projects: {
    id: string;
    title: string | null;
    book_size_id: string;
    book_sizes: { name: string } | null;
  } | null;
}

/** 후기 작성 가능한 주문 상태 */
const REVIEWABLE_STATUSES: OrderStatus[] = ["shipped", "delivered"];

export default async function MyOrdersPage() {
  let user;
  try {
    user = await requireUser();
  } catch {
    redirect(`/login?next=/mypage/orders`);
  }

  const supabase = createServerSupabase();
  const { data, error } = await supabase
    .from("orders")
    .select(
      "id, qty, amount, status, created_at, paid_at, project_id, projects(id, title, book_size_id, book_sizes(name))",
    )
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  // 이미 후기를 작성한 주문 ID 목록 (서버 컴포넌트에서 미리 조회)
  const rows0 = (data ?? []) as unknown as OrderRow[];
  const reviewableIds = rows0
    .filter((o) => REVIEWABLE_STATUSES.includes(o.status))
    .map((o) => o.id);
  let reviewedOrderIds = new Set<string>();
  if (reviewableIds.length > 0) {
    const { data: reviewedRows } = await supabase
      .from("reviews")
      .select("order_id")
      .in("order_id", reviewableIds);
    reviewedOrderIds = new Set((reviewedRows ?? []).map((r) => r.order_id as string));
  }

  if (error) {
    return (
      <div className="container py-10">
        <p className="text-sm text-destructive">
          주문 내역을 불러오지 못했습니다: {error.message}
        </p>
      </div>
    );
  }

  const rows = rows0;

  return (
    <div className="container py-6 md:py-10">
      <header className="mb-6 flex items-baseline justify-between">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight md:text-3xl">
            주문 내역
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            총 {rows.length}건
          </p>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link href="/upload">새 프로젝트</Link>
        </Button>
      </header>

      {rows.length === 0 ? (
        <div className="rounded-2xl border bg-card p-8 text-center">
          <p className="text-sm text-muted-foreground">
            아직 주문 내역이 없습니다.
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {rows.map((o) => (
            <li
              key={o.id}
              className="rounded-2xl border bg-card p-4 sm:p-5"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-xs text-muted-foreground">
                    {DT.format(new Date(o.created_at))}
                  </p>
                  <h2 className="mt-1 truncate font-display text-lg font-semibold">
                    {o.projects?.title ?? "Untitled"}
                  </h2>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {o.projects?.book_sizes?.name ?? "—"} · 수량 {o.qty}권
                  </p>
                </div>
                <span
                  className={
                    "inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium " +
                    ORDER_STATUS_BADGE[o.status]
                  }
                >
                  {ORDER_STATUS_LABEL[o.status]}
                </span>
              </div>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                <span className="font-display text-xl font-semibold tracking-tight">
                  {KRW.format(o.amount)}원
                </span>
                <div className="flex flex-wrap gap-2">
                  {REVIEWABLE_STATUSES.includes(o.status) && !reviewedOrderIds.has(o.id) ? (
                    <ReviewDialog orderId={o.id} />
                  ) : reviewedOrderIds.has(o.id) ? (
                    <span className="inline-flex items-center rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
                      후기 작성 완료
                    </span>
                  ) : null}
                  <Button asChild size="sm" variant="outline">
                    <Link href={`/mypage/orders/${o.id}`}>주문 상세</Link>
                  </Button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

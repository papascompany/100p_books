import OrdersClient from "./OrdersClient";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default function AdminOrdersPage() {
  return (
    <div className="space-y-4">
      <header>
        <h1 className="font-display text-2xl font-semibold tracking-tight md:text-3xl">
          주문
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          상태/기간/검색으로 필터링. 50건씩 페이지네이션.
        </p>
      </header>
      <OrdersClient />
    </div>
  );
}

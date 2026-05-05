"use client";

import Link from "next/link";
import * as React from "react";

import DataTable, { type Column } from "@/components/admin/DataTable";
import StatusBadge from "@/components/admin/StatusBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { OrderStatus } from "@/lib/db/types";
import { ALL_ORDER_STATUSES, ORDER_STATUS_LABEL } from "@/lib/orders/state";

const KRW = new Intl.NumberFormat("ko-KR");
const DT = new Intl.DateTimeFormat("ko-KR", {
  year: "2-digit",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

interface Row {
  id: string;
  qty: number;
  amount: number;
  status: OrderStatus;
  created_at: string;
  paid_at: string | null;
  project_id: string;
  projects: {
    title: string | null;
    book_sizes: { name: string } | null;
  } | null;
  profiles: { email: string | null } | null;
}

interface ListResponse {
  ok: true;
  data: { items: Row[]; total: number; page: number; pageSize: number };
}

const PAGE_SIZE = 50;

export default function OrdersClient() {
  const [status, setStatus] = React.useState<OrderStatus | "">("");
  const [q, setQ] = React.useState("");
  const [from, setFrom] = React.useState("");
  const [to, setTo] = React.useState("");
  const [page, setPage] = React.useState(1);

  const [items, setItems] = React.useState<Row[]>([]);
  const [total, setTotal] = React.useState(0);
  const [loading, setLoading] = React.useState(false);

  const fetchData = React.useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (status) params.set("status", status);
      if (q.trim()) params.set("q", q.trim());
      if (from) params.set("from", new Date(from).toISOString());
      if (to) {
        // to 는 그 날 23:59 까지 포함
        const toDate = new Date(to);
        toDate.setHours(23, 59, 59, 999);
        params.set("to", toDate.toISOString());
      }
      params.set("page", String(page));
      params.set("pageSize", String(PAGE_SIZE));

      const r = await fetch(`/api/admin/orders?${params.toString()}`, {
        cache: "no-store",
      });
      const j = (await r.json()) as ListResponse | { ok: false };
      if (!j || j.ok !== true) {
        setItems([]);
        setTotal(0);
        return;
      }
      setItems(j.data.items);
      setTotal(j.data.total);
    } finally {
      setLoading(false);
    }
  }, [status, q, from, to, page]);

  React.useEffect(() => {
    fetchData();
  }, [fetchData]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const columns: Column<Row>[] = [
    {
      key: "created_at",
      header: "주문일",
      cell: (r) => DT.format(new Date(r.created_at)),
      className: "whitespace-nowrap text-xs",
    },
    {
      key: "id",
      header: "주문번호",
      cell: (r) => (
        <Link
          href={`/admin/orders/${r.id}`}
          className="font-mono text-xs text-rose-600 hover:underline"
        >
          {r.id.slice(0, 8)}…
        </Link>
      ),
    },
    {
      key: "profiles",
      header: "사용자",
      cell: (r) => (
        <span className="text-xs text-muted-foreground">
          {r.profiles?.email ?? "—"}
        </span>
      ),
    },
    {
      key: "projects",
      header: "프로젝트",
      cell: (r) => (
        <div className="min-w-0">
          <div className="truncate text-sm font-medium">
            {r.projects?.title ?? "Untitled"}
          </div>
          <div className="text-xs text-muted-foreground">
            {r.projects?.book_sizes?.name ?? "—"} · {r.qty}권
          </div>
        </div>
      ),
    },
    {
      key: "amount",
      header: "금액",
      cell: (r) => (
        <span className="font-display font-semibold">
          {KRW.format(r.amount)}원
        </span>
      ),
      className: "whitespace-nowrap",
    },
    {
      key: "status",
      header: "상태",
      cell: (r) => <StatusBadge status={r.status} />,
    },
    {
      key: "actions",
      header: "",
      className: "text-right",
      cell: (r) => (
        <Button asChild size="sm" variant="outline">
          <Link href={`/admin/orders/${r.id}`}>상세</Link>
        </Button>
      ),
    },
  ];

  return (
    <div className="space-y-3">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setPage(1);
          fetchData();
        }}
        className="flex flex-wrap items-end gap-2 rounded-2xl border bg-card p-3 shadow-soft"
      >
        <label className="block">
          <span className="block text-[11px] font-medium text-muted-foreground">
            상태
          </span>
          <select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value as OrderStatus | "");
              setPage(1);
            }}
            className="mt-1 h-10 rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="">전체</option>
            {ALL_ORDER_STATUSES.map((s) => (
              <option key={s} value={s}>
                {ORDER_STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="block text-[11px] font-medium text-muted-foreground">
            From
          </span>
          <Input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="h-10 w-40"
          />
        </label>
        <label className="block">
          <span className="block text-[11px] font-medium text-muted-foreground">
            To
          </span>
          <Input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="h-10 w-40"
          />
        </label>
        <label className="block flex-1 min-w-[200px]">
          <span className="block text-[11px] font-medium text-muted-foreground">
            검색 (이메일/주문번호 prefix)
          </span>
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="user@example.com 또는 abc12345"
            className="h-10"
          />
        </label>
        <Button type="submit" variant="default" disabled={loading}>
          {loading ? "조회…" : "검색"}
        </Button>
      </form>

      <DataTable
        columns={columns}
        rows={items}
        rowKey={(r) => r.id}
        empty={loading ? "불러오는 중…" : "조건에 맞는 주문이 없습니다."}
      />

      <div className="flex items-center justify-between text-sm">
        <span className="text-xs text-muted-foreground">
          총 {KRW.format(total)}건 · {page} / {totalPages}
        </span>
        <div className="flex gap-1">
          <Button
            size="sm"
            variant="outline"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1 || loading}
          >
            이전
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages || loading}
          >
            다음
          </Button>
        </div>
      </div>
    </div>
  );
}

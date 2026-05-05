"use client";

import * as React from "react";

import DataTable, { type Column } from "@/components/admin/DataTable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const DT = new Intl.DateTimeFormat("ko-KR", {
  year: "2-digit",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

interface Row {
  id: string;
  actor_id: string | null;
  actor_email: string | null;
  action: string;
  target_type: string;
  target_id: string | null;
  details: Record<string, unknown> | null;
  ip_address: string | null;
  user_agent: string | null;
  created_at: string;
}

const PAGE_SIZE = 50;

export default function AuditClient() {
  const [actor, setActor] = React.useState("");
  const [action, setAction] = React.useState("");
  const [targetType, setTargetType] = React.useState("");
  const [from, setFrom] = React.useState("");
  const [to, setTo] = React.useState("");
  const [page, setPage] = React.useState(1);

  const [items, setItems] = React.useState<Row[]>([]);
  const [total, setTotal] = React.useState(0);
  const [loading, setLoading] = React.useState(false);

  const [open, setOpen] = React.useState<Row | null>(null);

  const fetchData = React.useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (actor) params.set("actor", actor);
      if (action) params.set("action", action);
      if (targetType) params.set("targetType", targetType);
      if (from) params.set("from", new Date(from).toISOString());
      if (to) {
        const toDate = new Date(to);
        toDate.setHours(23, 59, 59, 999);
        params.set("to", toDate.toISOString());
      }
      params.set("page", String(page));
      params.set("pageSize", String(PAGE_SIZE));

      const r = await fetch(`/api/admin/audit?${params.toString()}`, {
        cache: "no-store",
      });
      const j = (await r.json()) as
        | { ok: true; data: { items: Row[]; total: number } }
        | { ok: false };
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
  }, [actor, action, targetType, from, to, page]);

  React.useEffect(() => {
    fetchData();
  }, [fetchData]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const columns: Column<Row>[] = [
    {
      key: "created_at",
      header: "시각",
      cell: (r) => DT.format(new Date(r.created_at)),
      className: "whitespace-nowrap text-xs",
    },
    {
      key: "actor_email",
      header: "actor",
      cell: (r) => (
        <span className="text-xs">{r.actor_email ?? "—"}</span>
      ),
    },
    {
      key: "action",
      header: "action",
      cell: (r) => (
        <span className="font-mono text-xs text-rose-600">{r.action}</span>
      ),
    },
    {
      key: "target_type",
      header: "target",
      cell: (r) => (
        <span className="text-xs">
          {r.target_type}
          {r.target_id ? (
            <span className="ml-1 font-mono text-[10px] text-muted-foreground">
              {r.target_id.slice(0, 8)}…
            </span>
          ) : null}
        </span>
      ),
    },
    {
      key: "details",
      header: "details",
      cell: (r) => {
        const d = r.details ?? {};
        const summary =
          Object.keys(d).length === 0
            ? "—"
            : Object.entries(d)
                .slice(0, 3)
                .map(
                  ([k, v]) =>
                    `${k}=${typeof v === "object" ? JSON.stringify(v).slice(0, 30) : String(v).slice(0, 30)}`,
                )
                .join(" · ");
        return (
          <button
            type="button"
            className="block max-w-[260px] truncate text-left text-xs text-muted-foreground hover:text-foreground"
            onClick={() => setOpen(r)}
          >
            {summary}
          </button>
        );
      },
    },
    {
      key: "ip_address",
      header: "IP",
      cell: (r) => (
        <span className="font-mono text-[11px] text-muted-foreground">
          {r.ip_address ?? "—"}
        </span>
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
            actor email
          </span>
          <Input
            value={actor}
            onChange={(e) => setActor(e.target.value)}
            placeholder="user@example.com"
            className="h-10 w-56"
          />
        </label>
        <label className="block">
          <span className="block text-[11px] font-medium text-muted-foreground">
            action
          </span>
          <Input
            value={action}
            onChange={(e) => setAction(e.target.value)}
            placeholder="order.transition"
            className="h-10 w-44"
          />
        </label>
        <label className="block">
          <span className="block text-[11px] font-medium text-muted-foreground">
            target type
          </span>
          <select
            value={targetType}
            onChange={(e) => {
              setTargetType(e.target.value);
              setPage(1);
            }}
            className="mt-1 h-10 rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="">전체</option>
            {[
              "order",
              "resource",
              "user",
              "project",
              "book_size",
            ].map((t) => (
              <option key={t} value={t}>
                {t}
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
        <Button type="submit" variant="default" disabled={loading}>
          {loading ? "조회…" : "검색"}
        </Button>
      </form>

      <DataTable
        columns={columns}
        rows={items}
        rowKey={(r) => r.id}
        empty={loading ? "불러오는 중…" : "조건에 맞는 로그가 없습니다."}
      />

      <div className="flex items-center justify-between text-sm">
        <span className="text-xs text-muted-foreground">
          총 {total}건 · {page} / {totalPages}
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

      {open ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setOpen(null)}
        >
          <div
            className="max-h-[80vh] w-full max-w-2xl overflow-auto rounded-2xl border bg-background p-5 shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="mb-3 text-lg font-semibold">
              {open.action} ·{" "}
              <span className="text-sm text-muted-foreground">
                {open.target_type}
              </span>
            </h2>
            <dl className="space-y-2 text-sm">
              <div>
                <dt className="text-xs text-muted-foreground">시각</dt>
                <dd>{DT.format(new Date(open.created_at))}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">actor</dt>
                <dd>
                  {open.actor_email ?? "—"}
                  {open.actor_id ? (
                    <span className="ml-2 font-mono text-[11px] text-muted-foreground">
                      {open.actor_id}
                    </span>
                  ) : null}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">target</dt>
                <dd>
                  {open.target_type}
                  {open.target_id ? (
                    <span className="ml-2 font-mono text-[11px] text-muted-foreground">
                      {open.target_id}
                    </span>
                  ) : null}
                </dd>
              </div>
              {open.ip_address ? (
                <div>
                  <dt className="text-xs text-muted-foreground">IP</dt>
                  <dd className="font-mono text-xs">{open.ip_address}</dd>
                </div>
              ) : null}
              {open.user_agent ? (
                <div>
                  <dt className="text-xs text-muted-foreground">User-Agent</dt>
                  <dd className="break-all font-mono text-[11px] text-muted-foreground">
                    {open.user_agent}
                  </dd>
                </div>
              ) : null}
              <div>
                <dt className="mb-1 text-xs text-muted-foreground">details</dt>
                <dd>
                  <pre className="overflow-auto rounded-md border bg-muted/30 p-3 font-mono text-[11px]">
                    {JSON.stringify(open.details ?? {}, null, 2)}
                  </pre>
                </dd>
              </div>
            </dl>
            <div className="mt-4 text-right">
              <Button onClick={() => setOpen(null)} variant="outline" size="sm">
                닫기
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

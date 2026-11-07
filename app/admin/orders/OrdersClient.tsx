"use client";

import Link from "next/link";
import * as React from "react";

import DataTable, { type Column } from "@/components/admin/DataTable";
import StatusBadge from "@/components/admin/StatusBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { kstDayEndIso, kstDayStartIso } from "@/lib/date/kst";
import type { OrderStatus } from "@/lib/db/types";
import { ALL_ORDER_STATUSES, ORDER_STATUS_LABEL } from "@/lib/orders/state";

const KRW = new Intl.NumberFormat("ko-KR");
const DT = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul",
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

type ListResponse =
  | { ok: true; data: { items: Row[]; total: number; page: number; pageSize: number } }
  | { ok: false; error?: { code?: string; message?: string } };

const PAGE_SIZE = 50;

export default function OrdersClient() {
  const [status, setStatus] = React.useState<OrderStatus | "">("");
  // 입력값(qInput)과 적용값(q) 분리 — Enter·"검색" 버튼에서만 적용(키 입력마다 요청하지 않음).
  const [qInput, setQInput] = React.useState("");
  const [q, setQ] = React.useState("");
  const [from, setFrom] = React.useState("");
  const [to, setTo] = React.useState("");
  const [page, setPage] = React.useState(1);

  const [items, setItems] = React.useState<Row[]>([]);
  const [total, setTotal] = React.useState(0);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // 조회 본체 — 선행 로딩 표시 없이 응답만 반영한다(effect·핸들러 공용). state 반영은
  // promise 콜백에서만 한다(react-hooks/set-state-in-effect 는 await 경계를 보지 않는다).
  const runFetch = React.useCallback(
    (signal?: AbortSignal) =>
      (async () => {
        const params = new URLSearchParams();
        if (status) params.set("status", status);
        if (q) params.set("q", q);
        // 날짜는 KST 달력 기준 — to 는 그 날 23:59:59.999(KST)까지 포함
        if (from) params.set("from", kstDayStartIso(from));
        if (to) params.set("to", kstDayEndIso(to));
        params.set("page", String(page));
        params.set("pageSize", String(PAGE_SIZE));

        const r = await fetch(`/api/admin/orders?${params.toString()}`, {
          cache: "no-store",
          signal,
        });
        return (await r.json().catch(() => null)) as ListResponse | null;
      })()
        .then((j) => {
          if (signal?.aborted) return;
          if (!j || j.ok !== true) {
            setItems([]);
            setTotal(0);
            setError((j && j.ok === false ? j.error?.message : undefined) ?? "주문 목록 조회 실패");
            return;
          }
          setError(null);
          setItems(j.data.items);
          setTotal(j.data.total);
        })
        .catch(() => {
          if (signal?.aborted) return;
          setItems([]);
          setTotal(0);
          setError("네트워크 오류로 주문 목록을 불러오지 못했습니다.");
        })
        .finally(() => {
          if (!signal?.aborted) setLoading(false);
        }),
    [status, q, from, to, page],
  );

  // 조회 조건이 바뀌면 렌더 중에 로딩 표시를 켠다 — effect 안 동기 setState
  // (react-hooks/set-state-in-effect) 대신 React 권장 '렌더 중 상태 조정' 패턴.
  // 첫 렌더에서도 여기서 켜진다(기존: 마운트 effect 가 켬).
  const queryKey = JSON.stringify([status, q, from, to, page]);
  const [requestedKey, setRequestedKey] = React.useState<string | null>(null);
  if (requestedKey !== queryKey) {
    setRequestedKey(queryKey);
    setLoading(true);
  }

  React.useEffect(() => {
    // 조건이 바뀌면 이전 요청을 취소 — 늦게 온 이전 응답이 최신 결과를 덮지 않게 한다.
    const ac = new AbortController();
    void runFetch(ac.signal);
    return () => ac.abort();
  }, [runFetch]);

  // 이벤트 핸들러용 수동 재조회 — 로딩 표시 후 조회.
  const fetchData = React.useCallback(() => {
    setLoading(true);
    return runFetch();
  }, [runFetch]);

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
          const nextQ = qInput.trim();
          if (nextQ === q && page === 1) {
            void fetchData();
          } else {
            setQ(nextQ);
            setPage(1);
          }
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
            시작일
          </span>
          <Input
            type="date"
            value={from}
            onChange={(e) => {
              setFrom(e.target.value);
              setPage(1);
            }}
            className="h-10 w-40"
          />
        </label>
        <label className="block">
          <span className="block text-[11px] font-medium text-muted-foreground">
            종료일
          </span>
          <Input
            type="date"
            value={to}
            onChange={(e) => {
              setTo(e.target.value);
              setPage(1);
            }}
            className="h-10 w-40"
          />
        </label>
        <label className="block flex-1 min-w-[200px]">
          <span className="block text-[11px] font-medium text-muted-foreground">
            검색 (이메일/주문번호 prefix)
          </span>
          <Input
            value={qInput}
            onChange={(e) => setQInput(e.target.value)}
            placeholder="user@example.com 또는 abc12345"
            className="h-10"
          />
        </label>
        <Button type="submit" variant="default" disabled={loading}>
          {loading ? "조회…" : "검색"}
        </Button>
      </form>

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <DataTable
        columns={columns}
        rows={items}
        rowKey={(r) => r.id}
        empty={
          loading
            ? "불러오는 중…"
            : error
              ? "목록을 불러오지 못했습니다."
              : "조건에 맞는 주문이 없습니다."
        }
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

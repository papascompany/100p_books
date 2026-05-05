"use client";

import Link from "next/link";
import * as React from "react";

import DataTable, { type Column } from "@/components/admin/DataTable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/use-toast";

const DT = new Intl.DateTimeFormat("ko-KR", {
  year: "2-digit",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

type JobStatus = "pending" | "running" | "success" | "failed";

interface Row {
  id: string;
  order_id: string | null;
  project_id: string;
  target: "cover" | "interior" | "all";
  status: JobStatus;
  attempt: number;
  max_attempts: number;
  last_error: string | null;
  created_at: string;
  finished_at: string | null;
  projects: { title: string | null } | null;
  profiles: { email: string | null } | null;
}

const PAGE_SIZE = 50;

const STATUS_LABEL: Record<JobStatus, string> = {
  pending: "대기",
  running: "실행 중",
  success: "성공",
  failed: "실패",
};

const STATUS_TONE: Record<JobStatus, string> = {
  pending: "bg-muted text-muted-foreground",
  running: "bg-amber-100 text-amber-800",
  success: "bg-emerald-100 text-emerald-800",
  failed: "bg-rose-100 text-rose-800",
};

export default function JobsClient() {
  const { toast } = useToast();
  const [status, setStatus] = React.useState<JobStatus | "">("");
  const [from, setFrom] = React.useState("");
  const [to, setTo] = React.useState("");
  const [page, setPage] = React.useState(1);

  const [items, setItems] = React.useState<Row[]>([]);
  const [total, setTotal] = React.useState(0);
  const [loading, setLoading] = React.useState(false);
  const [busyId, setBusyId] = React.useState<string | null>(null);

  const fetchData = React.useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (status) params.set("status", status);
      if (from) params.set("from", new Date(from).toISOString());
      if (to) {
        const toDate = new Date(to);
        toDate.setHours(23, 59, 59, 999);
        params.set("to", toDate.toISOString());
      }
      params.set("page", String(page));
      params.set("pageSize", String(PAGE_SIZE));

      const r = await fetch(`/api/admin/jobs?${params.toString()}`, {
        cache: "no-store",
      });
      const j = (await r.json()) as
        | {
            ok: true;
            data: { items: Row[]; total: number };
          }
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
  }, [status, from, to, page]);

  React.useEffect(() => {
    fetchData();
  }, [fetchData]);

  const retry = async (jobId: string) => {
    if (!confirm("이 빌드 잡을 재시도합니다. 계속하시겠습니까?")) return;
    setBusyId(jobId);
    try {
      const r = await fetch(`/api/admin/jobs`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jobId }),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.ok) {
        toast({
          variant: "destructive",
          title: "재시도 실패",
          description: j?.error?.message ?? "알 수 없는 오류",
        });
        return;
      }
      toast({ variant: "success", title: "재시도 완료" });
      await fetchData();
    } finally {
      setBusyId(null);
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const columns: Column<Row>[] = [
    {
      key: "created_at",
      header: "생성",
      cell: (r) => DT.format(new Date(r.created_at)),
      className: "whitespace-nowrap text-xs",
    },
    {
      key: "order_id",
      header: "주문",
      cell: (r) =>
        r.order_id ? (
          <Link
            href={`/admin/orders/${r.order_id}`}
            className="font-mono text-xs text-rose-600 hover:underline"
          >
            {r.order_id.slice(0, 8)}…
          </Link>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        ),
    },
    {
      key: "projects",
      header: "프로젝트",
      cell: (r) => (
        <div className="min-w-0">
          <div className="truncate text-sm">
            {r.projects?.title ?? "Untitled"}
          </div>
          <div className="text-xs text-muted-foreground">
            {r.profiles?.email ?? "—"}
          </div>
        </div>
      ),
    },
    {
      key: "target",
      header: "타겟",
      cell: (r) => <span className="text-xs uppercase">{r.target}</span>,
    },
    {
      key: "status",
      header: "상태",
      cell: (r) => (
        <span
          className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_TONE[r.status]}`}
        >
          {STATUS_LABEL[r.status]}
        </span>
      ),
    },
    {
      key: "attempt",
      header: "시도",
      cell: (r) => (
        <span className="text-xs text-muted-foreground">
          {r.attempt}/{r.max_attempts}
        </span>
      ),
    },
    {
      key: "last_error",
      header: "최근 에러",
      cell: (r) =>
        r.last_error ? (
          <span
            className="block max-w-[260px] truncate text-xs text-destructive"
            title={r.last_error}
          >
            {r.last_error}
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        ),
    },
    {
      key: "finished_at",
      header: "완료",
      cell: (r) =>
        r.finished_at ? (
          <span className="whitespace-nowrap text-xs text-muted-foreground">
            {DT.format(new Date(r.finished_at))}
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        ),
    },
    {
      key: "id",
      header: "",
      className: "text-right",
      cell: (r) =>
        r.status === "failed" && r.attempt < r.max_attempts ? (
          <Button
            size="sm"
            variant="outline"
            onClick={() => retry(r.id)}
            disabled={busyId === r.id}
            type="button"
          >
            재시도
          </Button>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
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
              setStatus(e.target.value as JobStatus | "");
              setPage(1);
            }}
            className="mt-1 h-10 rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="">전체</option>
            {(["pending", "running", "success", "failed"] as const).map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
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
        empty={loading ? "불러오는 중…" : "조건에 맞는 잡이 없습니다."}
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
    </div>
  );
}

"use client";

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

type EmailJobStatus =
  | "pending"
  | "sending"
  | "sent"
  | "failed"
  | "cancelled";

interface Row {
  id: string;
  template: string;
  to_email: string;
  to_name: string | null;
  subject: string;
  status: EmailJobStatus;
  attempt: number;
  max_attempts: number;
  last_error: string | null;
  related_type: string | null;
  related_id: string | null;
  scheduled_at: string;
  sent_at: string | null;
  created_at: string;
  updated_at: string;
}

const PAGE_SIZE = 50;

const STATUS_LABEL: Record<EmailJobStatus, string> = {
  pending: "대기",
  sending: "발송 중",
  sent: "발송 완료",
  failed: "실패",
  cancelled: "취소됨",
};

const STATUS_TONE: Record<EmailJobStatus, string> = {
  pending: "bg-muted text-muted-foreground",
  sending: "bg-amber-100 text-amber-800",
  sent: "bg-emerald-100 text-emerald-800",
  failed: "bg-rose-100 text-rose-800",
  cancelled: "bg-zinc-200 text-zinc-700",
};

export default function EmailsClient() {
  const { toast } = useToast();
  const [status, setStatus] = React.useState<EmailJobStatus | "">("");
  const [q, setQ] = React.useState("");
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
      if (q) params.set("q", q);
      if (from) params.set("from", new Date(from).toISOString());
      if (to) {
        const toDate = new Date(to);
        toDate.setHours(23, 59, 59, 999);
        params.set("to", toDate.toISOString());
      }
      params.set("page", String(page));
      params.set("pageSize", String(PAGE_SIZE));

      const r = await fetch(`/api/admin/emails?${params.toString()}`, {
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
  }, [status, q, from, to, page]);

  React.useEffect(() => {
    fetchData();
  }, [fetchData]);

  const retry = async (jobId: string) => {
    setBusyId(jobId);
    try {
      const r = await fetch(`/api/admin/emails/${jobId}/retry`, {
        method: "POST",
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
      toast({
        variant: "success",
        title: "다시 큐에 등록했어요",
        description: "다음 워커 사이클에서 발송이 시도돼요.",
      });
      await fetchData();
    } finally {
      setBusyId(null);
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const columns: Column<Row>[] = [
    {
      key: "created_at",
      header: "시각",
      cell: (r) => (
        <span className="whitespace-nowrap text-xs">
          {DT.format(new Date(r.created_at))}
        </span>
      ),
    },
    {
      key: "template",
      header: "템플릿",
      cell: (r) => (
        <span className="font-mono text-xs text-muted-foreground">
          {r.template}
        </span>
      ),
    },
    {
      key: "to_email",
      header: "수신자",
      cell: (r) => (
        <div className="min-w-0">
          <div className="truncate text-sm">{r.to_email}</div>
          {r.to_name ? (
            <div className="truncate text-xs text-muted-foreground">
              {r.to_name}
            </div>
          ) : null}
        </div>
      ),
    },
    {
      key: "subject",
      header: "제목",
      cell: (r) => (
        <span className="block max-w-[280px] truncate text-sm" title={r.subject}>
          {r.subject}
        </span>
      ),
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
            className="block max-w-[280px] truncate text-xs text-destructive"
            title={r.last_error}
          >
            {r.last_error}
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
        r.status === "failed" || r.status === "cancelled" ? (
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
              setStatus(e.target.value as EmailJobStatus | "");
              setPage(1);
            }}
            className="mt-1 h-10 rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="">전체</option>
            {(
              ["pending", "sending", "sent", "failed", "cancelled"] as const
            ).map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="block text-[11px] font-medium text-muted-foreground">
            수신자 검색
          </span>
          <Input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="example@gmail.com"
            className="h-10 w-56"
          />
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

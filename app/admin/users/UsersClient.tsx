"use client";

import * as React from "react";

import DataTable, { type Column } from "@/components/admin/DataTable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Profile, UserRole } from "@/lib/db/types";

const DT = new Intl.DateTimeFormat("ko-KR", {
  year: "2-digit",
  month: "2-digit",
  day: "2-digit",
});

interface ListResponse {
  ok: true;
  data: { items: Profile[]; total: number; page: number; pageSize: number };
}

const PAGE_SIZE = 50;

export default function UsersClient() {
  const [items, setItems] = React.useState<Profile[]>([]);
  const [total, setTotal] = React.useState(0);
  const [q, setQ] = React.useState("");
  const [role, setRole] = React.useState<UserRole | "">("");
  const [page, setPage] = React.useState(1);
  const [busy, setBusy] = React.useState(false);

  const refresh = React.useCallback(async () => {
    setBusy(true);
    try {
      const params = new URLSearchParams();
      if (q.trim()) params.set("q", q.trim());
      if (role) params.set("role", role);
      params.set("page", String(page));
      params.set("pageSize", String(PAGE_SIZE));
      const r = await fetch(`/api/admin/users?${params.toString()}`, {
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
      setBusy(false);
    }
  }, [q, role, page]);

  React.useEffect(() => {
    refresh();
  }, [refresh]);

  const setRoleFor = async (id: string, target: UserRole, currentEmail: string) => {
    if (
      !confirm(
        target === "admin"
          ? `${currentEmail} 을(를) 관리자로 승격하시겠습니까?`
          : `${currentEmail} 의 관리자 권한을 해제하시겠습니까?`,
      )
    ) {
      return;
    }
    const r = await fetch(`/api/admin/users/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ role: target }),
    });
    const j = await r.json().catch(() => null);
    if (!r.ok || !j?.ok) {
      alert(j?.error?.message ?? "변경 실패");
      return;
    }
    refresh();
  };

  const columns: Column<Profile>[] = [
    {
      key: "email",
      header: "이메일",
      cell: (p) => <span className="font-mono text-xs">{p.email ?? "—"}</span>,
    },
    {
      key: "display_name",
      header: "이름",
      cell: (p) => p.display_name ?? "—",
    },
    {
      key: "role",
      header: "역할",
      cell: (p) => (
        <span
          className={
            "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium " +
            (p.role === "admin"
              ? "bg-rose-100 text-rose-800"
              : "bg-zinc-100 text-zinc-700")
          }
        >
          {p.role}
        </span>
      ),
    },
    {
      key: "created_at",
      header: "가입일",
      cell: (p) => DT.format(new Date(p.created_at)),
      className: "whitespace-nowrap text-xs",
    },
    {
      key: "id",
      header: "",
      className: "text-right",
      cell: (p) => (
        <Button
          size="sm"
          variant={p.role === "admin" ? "ghost" : "outline"}
          onClick={() =>
            setRoleFor(p.id, p.role === "admin" ? "user" : "admin", p.email ?? "")
          }
        >
          {p.role === "admin" ? "관리자 해제" : "관리자 승격"}
        </Button>
      ),
    },
  ];

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-3">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setPage(1);
          refresh();
        }}
        className="flex flex-wrap items-end gap-2 rounded-2xl border bg-card p-3 shadow-soft"
      >
        <label className="block">
          <span className="block text-[11px] font-medium text-muted-foreground">
            역할
          </span>
          <select
            value={role}
            onChange={(e) => {
              setRole(e.target.value as UserRole | "");
              setPage(1);
            }}
            className="mt-1 h-10 rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="">전체</option>
            <option value="user">user</option>
            <option value="admin">admin</option>
          </select>
        </label>
        <label className="block flex-1 min-w-[200px]">
          <span className="block text-[11px] font-medium text-muted-foreground">
            이메일 검색
          </span>
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="h-10"
          />
        </label>
        <Button type="submit" disabled={busy}>
          검색
        </Button>
      </form>

      <DataTable
        columns={columns}
        rows={items}
        rowKey={(p) => p.id}
        empty={busy ? "불러오는 중…" : "조건에 맞는 사용자가 없습니다."}
      />

      <div className="flex items-center justify-between text-sm">
        <span className="text-xs text-muted-foreground">
          총 {total}명 · {page} / {totalPages}
        </span>
        <div className="flex gap-1">
          <Button
            size="sm"
            variant="outline"
            disabled={page <= 1 || busy}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            이전
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={page >= totalPages || busy}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
          >
            다음
          </Button>
        </div>
      </div>
    </div>
  );
}

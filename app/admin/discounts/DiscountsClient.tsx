"use client";

import * as React from "react";

import DataTable, { type Column } from "@/components/admin/DataTable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/use-toast";
import type { DiscountCode, DiscountType } from "@/lib/db/types";

// ---------------------------------------------------------------------------
// Formatters
// ---------------------------------------------------------------------------

const KRW = new Intl.NumberFormat("ko-KR");
const DT = new Intl.DateTimeFormat("ko-KR", {
  year: "2-digit",
  month: "2-digit",
  day: "2-digit",
});

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ListResponse {
  ok: true;
  data: { items: DiscountCode[]; total: number; page: number; pageSize: number };
}

interface DiscountUseRow {
  id: string;
  used_at: string;
  user_id: string;
  order_id: string | null;
  profiles?: { email: string | null } | null;
}

const PAGE_SIZE = 50;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function randomCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let result = "";
  for (let i = 0; i < 8; i++) {
    result += chars[Math.floor(Math.random() * chars.length)];
  }
  return result;
}

function discountBadge(row: DiscountCode): React.ReactNode {
  const now = Date.now();
  const expired = row.expires_at
    ? new Date(row.expires_at).getTime() <= now
    : false;

  if (expired) {
    return (
      <span className="inline-flex items-center rounded-full bg-red-100 px-2.5 py-1 text-xs font-medium text-red-800">
        만료
      </span>
    );
  }
  if (row.active) {
    return (
      <span className="inline-flex items-center rounded-full bg-green-100 px-2.5 py-1 text-xs font-medium text-green-800">
        활성
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-full bg-zinc-100 px-2.5 py-1 text-xs font-medium text-zinc-700">
      비활성
    </span>
  );
}

function typeBadge(type: DiscountType): string {
  return type === "percent" ? "%" : "원";
}

// ---------------------------------------------------------------------------
// Create Dialog
// ---------------------------------------------------------------------------

interface CreateDialogProps {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}

function CreateDialog({ open, onClose, onCreated }: CreateDialogProps) {
  const { toast } = useToast();

  const [code, setCode] = React.useState("");
  const [type, setType] = React.useState<DiscountType>("percent");
  const [value, setValue] = React.useState("");
  const [maxUses, setMaxUses] = React.useState("");
  const [expiresAt, setExpiresAt] = React.useState("");
  const [active, setActive] = React.useState(true);
  const [submitting, setSubmitting] = React.useState(false);

  const reset = () => {
    setCode("");
    setType("percent");
    setValue("");
    setMaxUses("");
    setExpiresAt("");
    setActive(true);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsedValue = parseFloat(value);
    if (isNaN(parsedValue) || parsedValue <= 0) {
      toast({ variant: "destructive", title: "값을 올바르게 입력하세요." });
      return;
    }
    if (type === "percent" && parsedValue > 100) {
      toast({ variant: "destructive", title: "퍼센트는 1~100이어야 합니다." });
      return;
    }

    const body: Record<string, unknown> = {
      code: code.trim().toUpperCase(),
      type,
      value: parsedValue,
      active,
    };
    if (maxUses.trim()) body.maxUses = parseInt(maxUses, 10);
    if (expiresAt) body.expiresAt = new Date(expiresAt).toISOString();

    setSubmitting(true);
    try {
      const r = await fetch("/api/admin/discounts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.ok) {
        toast({
          variant: "destructive",
          title: "생성 실패",
          description: j?.error?.message ?? "알 수 없는 오류",
        });
        return;
      }
      toast({ variant: "success", title: "할인 코드가 생성되었습니다." });
      handleClose();
      onCreated();
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) handleClose();
      }}
    >
      <div className="w-full max-w-md rounded-2xl border bg-card shadow-xl">
        <div className="border-b px-6 py-4">
          <h2 className="font-display text-lg font-semibold">할인 코드 생성</h2>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4 px-6 py-5">
          {/* 코드 */}
          <div>
            <label className="block text-[11px] font-medium text-muted-foreground">
              코드
            </label>
            <div className="mt-1 flex gap-2">
              <Input
                value={code}
                onChange={(e) =>
                  setCode(e.target.value.toUpperCase().replace(/\s/g, ""))
                }
                placeholder="예: SUMMER20"
                required
                pattern="[A-Za-z0-9_\-]+"
                className="h-10 flex-1 font-mono"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-10 whitespace-nowrap"
                onClick={() => setCode(randomCode())}
              >
                랜덤 생성
              </Button>
            </div>
          </div>

          {/* 타입 */}
          <div>
            <span className="block text-[11px] font-medium text-muted-foreground">
              타입
            </span>
            <div className="mt-2 flex gap-4">
              {(["percent", "amount"] as const).map((t) => (
                <label key={t} className="flex cursor-pointer items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="type"
                    value={t}
                    checked={type === t}
                    onChange={() => setType(t)}
                    className="accent-rose-500"
                  />
                  {t === "percent" ? "퍼센트 (%)" : "정액 (원)"}
                </label>
              ))}
            </div>
          </div>

          {/* 값 */}
          <div>
            <label className="block text-[11px] font-medium text-muted-foreground">
              값 {type === "percent" ? "(1~100)" : "(최소 1원)"}
            </label>
            <Input
              type="number"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              min={1}
              max={type === "percent" ? 100 : undefined}
              step={type === "amount" ? 1 : undefined}
              required
              className="mt-1 h-10"
            />
          </div>

          {/* 최대 사용 횟수 */}
          <div>
            <label className="block text-[11px] font-medium text-muted-foreground">
              최대 사용 횟수 (빈칸 = 무제한)
            </label>
            <Input
              type="number"
              value={maxUses}
              onChange={(e) => setMaxUses(e.target.value)}
              min={1}
              placeholder="무제한"
              className="mt-1 h-10"
            />
          </div>

          {/* 만료일 */}
          <div>
            <label className="block text-[11px] font-medium text-muted-foreground">
              만료일 (빈칸 = 무기한)
            </label>
            <Input
              type="date"
              value={expiresAt}
              onChange={(e) => setExpiresAt(e.target.value)}
              className="mt-1 h-10"
            />
          </div>

          {/* 활성 여부 */}
          <label className="flex cursor-pointer items-center gap-3 rounded-lg border p-3">
            <input
              type="checkbox"
              checked={active}
              onChange={(e) => setActive(e.target.checked)}
              className="h-4 w-4 accent-rose-500"
            />
            <div>
              <p className="text-sm font-medium">즉시 활성화</p>
              <p className="text-xs text-muted-foreground">
                체크 해제 시 비활성 상태로 저장됩니다.
              </p>
            </div>
          </label>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={handleClose} disabled={submitting}>
              취소
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? "생성 중…" : "생성"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Delete Confirm Dialog
// ---------------------------------------------------------------------------

interface DeleteDialogProps {
  row: DiscountCode | null;
  onClose: () => void;
  onDeleted: () => void;
}

function DeleteDialog({ row, onClose, onDeleted }: DeleteDialogProps) {
  const { toast } = useToast();
  const [force, setForce] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);

  React.useEffect(() => {
    if (!row) setForce(false);
  }, [row]);

  if (!row) return null;

  const hasUses = row.used_count > 0;

  const handleDelete = async () => {
    setSubmitting(true);
    try {
      const url = `/api/admin/discounts/${row.id}${force ? "?force=true" : ""}`;
      const r = await fetch(url, { method: "DELETE" });
      const j = await r.json().catch(() => null);

      if (r.status === 409 && j?.error?.code === "CODE_IN_USE") {
        toast({
          variant: "destructive",
          title: "사용 이력 있음",
          description: "강제 삭제를 체크한 후 다시 시도하세요.",
        });
        return;
      }
      if (!r.ok || !j?.ok) {
        toast({
          variant: "destructive",
          title: "삭제 실패",
          description: j?.error?.message ?? "알 수 없는 오류",
        });
        return;
      }
      toast({ variant: "success", title: "삭제되었습니다." });
      onClose();
      onDeleted();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-sm rounded-2xl border bg-card shadow-xl">
        <div className="border-b px-6 py-4">
          <h2 className="font-display text-lg font-semibold">할인 코드 삭제</h2>
        </div>
        <div className="space-y-4 px-6 py-5">
          <p className="text-sm">
            <span className="font-mono font-semibold">{row.code}</span> 를 삭제하시겠습니까?
          </p>

          {hasUses && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
              <p className="text-xs text-amber-800">
                이 코드는 {row.used_count}회 사용되었습니다.
                사용 이력이 있어 삭제하려면 강제 삭제가 필요합니다.
              </p>
              <label className="mt-2 flex cursor-pointer items-center gap-2 text-sm font-medium text-amber-900">
                <input
                  type="checkbox"
                  checked={force}
                  onChange={(e) => setForce(e.target.checked)}
                  className="h-4 w-4 accent-amber-600"
                />
                강제 삭제 (사용 이력 포함)
              </label>
            </div>
          )}

          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose} disabled={submitting}>
              취소
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={submitting || (hasUses && !force)}
            >
              {submitting ? "삭제 중…" : "삭제"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Uses Modal (사용 내역)
// ---------------------------------------------------------------------------

interface UsesModalProps {
  row: DiscountCode | null;
  onClose: () => void;
}

function UsesModal({ row, onClose }: UsesModalProps) {
  const [uses, setUses] = React.useState<DiscountUseRow[]>([]);
  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => {
    if (!row) { setUses([]); return; }

    setLoading(true);
    // discount_uses 를 직접 API 로 조회하는 전용 엔드포인트가 없으므로
    // 어드민 Supabase 클라이언트가 필요한 서버 라우트를 추가하지 않고
    // 간단히 현재 row 의 used_count 를 활용해 안내 메시지로 대체한다.
    // (별도 엔드포인트 구현 시 여기에서 fetch)
    setLoading(false);
  }, [row]);

  if (!row) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-md rounded-2xl border bg-card shadow-xl">
        <div className="flex items-center justify-between border-b px-6 py-4">
          <h2 className="font-display text-lg font-semibold">
            사용 내역 — <span className="font-mono">{row.code}</span>
          </h2>
          <Button variant="ghost" size="sm" onClick={onClose}>
            닫기
          </Button>
        </div>
        <div className="px-6 py-5">
          {loading ? (
            <p className="text-sm text-muted-foreground">불러오는 중…</p>
          ) : uses.length === 0 ? (
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">
                총 사용 횟수: <span className="font-semibold">{row.used_count}회</span>
              </p>
              {row.used_count > 0 && (
                <p className="text-xs text-muted-foreground">
                  상세 사용 내역은 감사 로그에서 확인할 수 있습니다.
                </p>
              )}
              {row.used_count === 0 && (
                <p className="text-xs text-muted-foreground">아직 사용 내역이 없습니다.</p>
              )}
            </div>
          ) : (
            <ul className="divide-y text-sm">
              {uses.map((u) => (
                <li key={u.id} className="py-2">
                  <span className="font-mono text-xs text-muted-foreground">
                    {u.profiles?.email ?? u.user_id}
                  </span>
                  {u.order_id && (
                    <span className="ml-2 font-mono text-xs text-rose-600">
                      주문 {u.order_id.slice(0, 8)}…
                    </span>
                  )}
                  <span className="ml-auto block text-right text-xs text-muted-foreground">
                    {DT.format(new Date(u.used_at))}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Client
// ---------------------------------------------------------------------------

export default function DiscountsClient() {
  const { toast } = useToast();

  const [items, setItems] = React.useState<DiscountCode[]>([]);
  const [total, setTotal] = React.useState(0);
  const [q, setQ] = React.useState("");
  const [activeFilter, setActiveFilter] = React.useState<"" | "true" | "false">("");
  const [page, setPage] = React.useState(1);
  const [loading, setLoading] = React.useState(false);

  const [createOpen, setCreateOpen] = React.useState(false);
  const [deleteTarget, setDeleteTarget] = React.useState<DiscountCode | null>(null);
  const [usesTarget, setUsesTarget] = React.useState<DiscountCode | null>(null);

  const fetchData = React.useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (q.trim()) params.set("q", q.trim());
      if (activeFilter) params.set("active", activeFilter);
      params.set("page", String(page));
      params.set("pageSize", String(PAGE_SIZE));

      const r = await fetch(`/api/admin/discounts?${params.toString()}`, {
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
  }, [q, activeFilter, page]);

  React.useEffect(() => {
    fetchData();
  }, [fetchData]);

  const toggleActive = async (row: DiscountCode) => {
    const next = !row.active;
    const r = await fetch(`/api/admin/discounts/${row.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ active: next }),
    });
    const j = await r.json().catch(() => null);
    if (!r.ok || !j?.ok) {
      toast({
        variant: "destructive",
        title: "변경 실패",
        description: j?.error?.message ?? "알 수 없는 오류",
      });
      return;
    }
    toast({
      variant: "success",
      title: next ? "활성화되었습니다." : "비활성화되었습니다.",
    });
    fetchData();
  };

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const columns: Column<DiscountCode>[] = [
    {
      key: "code",
      header: "코드",
      cell: (r) => (
        <span className="font-mono text-sm font-semibold tracking-wider">
          {r.code}
        </span>
      ),
    },
    {
      key: "type",
      header: "타입",
      cell: (r) => (
        <span className="text-xs text-muted-foreground">
          {r.type === "percent" ? "퍼센트" : "정액"}
        </span>
      ),
    },
    {
      key: "value",
      header: "값",
      cell: (r) => (
        <span className="font-display font-semibold">
          {r.type === "percent"
            ? `${r.value}%`
            : `${KRW.format(r.value)}${typeBadge(r.type)}`}
        </span>
      ),
      className: "whitespace-nowrap",
    },
    {
      key: "uses",
      header: "사용",
      cell: (r) => (
        <span className="text-sm">
          {r.used_count}
          {r.max_uses !== null ? ` / ${r.max_uses}` : " / ∞"}
        </span>
      ),
      className: "whitespace-nowrap text-center",
      headerClassName: "text-center",
    },
    {
      key: "expires_at",
      header: "만료일",
      cell: (r) =>
        r.expires_at ? (
          <span className="text-xs">{DT.format(new Date(r.expires_at))}</span>
        ) : (
          <span className="text-xs text-muted-foreground">무기한</span>
        ),
      className: "whitespace-nowrap",
    },
    {
      key: "active",
      header: "상태",
      cell: (r) => discountBadge(r),
    },
    {
      key: "created_at",
      header: "생성일",
      cell: (r) => (
        <span className="text-xs text-muted-foreground">
          {DT.format(new Date(r.created_at))}
        </span>
      ),
      className: "whitespace-nowrap",
    },
    {
      key: "actions",
      header: "",
      className: "text-right",
      cell: (r) => (
        <div className="flex items-center justify-end gap-1">
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-xs"
            onClick={() => setUsesTarget(r)}
          >
            내역
          </Button>
          <Button
            size="sm"
            variant={r.active ? "outline" : "default"}
            className="h-7 px-2 text-xs"
            onClick={() => toggleActive(r)}
          >
            {r.active ? "비활성화" : "활성화"}
          </Button>
          <Button
            size="sm"
            variant="destructive"
            className="h-7 px-2 text-xs"
            onClick={() => setDeleteTarget(r)}
          >
            삭제
          </Button>
        </div>
      ),
    },
  ];

  return (
    <>
      <div className="space-y-3">
        {/* 필터 바 */}
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
              value={activeFilter}
              onChange={(e) => {
                setActiveFilter(e.target.value as "" | "true" | "false");
                setPage(1);
              }}
              className="mt-1 h-10 rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="">전체</option>
              <option value="true">활성만</option>
              <option value="false">비활성만</option>
            </select>
          </label>
          <label className="block flex-1 min-w-[200px]">
            <span className="block text-[11px] font-medium text-muted-foreground">
              코드 검색 (prefix)
            </span>
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value.toUpperCase())}
              placeholder="예: SUMMER"
              className="mt-1 h-10 font-mono"
            />
          </label>
          <Button type="submit" variant="default" disabled={loading}>
            {loading ? "조회…" : "검색"}
          </Button>
          <Button
            type="button"
            variant="default"
            className="bg-rose-600 hover:bg-rose-700"
            onClick={() => setCreateOpen(true)}
          >
            코드 생성
          </Button>
        </form>

        {/* 테이블 */}
        <DataTable
          columns={columns}
          rows={items}
          rowKey={(r) => r.id}
          empty={loading ? "불러오는 중…" : "조건에 맞는 할인 코드가 없습니다."}
        />

        {/* 페이지네이션 */}
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

      {/* 생성 다이얼로그 */}
      <CreateDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={() => { setPage(1); fetchData(); }}
      />

      {/* 삭제 확인 다이얼로그 */}
      <DeleteDialog
        row={deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onDeleted={() => fetchData()}
      />

      {/* 사용 내역 모달 */}
      <UsesModal
        row={usesTarget}
        onClose={() => setUsesTarget(null)}
      />
    </>
  );
}

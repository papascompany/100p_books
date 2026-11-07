"use client";

import * as React from "react";

import DataTable, { type Column } from "@/components/admin/DataTable";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/use-toast";
import type {
  AdminAttendanceFillResult,
  AdminAttendanceList,
  AdminAttendanceRow,
} from "@/lib/attendance/admin-types";
import { FillReasonSchema, kstToday } from "@/lib/attendance/perfect-month";

type ListResponse =
  | { ok: true; data: AdminAttendanceList }
  | { ok: false; error?: { code?: string; message?: string } };

type FillResponse =
  | { ok: true; data: AdminAttendanceFillResult }
  | { ok: false; error?: { code?: string; message?: string } };

const PAGE_SIZE = 50;
const REASON_MAX = 200;

/** 이 행에서 `출석 채우기` 로 할 일이 남았는지 (서버도 같은 조건이면 409 NOTHING_TO_FILL). */
function canFill(row: AdminAttendanceRow, list: AdminAttendanceList): boolean {
  if (row.deleted) return false;
  if (!row.perfect) return true;
  // 이미 만근 — 지난 달인데 보너스가 없을 때만(보너스 지급 재시도) 의미가 있다.
  return list.monthStatus === "past" && !row.bonusPaid;
}

export default function AttendanceClient() {
  const { toast } = useToast();
  const currentMonth = React.useMemo(() => kstToday().monthKey, []);
  const [month, setMonth] = React.useState(currentMonth);
  const [qInput, setQInput] = React.useState("");
  const [q, setQ] = React.useState("");
  const [page, setPage] = React.useState(1);
  const [list, setList] = React.useState<AdminAttendanceList | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [target, setTarget] = React.useState<AdminAttendanceRow | null>(null);

  // 조회 본체 — state 반영은 promise 콜백에서만 (react-hooks/set-state-in-effect).
  const runFetch = React.useCallback(
    () =>
      (async () => {
        const params = new URLSearchParams();
        params.set("month", month);
        if (q) params.set("q", q);
        params.set("page", String(page));
        params.set("pageSize", String(PAGE_SIZE));
        const r = await fetch(`/api/admin/attendance?${params.toString()}`, {
          cache: "no-store",
        });
        return (await r.json().catch(() => null)) as ListResponse | null;
      })()
        .then((j) => {
          if (!j || j.ok !== true) {
            setList(null);
            setError(j && j.ok === false ? (j.error?.message ?? "조회 실패") : "조회 실패");
            return;
          }
          setError(null);
          setList(j.data);
        })
        .catch(() => {
          setList(null);
          setError("네트워크 오류");
        })
        .finally(() => {
          setBusy(false);
        }),
    [month, q, page],
  );

  // 조회 조건이 바뀌면 렌더 중에 로딩 표시를 켠다 (UsersClient 와 같은 '렌더 중 상태 조정' 패턴).
  const queryKey = JSON.stringify([month, q, page]);
  const [requestedKey, setRequestedKey] = React.useState<string | null>(null);
  if (requestedKey !== queryKey) {
    setRequestedKey(queryKey);
    setBusy(true);
  }

  React.useEffect(() => {
    void runFetch();
  }, [runFetch]);

  const refresh = React.useCallback(() => {
    setBusy(true);
    return runFetch();
  }, [runFetch]);

  const columns: Column<AdminAttendanceRow>[] = [
    {
      key: "member",
      header: "회원",
      cell: (r) => (
        <div className="min-w-0">
          <div className="truncate font-medium">
            {r.displayName ?? "—"}
            {r.deleted ? (
              <span className="ml-2 rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] text-zinc-600">
                탈퇴
              </span>
            ) : null}
          </div>
          <div className="truncate font-mono text-xs text-muted-foreground">
            {r.email ?? r.userId}
          </div>
        </div>
      ),
    },
    {
      key: "attendedDays",
      header: "출석",
      className: "whitespace-nowrap tabular-nums",
      cell: (r) => (
        <span>
          <span className="font-semibold">{r.attendedDays}</span>
          <span className="text-muted-foreground"> / {r.requiredDays}일</span>
        </span>
      ),
    },
    {
      key: "perfect",
      header: "만근",
      className: "whitespace-nowrap",
      cell: (r) =>
        r.perfect ? (
          <span className="inline-flex rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">
            만근
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">
            {r.requiredDays - r.attendedDays}일 부족
          </span>
        ),
    },
    {
      key: "bonusPaid",
      header: "만근 보너스",
      className: "whitespace-nowrap text-xs",
      cell: (r) =>
        r.bonusPaid ? (
          <span className="font-medium text-emerald-700">지급됨</span>
        ) : list?.monthStatus === "current" ? (
          <span className="text-muted-foreground">다음 달 1일 정산</span>
        ) : (
          <span className="text-muted-foreground">미지급</span>
        ),
    },
    {
      key: "action",
      header: "",
      className: "text-right",
      cell: (r) => (
        <Button
          size="sm"
          variant="outline"
          disabled={!list || !canFill(r, list)}
          onClick={() => setTarget(r)}
        >
          출석 채우기
        </Button>
      ),
    },
  ];

  const total = list?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-3">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setPage(1);
          if (qInput.trim() === q) {
            void refresh();
          } else {
            setQ(qInput.trim());
          }
        }}
        className="flex flex-wrap items-end gap-2 rounded-2xl border bg-card p-3 shadow-soft"
      >
        <label className="block">
          <span className="block text-[11px] font-medium text-muted-foreground">월</span>
          <input
            type="month"
            value={month}
            max={currentMonth}
            onChange={(e) => {
              const v = e.target.value;
              if (/^\d{4}-\d{2}$/.test(v) && v <= currentMonth) {
                setMonth(v);
                setPage(1);
              }
            }}
            className="mt-1 h-10 rounded-md border border-input bg-background px-3 text-sm"
          />
        </label>
        <label className="block min-w-[200px] flex-1">
          <span className="block text-[11px] font-medium text-muted-foreground">
            회원 검색 (이메일·이름 — 비우면 그 달 출석자 전체)
          </span>
          <Input
            value={qInput}
            onChange={(e) => setQInput(e.target.value)}
            maxLength={120}
            className="h-10"
          />
        </label>
        <Button type="submit" disabled={busy}>
          검색
        </Button>
      </form>

      {list ? (
        <p className="text-xs text-muted-foreground">
          {list.monthKey} · 만근 기준 {list.requiredDays}일 ·{" "}
          {list.monthStatus === "current"
            ? `이번 달 (어제까지만 채울 수 있음 — 오늘 ${list.todayKst} 은 회원 본인 출석)`
            : "지난 달 (채워서 만근이 되면 보너스 즉시 지급)"}{" "}
          · {list.mode === "search" ? "검색 결과" : "출석자"} {total.toLocaleString("ko-KR")}명
        </p>
      ) : null}

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <DataTable
        columns={columns}
        rows={list?.items ?? []}
        rowKey={(r) => r.userId}
        empty={busy ? "불러오는 중…" : "조건에 맞는 회원이 없습니다."}
      />

      <div className="flex items-center justify-between text-sm">
        <span className="text-xs text-muted-foreground">
          총 {total.toLocaleString("ko-KR")}명 · {page} / {totalPages}
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

      <FillDialog
        row={target}
        list={list}
        onClose={() => setTarget(null)}
        onDone={(res) => {
          setTarget(null);
          toast({
            variant: res.bonusError ? "destructive" : "success",
            title: `출석 ${res.filledCount}일 채움 (${res.attendedAfter}/${res.requiredDays}일)`,
            description: res.bonusError
              ? `만근 보너스 적립 실패: ${res.bonusError} — 다시 '출석 채우기'를 누르면 보너스만 재시도합니다.`
              : res.bonusPaid
                ? `만근 보너스 +${res.bonusAmount.toLocaleString("ko-KR")}P 지급`
                : res.bonusAlreadyPaid
                  ? "만근 보너스는 이미 지급되어 있습니다."
                  : res.perfect && res.monthStatus === "current"
                    ? "만근 보너스는 다음 달 1일에 정산됩니다."
                    : undefined,
          });
          void refresh();
        }}
      />
    </div>
  );
}

interface FillDialogProps {
  row: AdminAttendanceRow | null;
  list: AdminAttendanceList | null;
  onClose: () => void;
  onDone: (res: AdminAttendanceFillResult) => void;
}

function FillDialog({ row, list, onClose, onDone }: FillDialogProps) {
  const { toast } = useToast();
  const [reason, setReason] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);

  // 다른 회원으로 열리거나 닫히면 사유를 비운다 — 렌더 중 상태 조정 패턴.
  const [prevRow, setPrevRow] = React.useState(row);
  if (prevRow !== row) {
    setPrevRow(row);
    setReason("");
  }

  const check = FillReasonSchema.safeParse(reason);
  const reasonError = reason.length > 0 && !check.success ? check.error.issues[0]?.message : null;

  const submit = async () => {
    if (!row || !list || !check.success) return;
    setSubmitting(true);
    try {
      const r = await fetch("/api/admin/attendance/fill", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId: row.userId, monthKey: list.monthKey, reason: check.data }),
      });
      const j = (await r.json().catch(() => null)) as FillResponse | null;
      if (!r.ok || !j || j.ok !== true) {
        toast({
          variant: "destructive",
          title: "출석 채우기 실패",
          description: (j && j.ok === false ? j.error?.message : undefined) ?? "알 수 없는 오류",
        });
        return;
      }
      onDone(j.data);
    } catch {
      toast({ variant: "destructive", title: "출석 채우기 실패", description: "네트워크 오류" });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open={row !== null}
      onOpenChange={(open) => {
        if (!open && !submitting) onClose();
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>출석 채우기</DialogTitle>
          <DialogDescription>
            {row ? (row.displayName ?? row.email ?? row.userId) : ""} · {list?.monthKey} — 현재{" "}
            {row?.attendedDays ?? 0}/{row?.requiredDays ?? 0}일.{" "}
            {list?.monthStatus === "current"
              ? `어제까지의 미출석일을 채웁니다(오늘 ${list.todayKst} 제외). 만근 보너스는 다음 달 1일에 정산됩니다.`
              : "그 달의 미출석일을 모두 채우고, 만근이 되면 만근 보너스를 바로 지급합니다."}{" "}
            채운 날은 일일 포인트(+100P)가 지급되지 않습니다.
          </DialogDescription>
        </DialogHeader>

        <label className="mt-4 block">
          <span className="block text-sm font-medium">
            사유 <span className="text-destructive">*</span>
          </span>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            maxLength={REASON_MAX + 20}
            placeholder="예: 출석 버튼 장애(11/3)로 출석 누락 — CS 문의 #123"
            aria-invalid={reasonError ? true : undefined}
            className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
          />
          <span className="mt-1 flex justify-between text-xs text-muted-foreground">
            <span className={reasonError ? "text-destructive" : undefined}>
              {reasonError ?? "2~200자, 감사 로그에 기록됩니다."}
            </span>
            <span className="tabular-nums">{reason.trim().length}/{REASON_MAX}</span>
          </span>
        </label>

        <DialogFooter className="mt-5">
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            취소
          </Button>
          <Button onClick={submit} disabled={submitting || !check.success}>
            {submitting ? "처리 중…" : "출석 채우기"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

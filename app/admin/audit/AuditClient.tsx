"use client";

import * as React from "react";

import DataTable, { type Column } from "@/components/admin/DataTable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { kstDayEndIso, kstDayStartIso } from "@/lib/date/kst";

const DT = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul",
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

/** 실제 기록되는 target_type(app/api/admin/** 의 logAdminAction 호출) ↔ 한국어 라벨. */
const TARGET_TYPE_LABEL: Record<string, string> = {
  order: "주문",
  project: "프로젝트",
  user: "사용자",
  resource: "리소스",
  book_size: "책 사이즈",
  discount_code: "할인 코드",
  email_job: "이메일 잡",
};

function targetTypeLabel(t: string): string {
  return TARGET_TYPE_LABEL[t] ?? t;
}

export default function AuditClient() {
  // 텍스트 필터는 입력값과 적용값 분리 — Enter·"검색" 버튼에서만 적용(키 입력마다 요청하지 않음).
  const [actorInput, setActorInput] = React.useState("");
  const [actionInput, setActionInput] = React.useState("");
  const [actor, setActor] = React.useState("");
  const [action, setAction] = React.useState("");
  const [targetType, setTargetType] = React.useState("");
  const [from, setFrom] = React.useState("");
  const [to, setTo] = React.useState("");
  const [page, setPage] = React.useState(1);

  const [items, setItems] = React.useState<Row[]>([]);
  const [total, setTotal] = React.useState(0);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const [open, setOpen] = React.useState<Row | null>(null);

  // 조회 본체 — 선행 로딩 표시 없이 응답만 반영한다(effect·핸들러 공용). state 반영은
  // promise 콜백에서만 한다(react-hooks/set-state-in-effect 는 await 경계를 보지 않는다).
  const runFetch = React.useCallback(
    (signal?: AbortSignal) =>
      (async () => {
        const params = new URLSearchParams();
        if (actor) params.set("actor", actor);
        if (action) params.set("action", action);
        if (targetType) params.set("targetType", targetType);
        // 날짜는 KST 달력 기준 — to 는 그 날 23:59:59.999(KST)까지 포함
        if (from) params.set("from", kstDayStartIso(from));
        if (to) params.set("to", kstDayEndIso(to));
        params.set("page", String(page));
        params.set("pageSize", String(PAGE_SIZE));

        const r = await fetch(`/api/admin/audit?${params.toString()}`, {
          cache: "no-store",
          signal,
        });
        return (await r.json().catch(() => null)) as
          | { ok: true; data: { items: Row[]; total: number } }
          | { ok: false; error?: { code?: string; message?: string } }
          | null;
      })()
        .then((j) => {
          if (signal?.aborted) return;
          if (!j || j.ok !== true) {
            setItems([]);
            setTotal(0);
            setError((j && j.ok === false ? j.error?.message : undefined) ?? "감사 로그 조회 실패");
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
          setError("네트워크 오류로 감사 로그 목록을 불러오지 못했습니다.");
        })
        .finally(() => {
          if (!signal?.aborted) setLoading(false);
        }),
    [actor, action, targetType, from, to, page],
  );

  // 조회 조건이 바뀌면 렌더 중에 로딩 표시를 켠다 — effect 안 동기 setState
  // (react-hooks/set-state-in-effect) 대신 React 권장 '렌더 중 상태 조정' 패턴.
  // 첫 렌더에서도 여기서 켜진다(기존: 마운트 effect 가 켬).
  const queryKey = JSON.stringify([actor, action, targetType, from, to, page]);
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
      header: "시각",
      cell: (r) => DT.format(new Date(r.created_at)),
      className: "whitespace-nowrap text-xs",
    },
    {
      key: "actor_email",
      header: "수행자",
      cell: (r) => (
        <span className="text-xs">{r.actor_email ?? "—"}</span>
      ),
    },
    {
      key: "action",
      header: "작업",
      cell: (r) => (
        <span className="font-mono text-xs text-rose-600">{r.action}</span>
      ),
    },
    {
      key: "target_type",
      header: "대상",
      cell: (r) => (
        <span className="text-xs">
          {targetTypeLabel(r.target_type)}
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
      header: "상세",
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
          const nextActor = actorInput.trim();
          const nextAction = actionInput.trim();
          if (nextActor === actor && nextAction === action && page === 1) {
            void fetchData();
          } else {
            setActor(nextActor);
            setAction(nextAction);
            setPage(1);
          }
        }}
        className="flex flex-wrap items-end gap-2 rounded-2xl border bg-card p-3 shadow-soft"
      >
        <label className="block">
          <span className="block text-[11px] font-medium text-muted-foreground">
            수행자 이메일
          </span>
          <Input
            value={actorInput}
            onChange={(e) => setActorInput(e.target.value)}
            placeholder="user@example.com"
            className="h-10 w-56"
          />
        </label>
        <label className="block">
          <span className="block text-[11px] font-medium text-muted-foreground">
            작업
          </span>
          <Input
            value={actionInput}
            onChange={(e) => setActionInput(e.target.value)}
            placeholder="order.transition"
            className="h-10 w-44"
          />
        </label>
        <label className="block">
          <span className="block text-[11px] font-medium text-muted-foreground">
            대상 유형
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
            {Object.entries(TARGET_TYPE_LABEL).map(([t, label]) => (
              <option key={t} value={t}>
                {label}
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
              : "조건에 맞는 로그가 없습니다."
        }
      />

      <div className="flex items-center justify-between text-sm">
        <span className="text-xs text-muted-foreground">
          총 {total.toLocaleString("ko-KR")}건 · {page} / {totalPages}
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
                {targetTypeLabel(open.target_type)}
              </span>
            </h2>
            <dl className="space-y-2 text-sm">
              <div>
                <dt className="text-xs text-muted-foreground">시각</dt>
                <dd>{DT.format(new Date(open.created_at))}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">수행자</dt>
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
                <dt className="text-xs text-muted-foreground">대상</dt>
                <dd>
                  {targetTypeLabel(open.target_type)}
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
                <dt className="mb-1 text-xs text-muted-foreground">상세</dt>
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

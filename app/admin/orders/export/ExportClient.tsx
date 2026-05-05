"use client";

import * as React from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { OrderStatus } from "@/lib/db/types";
import { ALL_ORDER_STATUSES, ORDER_STATUS_LABEL } from "@/lib/orders/state";

const KRW = new Intl.NumberFormat("ko-KR");

export default function ExportClient() {
  const [status, setStatus] = React.useState<OrderStatus | "">("");
  const [from, setFrom] = React.useState("");
  const [to, setTo] = React.useState("");
  const [count, setCount] = React.useState<number | null>(null);
  const [busy, setBusy] = React.useState(false);

  const buildParams = (extra: Record<string, string> = {}) => {
    const p = new URLSearchParams(extra);
    if (status) p.set("status", status);
    if (from) p.set("from", new Date(from).toISOString());
    if (to) {
      const d = new Date(to);
      d.setHours(23, 59, 59, 999);
      p.set("to", d.toISOString());
    }
    return p;
  };

  const preview = async () => {
    setBusy(true);
    try {
      const r = await fetch(
        `/api/admin/orders/export?${buildParams({ count: "1" }).toString()}`,
        { cache: "no-store" },
      );
      const j = await r.json();
      if (!j?.ok) {
        alert(j?.error?.message ?? "조회 실패");
        return;
      }
      setCount(j.data.count);
    } finally {
      setBusy(false);
    }
  };

  const download = async () => {
    setBusy(true);
    try {
      const r = await fetch(
        `/api/admin/orders/export?${buildParams().toString()}`,
        { cache: "no-store" },
      );
      if (!r.ok) {
        const j = await r.json().catch(() => null);
        alert(j?.error?.message ?? "다운로드 실패");
        return;
      }
      const blob = await r.blob();
      const cd = r.headers.get("Content-Disposition") ?? "";
      const m = /filename="([^"]+)"/.exec(cd);
      const filename = m?.[1] ?? "invoices.xlsx";
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3 rounded-2xl border bg-card p-5 shadow-soft">
      <div className="flex flex-wrap items-end gap-2">
        <label className="block">
          <span className="block text-[11px] font-medium text-muted-foreground">
            상태 (비우면 paid + in_production + shipped)
          </span>
          <select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value as OrderStatus | "");
              setCount(null);
            }}
            className="mt-1 h-10 rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="">기본 (paid + in_production + shipped)</option>
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
            onChange={(e) => {
              setFrom(e.target.value);
              setCount(null);
            }}
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
            onChange={(e) => {
              setTo(e.target.value);
              setCount(null);
            }}
            className="h-10 w-40"
          />
        </label>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={preview} disabled={busy} type="button">
          미리보기
        </Button>
        <Button variant="gradient" onClick={download} disabled={busy} type="button">
          {busy ? "처리 중…" : "Excel 다운로드"}
        </Button>
      </div>

      {count !== null ? (
        <p className="text-sm text-muted-foreground">
          예상 행 수:{" "}
          <span className="font-display font-semibold text-foreground">
            {KRW.format(count)}
          </span>
        </p>
      ) : null}
    </div>
  );
}

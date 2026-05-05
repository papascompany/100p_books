"use client";

import { ArrowLeft, ImageOff, RotateCcw, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/use-toast";
import { cn } from "@/lib/utils";

import type { TrashItem } from "./page";

interface Props {
  items: TrashItem[];
  purgeAfterDays: number;
}

export default function TrashClient({ items, purgeAfterDays }: Props) {
  const router = useRouter();
  const { toast } = useToast();

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  function toggleAll() {
    if (items.every((i) => selected.has(i.id))) {
      setSelected(new Set());
    } else {
      setSelected(new Set(items.map((i) => i.id)));
    }
  }

  function toggleOne(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  }

  async function handleRestore() {
    if (selected.size === 0) return;
    setBusy(true);
    try {
      const res = await fetch("/api/photos/restore", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ photoIds: Array.from(selected) }),
      });
      const json = (await res.json()) as {
        ok: boolean;
        data?: { restored: number; skipped: number; skippedQuota?: number };
        error?: { message?: string };
      };
      if (!res.ok || !json.ok) {
        throw new Error(json.error?.message ?? "복원 실패");
      }
      const restored = json.data?.restored ?? 0;
      const skippedQuota = json.data?.skippedQuota ?? 0;
      toast({
        title: "복원 완료",
        description:
          skippedQuota > 0
            ? `${restored}장 복원, ${skippedQuota}장은 한도(100장) 초과로 제외됐어요.`
            : `${restored}장이 라이브러리로 돌아왔어요.`,
        variant: "success",
      });
      setSelected(new Set());
      router.refresh();
    } catch (e) {
      toast({
        title: "복원 실패",
        description: e instanceof Error ? e.message : "알 수 없는 오류",
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  }

  async function handlePurge() {
    if (selected.size === 0) return;
    if (
      !confirm(
        `선택한 ${selected.size}장을 영구 삭제할까요? 이 작업은 되돌릴 수 없어요.`,
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/photos/purge", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ photoIds: Array.from(selected) }),
      });
      const json = (await res.json()) as {
        ok: boolean;
        data?: { deleted: number };
        error?: { message?: string };
      };
      if (!res.ok || !json.ok) {
        throw new Error(json.error?.message ?? "영구 삭제 실패");
      }
      toast({
        title: "영구 삭제 완료",
        description: `${json.data?.deleted ?? 0}장이 영구 삭제됐어요.`,
        variant: "success",
      });
      setSelected(new Set());
      router.refresh();
    } catch (e) {
      toast({
        title: "삭제 실패",
        description: e instanceof Error ? e.message : "알 수 없는 오류",
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  }

  const allSelected =
    items.length > 0 && items.every((i) => selected.has(i.id));

  return (
    <div className="container mx-auto max-w-6xl px-4 py-8 md:py-10">
      <header>
        <Link
          href="/mypage"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" aria-hidden /> 마이페이지
        </Link>
        <h1 className="mt-1 font-display text-2xl font-semibold tracking-tight sm:text-3xl">
          휴지통
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          삭제한 사진은 {purgeAfterDays}일 후 자동으로 영구 삭제돼요. 그 전에
          복원하거나 직접 영구 삭제할 수 있어요.
        </p>
      </header>

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-md border bg-white/60 p-3 dark:bg-card/40">
        <div className="flex items-center gap-2 text-sm">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={toggleAll}
            disabled={items.length === 0}
          >
            {allSelected ? "선택 해제" : "전체 선택"}
          </Button>
          <span className="text-muted-foreground">
            {selected.size > 0
              ? `${selected.size}장 선택됨`
              : `${items.length}장`}
          </span>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={selected.size === 0 || busy}
            onClick={handleRestore}
          >
            <RotateCcw className="size-4" aria-hidden /> 복원
          </Button>
          <Button
            type="button"
            variant="destructive"
            size="sm"
            disabled={selected.size === 0 || busy}
            onClick={handlePurge}
          >
            <Trash2 className="size-4" aria-hidden /> 영구 삭제
          </Button>
        </div>
      </div>

      {items.length === 0 ? (
        <div className="mt-10 rounded-xl border border-dashed bg-white/40 p-10 text-center text-sm text-muted-foreground dark:bg-card/40">
          휴지통이 비어 있어요.
        </div>
      ) : (
        <ul
          className="mt-4 grid grid-cols-3 gap-2 sm:gap-3 md:grid-cols-4 lg:grid-cols-6"
          aria-label="휴지통 사진 그리드"
        >
          {items.map((p) => {
            const isSelected = selected.has(p.id);
            return (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => toggleOne(p.id)}
                  aria-pressed={isSelected}
                  className={cn(
                    "group relative block w-full overflow-hidden rounded-lg border bg-card text-left shadow-soft transition-all",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                    isSelected
                      ? "border-rose-500 ring-2 ring-rose-400"
                      : "hover:border-foreground/30",
                  )}
                >
                  <div className="relative aspect-square w-full bg-muted">
                    {p.thumbUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={p.thumbUrl}
                        alt={p.filename ?? "사진"}
                        loading="lazy"
                        className="h-full w-full object-cover opacity-70"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-muted-foreground">
                        <ImageOff className="size-6" aria-hidden />
                      </div>
                    )}
                    {isSelected ? (
                      <span className="absolute right-2 top-2 inline-flex size-7 items-center justify-center rounded-full bg-rose-500 text-xs font-semibold text-white shadow">
                        ✓
                      </span>
                    ) : null}
                  </div>
                  <div className="px-2 py-1.5">
                    <p
                      className="truncate text-[11px] font-medium"
                      title={p.filename ?? ""}
                    >
                      {p.filename ?? "(이름 없음)"}
                    </p>
                    <p
                      className="truncate text-[10px] text-muted-foreground"
                      title={p.projectTitle}
                    >
                      {p.projectTitle}
                    </p>
                    <p className="mt-0.5 text-[10px] text-muted-foreground">
                      {p.daysLeft > 0
                        ? `${p.daysLeft}일 후 영구 삭제`
                        : "곧 영구 삭제"}
                    </p>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

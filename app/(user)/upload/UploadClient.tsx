"use client";

import { ArrowRight, CheckSquare, Square, Trash2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

import Dropzone from "./components/Dropzone";
import FileGridItem from "./components/FileGridItem";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/use-toast";
import type { BookSize } from "@/lib/db/types";
import { MAX_PHOTOS_PER_PROJECT } from "@/lib/image/constants";
import { UploadQueue, useUploadStore } from "@/lib/image/upload-queue";
import { cn } from "@/lib/utils";

interface UploadClientProps {
  projectId: string;
  initialTitle: string;
  initialBookSizeId: string;
  bookSizes: BookSize[];
}

export default function UploadClient({
  projectId,
  initialBookSizeId,
  bookSizes,
}: UploadClientProps) {
  const items = useUploadStore((s) => s.items);
  const overall = useUploadStore((s) => s.overall);
  const started = useUploadStore((s) => s.started);
  const busy = useUploadStore((s) => s.busy);
  const selectedIds = useUploadStore((s) => s.selectedIds);
  const addFiles = useUploadStore((s) => s.addFiles);
  const removeItem = useUploadStore((s) => s.remove);
  const removeMany = useUploadStore((s) => s.removeMany);
  const retryItem = useUploadStore((s) => s.retry);
  const cancelAll = useUploadStore((s) => s.cancelAll);
  const toggleSelected = useUploadStore((s) => s.toggleSelected);
  const selectAll = useUploadStore((s) => s.selectAll);
  const clearSelection = useUploadStore((s) => s.clearSelection);

  const { toast } = useToast();
  const queueRef = useRef<UploadQueue | null>(null);
  const [selectionMode, setSelectionMode] = useState(false);
  const [bookSizeId, setBookSizeId] = useState(initialBookSizeId);
  const [bookSizeSaving, setBookSizeSaving] = useState(false);
  const [bookSizeError, setBookSizeError] = useState<string | null>(null);
  const [topLevelError, setTopLevelError] = useState<string | null>(null);

  // 큐 인스턴스 마운트당 1회
  useEffect(() => {
    queueRef.current = new UploadQueue({ projectId });
    return () => {
      queueRef.current?.destroy();
      queueRef.current = null;
    };
  }, [projectId]);

  const counts = useMemo(() => {
    let done = 0,
      error = 0,
      working = 0;
    for (const i of items) {
      if (i.status === "done") done++;
      else if (i.status === "error" || i.status === "cancelled") error++;
      else working++;
    }
    return { done, error, working };
  }, [items]);

  const remainingSlots = MAX_PHOTOS_PER_PROJECT - items.length;
  const allDone = items.length > 0 && counts.done === items.length;

  function handleAddFiles(files: File[]) {
    setTopLevelError(null);
    if (files.length > remainingSlots) {
      setTopLevelError(
        `최대 ${MAX_PHOTOS_PER_PROJECT}장까지 가능해요. ${files.length - remainingSlots}장이 제외됐어요.`,
      );
      files = files.slice(0, remainingSlots);
    }
    if (files.length === 0) return;
    addFiles(files);
  }

  function handleRetryAllFailed() {
    items
      .filter((i) => i.status === "error" || i.status === "cancelled")
      .forEach((i) => retryItem(i.id));
  }

  async function handleDeleteSelected() {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;

    // 업로드 완료(=서버에 photoId 가 있는) 항목은 soft delete API 호출.
    const completedWithIds = items.filter(
      (i) => ids.includes(i.id) && i.status === "done" && i.photoId,
    );
    const photoIds = completedWithIds
      .map((i) => i.photoId!)
      .filter(Boolean);

    if (photoIds.length > 0) {
      try {
        const res = await fetch("/api/photos/trash", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ photoIds }),
        });
        const json = (await res.json()) as {
          ok: boolean;
          error?: { message?: string };
        };
        if (!res.ok || !json.ok) {
          throw new Error(json.error?.message ?? "휴지통 이동 실패");
        }
      } catch (e) {
        toast({
          title: "삭제 실패",
          description: e instanceof Error ? e.message : "알 수 없는 오류",
          variant: "destructive",
        });
        return;
      }
    }

    // 큐에서 제거
    removeMany(ids);
    setSelectionMode(false);
    toast({
      title: "삭제됨",
      description: `${ids.length}장이 제거됐어요.`,
      variant: "success",
    });
  }

  async function handleBookSizeChange(nextId: string) {
    if (nextId === bookSizeId) return;
    setBookSizeId(nextId);
    setBookSizeSaving(true);
    setBookSizeError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ bookSizeId: nextId }),
      });
      const json = (await res.json()) as { ok: boolean; error?: { message?: string } };
      if (!res.ok || !json.ok) {
        throw new Error(json.error?.message ?? "변경 실패");
      }
    } catch (e) {
      setBookSizeError(e instanceof Error ? e.message : "변경 실패");
      setBookSizeId(initialBookSizeId);
    } finally {
      setBookSizeSaving(false);
    }
  }

  return (
    <div className="space-y-8">
      {/* 책 사이즈 선택 */}
      <section aria-labelledby="book-size-heading">
        <h2 id="book-size-heading" className="mb-3 text-sm font-medium text-muted-foreground">
          책 사이즈
        </h2>
        <div className="grid gap-3 sm:grid-cols-3">
          {bookSizes.map((b) => {
            const selected = b.id === bookSizeId;
            return (
              <button
                key={b.id}
                type="button"
                onClick={() => handleBookSizeChange(b.id)}
                aria-pressed={selected}
                disabled={bookSizeSaving}
                className={cn(
                  "rounded-xl border p-4 text-left transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                  selected
                    ? "border-rose-400 bg-rose-50/60 ring-1 ring-rose-300"
                    : "border-input bg-background hover:border-rose-200 hover:bg-rose-50/30",
                )}
              >
                <p className="font-display text-lg font-semibold tracking-tight">{b.name}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {b.width_mm} × {b.height_mm} mm
                </p>
              </button>
            );
          })}
        </div>
        {bookSizeError ? (
          <p className="mt-2 text-sm text-destructive" role="alert">
            {bookSizeError}
          </p>
        ) : null}
      </section>

      {/* Sticky 진행률 */}
      {started && items.length > 0 ? (
        <div
          className="sticky top-2 z-10 rounded-xl border bg-white/90 p-3 shadow-soft backdrop-blur"
          role="region"
          aria-label="업로드 진행 상황"
        >
          <div className="flex items-center justify-between gap-3">
            <div className="text-sm">
              <span className="font-semibold">선택된 사진 {items.length}/{MAX_PHOTOS_PER_PROJECT}</span>
              <span className="ml-2 text-muted-foreground">
                완료 {counts.done} · 진행 {counts.working} · 실패 {counts.error}
              </span>
            </div>
            <div className="text-sm font-medium tabular-nums" aria-live="polite">
              {Math.round(overall * 100)}%
            </div>
          </div>
          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full bg-gradient-to-r from-rose-500 via-orange-400 to-amber-400 transition-[width] duration-200"
              style={{ width: `${Math.round(overall * 100)}%` }}
              role="progressbar"
              aria-valuenow={Math.round(overall * 100)}
              aria-valuemin={0}
              aria-valuemax={100}
            />
          </div>
        </div>
      ) : null}

      {/* Dropzone */}
      <Dropzone
        onFiles={handleAddFiles}
        disabled={remainingSlots <= 0}
        hint={
          remainingSlots <= 0
            ? `최대 ${MAX_PHOTOS_PER_PROJECT}장까지 추가했어요. 일부를 제거하면 더 추가할 수 있어요.`
            : `더 추가 가능: ${remainingSlots}장`
        }
      />

      {topLevelError ? (
        <p className="text-sm text-destructive" role="alert">
          {topLevelError}
        </p>
      ) : null}

      {/* 액션 바 */}
      {items.length > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant={selectionMode ? "default" : "outline"}
              size="sm"
              onClick={() => {
                if (selectionMode) {
                  setSelectionMode(false);
                  clearSelection();
                } else {
                  setSelectionMode(true);
                }
              }}
            >
              {selectionMode ? (
                <>
                  <CheckSquare className="size-4" aria-hidden /> 선택 모드 끄기
                </>
              ) : (
                <>
                  <Square className="size-4" aria-hidden /> 선택 모드
                </>
              )}
            </Button>

            {selectionMode ? (
              <>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => selectAll()}
                  disabled={items.length === 0}
                >
                  전체 선택 ({items.length})
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  onClick={() => void handleDeleteSelected()}
                  disabled={selectedIds.size === 0}
                >
                  <Trash2 className="size-4" aria-hidden /> 선택 삭제 ({selectedIds.size})
                </Button>
              </>
            ) : (
              <>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => cancelAll()}
                  disabled={!busy && counts.working === 0 && items.every((i) => i.status === "done")}
                >
                  <Trash2 className="size-4" aria-hidden /> 모두 제거
                </Button>
                {counts.error > 0 ? (
                  <Button type="button" variant="outline" size="sm" onClick={handleRetryAllFailed}>
                    실패한 항목만 재시도 ({counts.error})
                  </Button>
                ) : null}
              </>
            )}
          </div>

          <Button
            asChild={allDone}
            type="button"
            variant="gradient"
            size="lg"
            disabled={!allDone}
            aria-disabled={!allDone}
          >
            {allDone ? (
              <Link href={`/editor/${projectId}`}>
                다음 <ArrowRight className="size-4" aria-hidden />
              </Link>
            ) : (
              <span>
                다음 <ArrowRight className="size-4" aria-hidden />
              </span>
            )}
          </Button>
        </div>
      ) : null}

      {/* 그리드 */}
      {items.length > 0 ? (
        <div
          className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5"
          aria-live="polite"
        >
          {items.map((item) => (
            <FileGridItem
              key={item.id}
              item={item}
              onRemove={removeItem}
              onRetry={retryItem}
              selectionMode={selectionMode}
              selected={selectedIds.has(item.id)}
              onToggleSelect={toggleSelected}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

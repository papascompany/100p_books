"use client";

import { AlertCircle, Check, Loader2, RotateCcw, X } from "lucide-react";
import { useEffect, useState } from "react";

import type { UploadItem } from "@/lib/image/upload-queue";
import { cn } from "@/lib/utils";

interface FileGridItemProps {
  item: UploadItem;
  onRemove: (id: string) => void;
  onRetry: (id: string) => void;
  /** 다중 선택 모드 활성 여부. */
  selectionMode?: boolean;
  /** 다중 선택 상태. */
  selected?: boolean;
  /** 다중 선택 토글 콜백. */
  onToggleSelect?: (id: string) => void;
}

const STATUS_LABEL: Record<UploadItem["status"], string> = {
  pending: "대기 중",
  converting: "변환 중",
  reading: "읽는 중",
  uploading: "업로드 중",
  done: "완료",
  error: "실패",
  cancelled: "취소됨",
};

export default function FileGridItem({
  item,
  onRemove,
  onRetry,
  selectionMode,
  selected,
  onToggleSelect,
}: FileGridItemProps) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  // 파일 객체 자체가 바뀌었을 때만 새 blob URL 발급. 동일 파일 reference 면 유지.
  // (Zustand 가 item 객체를 immutable 하게 갱신할 때 file 은 같은 reference 가 보존되어야 함)
  useEffect(() => {
    const file = item.effectiveFile ?? item.file;
    if (!file) return;
    let url: string;
    try {
      url = URL.createObjectURL(file);
    } catch {
      // 파일이 닫혔거나 무효화된 경우 (네비게이션 후 등) — 무시
      return;
    }
    setPreviewUrl(url);
    return () => {
      try {
        URL.revokeObjectURL(url);
      } catch {
        /* noop */
      }
    };
  }, [item.file, item.effectiveFile]);

  // 이미지 로드 실패 시 (예: blob URL 무효화) 깔끔하게 폴백
  function handleImgError() {
    setPreviewUrl(null);
  }

  const isWorking =
    item.status === "converting" ||
    item.status === "reading" ||
    item.status === "uploading" ||
    item.status === "pending";

  const pct = Math.round(item.progress * 100);

  return (
    <div
      className={cn(
        "group relative overflow-hidden rounded-xl border bg-card shadow-soft transition-colors",
        selectionMode && selected
          ? "border-rose-500 ring-2 ring-rose-400"
          : null,
      )}
    >
      {/* 다중 선택 모드 — 카드 전체가 토글 트리거 */}
      {selectionMode ? (
        <button
          type="button"
          onClick={() => onToggleSelect?.(item.id)}
          aria-pressed={selected}
          aria-label={`${item.file.name} 선택`}
          className="absolute inset-0 z-10 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        />
      ) : null}

      {selectionMode ? (
        <span
          className={cn(
            "pointer-events-none absolute right-2 top-2 z-20 inline-flex size-7 items-center justify-center rounded-full border text-xs font-semibold shadow",
            selected
              ? "bg-rose-500 text-white border-rose-500"
              : "bg-card/85 text-foreground border-white/85 backdrop-blur",
          )}
        >
          {selected ? "✓" : ""}
        </span>
      ) : null}

      {/* Thumbnail */}
      <div className="relative aspect-square w-full bg-muted">
        {previewUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={previewUrl}
            alt={item.file.name}
            onError={handleImgError}
            className={cn(
              "h-full w-full object-cover transition-opacity",
              item.status === "error" || item.status === "cancelled" ? "opacity-50" : "opacity-100",
            )}
          />
        ) : (
          <div
            aria-hidden
            className="flex h-full w-full items-center justify-center text-xs text-muted-foreground"
          >
            완료
          </div>
        )}

        {/* Progress overlay */}
        {isWorking ? (
          <div
            className="absolute inset-x-0 bottom-0 h-1 bg-rose-500/90 transition-[width] duration-200"
            style={{ width: `${pct}%` }}
            role="progressbar"
            aria-label={`${item.file.name} 진행률`}
            aria-valuenow={pct}
            aria-valuemin={0}
            aria-valuemax={100}
          />
        ) : null}

        {/* Status badge */}
        <div className="absolute left-2 top-2">
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-medium backdrop-blur-sm",
              item.status === "done" && "bg-emerald-500/90 text-white",
              item.status === "error" && "bg-rose-500/90 text-white",
              item.status === "cancelled" && "bg-slate-500/90 text-white",
              isWorking && "bg-card/85 text-foreground",
            )}
          >
            {item.status === "done" && <Check className="size-3" aria-hidden />}
            {item.status === "error" && <AlertCircle className="size-3" aria-hidden />}
            {isWorking && <Loader2 className="size-3 animate-spin" aria-hidden />}
            {STATUS_LABEL[item.status]}
            {isWorking ? ` ${pct}%` : null}
          </span>
        </div>

        {/* Remove button (선택 모드 아닐 때만) */}
        {!selectionMode ? (
          <button
            type="button"
            onClick={() => onRemove(item.id)}
            className="absolute right-2 top-2 inline-flex size-11 items-center justify-center rounded-full bg-black/55 text-white opacity-0 transition-opacity hover:bg-black/75 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80 focus:opacity-100 group-hover:opacity-100"
            aria-label={`${item.file.name} 제거`}
          >
            <X className="size-4" aria-hidden />
          </button>
        ) : null}
      </div>

      {/* Caption */}
      <div className="p-2.5">
        <p className="truncate text-xs font-medium text-foreground" title={item.file.name}>
          {item.file.name}
        </p>
        {item.error ? (
          <p className="mt-1 line-clamp-2 text-[11px] text-destructive" title={item.error}>
            {item.error}
          </p>
        ) : null}

        {(item.status === "error" || item.status === "cancelled") && (
          <button
            type="button"
            onClick={() => onRetry(item.id)}
            className="mt-2 inline-flex items-center gap-1 text-[11px] font-medium text-rose-600 hover:underline"
          >
            <RotateCcw className="size-3" aria-hidden /> 재시도
          </button>
        )}
      </div>
    </div>
  );
}

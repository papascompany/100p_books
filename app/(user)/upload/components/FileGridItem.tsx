"use client";

import { AlertCircle, Check, Loader2, RotateCcw, X } from "lucide-react";
import { useEffect, useState } from "react";

import type { UploadItem } from "@/lib/image/upload-queue";
import { cn } from "@/lib/utils";

interface FileGridItemProps {
  item: UploadItem;
  onRemove: (id: string) => void;
  onRetry: (id: string) => void;
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

export default function FileGridItem({ item, onRemove, onRetry }: FileGridItemProps) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  useEffect(() => {
    const url = URL.createObjectURL(item.effectiveFile ?? item.file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [item.file, item.effectiveFile]);

  const isWorking =
    item.status === "converting" ||
    item.status === "reading" ||
    item.status === "uploading" ||
    item.status === "pending";

  const pct = Math.round(item.progress * 100);

  return (
    <div className="group relative overflow-hidden rounded-xl border bg-card shadow-soft">
      {/* Thumbnail */}
      <div className="relative aspect-square w-full bg-muted">
        {previewUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={previewUrl}
            alt={item.file.name}
            className={cn(
              "h-full w-full object-cover transition-opacity",
              item.status === "error" || item.status === "cancelled" ? "opacity-50" : "opacity-100",
            )}
          />
        ) : null}

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
              isWorking && "bg-white/85 text-foreground",
            )}
          >
            {item.status === "done" && <Check className="size-3" aria-hidden />}
            {item.status === "error" && <AlertCircle className="size-3" aria-hidden />}
            {isWorking && <Loader2 className="size-3 animate-spin" aria-hidden />}
            {STATUS_LABEL[item.status]}
            {isWorking ? ` ${pct}%` : null}
          </span>
        </div>

        {/* Remove button */}
        <button
          type="button"
          onClick={() => onRemove(item.id)}
          className="absolute right-2 top-2 inline-flex size-11 items-center justify-center rounded-full bg-black/55 text-white opacity-0 transition-opacity hover:bg-black/75 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80 focus:opacity-100 group-hover:opacity-100"
          aria-label={`${item.file.name} 제거`}
        >
          <X className="size-4" aria-hidden />
        </button>
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

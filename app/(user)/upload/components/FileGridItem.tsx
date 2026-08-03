"use client";

import { AlertCircle, Check, ImageOff, Loader2, RotateCcw, X } from "lucide-react";
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
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [imgFailed, setImgFailed] = useState(false);

  // 소형 썸네일(thumbDataUrl)이 준비되면 그것을 쓰고, 없을 때만 원본 blob URL 발급 (UP-10).
  // (풀사이즈 원본을 ~150px 셀 <img> 에 물리면 100장 스크롤 시 풀해상도 디코딩이
  //  반복되어 모바일 메모리 압박 → 탭 강제 리로드 위험)
  useEffect(() => {
    if (item.thumbDataUrl) {
      // 썸네일 확보 — 이전 blob URL 은 cleanup 에서 revoke 됨
      setBlobUrl(null);
      return;
    }
    const file = item.effectiveFile ?? item.file;
    // 서버 복원 항목은 빈 placeholder File (size 0) — blob 미리보기 불가
    if (!file || file.size === 0) return;
    let url: string;
    try {
      url = URL.createObjectURL(file);
    } catch {
      // 파일이 닫혔거나 무효화된 경우 (네비게이션 후 등) — 무시
      return;
    }
    setBlobUrl(url);
    return () => {
      try {
        URL.revokeObjectURL(url);
      } catch {
        /* noop */
      }
    };
  }, [item.file, item.effectiveFile, item.thumbDataUrl]);

  // 표시 소스가 바뀌면 로드 실패 상태 초기화
  useEffect(() => {
    setImgFailed(false);
  }, [item.thumbDataUrl, blobUrl]);

  const previewUrl = imgFailed ? null : (item.thumbDataUrl ?? blobUrl);

  // 이미지 로드 실패 시 (예: blob URL 무효화, signed URL 만료) 깔끔하게 폴백
  function handleImgError() {
    setImgFailed(true);
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
          // 상태 중립 폴백 — 상태 표시는 좌상단 배지가 담당 (UP-15)
          <div
            aria-hidden
            className="flex h-full w-full items-center justify-center text-muted-foreground"
          >
            <ImageOff className="size-6" aria-hidden />
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
          // hover 가 없는 터치 기기에서는 상시 노출, hover 지원 기기에서만 hover/focus 시 표시 (UP-5)
          <button
            type="button"
            onClick={() => onRemove(item.id)}
            className="absolute right-2 top-2 inline-flex size-11 items-center justify-center rounded-full bg-black/55 text-white transition-opacity hover:bg-black/75 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:focus:opacity-100 [@media(hover:hover)]:group-hover:opacity-100"
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
          // 실패 복구는 핵심 동작 — 44px 터치 타깃의 풀폭 버튼 (UP-11)
          <button
            type="button"
            onClick={() => onRetry(item.id)}
            className="mt-2 inline-flex min-h-11 w-full items-center justify-center gap-1.5 rounded-lg border border-rose-200 bg-rose-50/70 px-3 text-xs font-semibold text-rose-600 transition-colors hover:bg-rose-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:border-rose-500/40 dark:bg-rose-950/40 dark:text-rose-300 dark:hover:bg-rose-950/60"
          >
            <RotateCcw className="size-3.5" aria-hidden /> 재시도
          </button>
        )}
      </div>
    </div>
  );
}

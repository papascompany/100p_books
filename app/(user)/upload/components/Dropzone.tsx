"use client";

import { ImagePlus, Upload } from "lucide-react";
import { useCallback, useRef, useState } from "react";

import { cn } from "@/lib/utils";

interface DropzoneProps {
  onFiles: (files: File[]) => void;
  /** 비활성 (예: 100장 한도 도달) */
  disabled?: boolean;
  /** 보조 문구 */
  hint?: string;
}

/**
 * 드래그&드롭 + 클릭/키보드로 파일 피커.
 * 모바일에서는 갤러리 또는 카메라 선택 가능 (capture 미지정 → 둘 다).
 */
export default function Dropzone({ onFiles, disabled = false, hint }: DropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isOver, setIsOver] = useState(false);

  const open = useCallback(() => {
    if (disabled) return;
    inputRef.current?.click();
  }, [disabled]);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files ?? []);
      if (files.length > 0) onFiles(files);
      // 같은 파일 재선택 가능하게 reset
      e.target.value = "";
    },
    [onFiles],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setIsOver(false);
      if (disabled) return;
      const files = Array.from(e.dataTransfer.files ?? []).filter((f) =>
        f.type.startsWith("image/") || /\.(heic|heif)$/i.test(f.name),
      );
      if (files.length > 0) onFiles(files);
    },
    [disabled, onFiles],
  );

  return (
    <div
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-disabled={disabled}
      aria-label="사진을 끌어다 놓거나 클릭하여 선택"
      onClick={open}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          open();
        }
      }}
      onDragOver={(e) => {
        e.preventDefault();
        if (!disabled) setIsOver(true);
      }}
      onDragLeave={() => setIsOver(false)}
      onDrop={handleDrop}
      className={cn(
        "relative flex min-h-[280px] cursor-pointer flex-col items-center justify-center gap-4 rounded-2xl border-2 border-dashed p-10 text-center transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        isOver
          ? "border-rose-400 bg-rose-50/60"
          : "border-muted-foreground/25 bg-gradient-to-br from-rose-50/50 via-white to-amber-50/50 hover:border-rose-300 hover:bg-rose-50/40",
        disabled && "cursor-not-allowed opacity-60",
      )}
    >
      <div className="flex size-14 items-center justify-center rounded-2xl bg-white shadow-soft">
        {isOver ? (
          <Upload className="size-6 text-rose-500" aria-hidden />
        ) : (
          <ImagePlus className="size-6 text-rose-500" aria-hidden />
        )}
      </div>

      <div>
        <p className="font-display text-xl font-semibold tracking-tight text-foreground">
          {isOver ? "이대로 놓아주세요" : "사진을 끌어다 놓거나 클릭"}
        </p>
        <p className="mt-1.5 text-sm text-muted-foreground">
          JPEG · PNG · WebP · HEIC · 최대 20MB · 100장
        </p>
        {hint ? (
          <p className="mt-1 text-xs text-muted-foreground/80">{hint}</p>
        ) : null}
      </div>

      <input
        ref={inputRef}
        type="file"
        multiple
        accept="image/*,.heic,.heif"
        onChange={handleChange}
        disabled={disabled}
        className="hidden"
      />
    </div>
  );
}

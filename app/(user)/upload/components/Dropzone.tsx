"use client";

import { ImagePlus, Upload } from "lucide-react";
import { useCallback, useRef, useState } from "react";

import UploadSourceSheet from "@/components/upload/UploadSourceSheet";
import { useMediaQuery } from "@/hooks/use-media-query";
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
 *
 * - 데스크탑: 드래그&드롭 드롭존 + 클릭 → 갤러리 input
 * - 모바일(≤768px): 클릭 → UploadSourceSheet 오픈
 *   - "사진 선택" → 갤러리 (multiple)
 *   - "카메라로 찍기" → `capture="environment"` 카메라 직접 실행
 */
export default function Dropzone({ onFiles, disabled = false, hint }: DropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isOver, setIsOver] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);

  const isMobile = useMediaQuery("(max-width: 768px)");

  const open = useCallback(() => {
    if (disabled) return;
    if (isMobile) {
      setSheetOpen(true);
    } else {
      inputRef.current?.click();
    }
  }, [disabled, isMobile]);

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
    <>
      <div
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-disabled={disabled}
        aria-label={
          isMobile
            ? "탭하여 갤러리 또는 카메라로 사진 추가"
            : "사진을 끌어다 놓거나 클릭하여 선택"
        }
        onClick={open}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            open();
          }
        }}
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled && !isMobile) setIsOver(true);
        }}
        onDragLeave={() => setIsOver(false)}
        onDrop={handleDrop}
        className={cn(
          "relative flex min-h-[280px] cursor-pointer flex-col items-center justify-center gap-4 border-2 border-dashed p-10 text-center transition-colors",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
          isOver
            ? "border-coral bg-coral-50"
            : "border-hairline bg-soft-cloud hover:border-coral hover:bg-coral-50/50",
          disabled && "cursor-not-allowed opacity-60",
        )}
      >
        <div className="flex size-14 items-center justify-center rounded-full bg-white border border-hairline">
          {isOver ? (
            <Upload className="size-6 text-coral" aria-hidden />
          ) : (
            <ImagePlus className="size-6 text-ink" aria-hidden />
          )}
        </div>

        <div>
          <p className="text-xl font-semibold tracking-tight text-ink">
            {isOver
              ? "여기에 놓아주세요"
              : isMobile
                ? "탭해서 사진 추가하기"
                : "사진을 끌어다 놓거나 클릭하기"}
          </p>
          <p className="mt-1.5 text-sm text-muted-foreground">
            JPEG · PNG · WebP · HEIC · 최대 20MB · 100장
          </p>
          {isMobile ? (
            <p className="mt-1 text-xs text-muted-foreground/80">
              갤러리 선택 또는 카메라 촬영 가능
            </p>
          ) : null}
          {hint ? (
            <p className="mt-1 text-xs text-muted-foreground/80">{hint}</p>
          ) : null}
        </div>

        {/* 데스크탑 전용 숨겨진 input */}
        {!isMobile ? (
          <input
            ref={inputRef}
            type="file"
            multiple
            accept="image/*,.heic,.heif"
            onChange={handleChange}
            disabled={disabled}
            className="hidden"
          />
        ) : null}
      </div>

      {/* 모바일 소스 선택 시트 */}
      <UploadSourceSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        onFiles={onFiles}
        disabled={disabled}
      />
    </>
  );
}

"use client";

import { Camera, Image as ImageIcon, X } from "lucide-react";
import * as React from "react";

import MobileBottomSheet from "@/components/layout/MobileBottomSheet";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface UploadSourceSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called with selected files from the gallery or camera. */
  onFiles: (files: File[]) => void;
  disabled?: boolean;
}

/**
 * 모바일 업로드 소스 선택 바텀시트.
 *
 * 두 버튼:
 *  - "사진 선택" → 기기 갤러리 (`<input type="file" multiple>`)
 *  - "카메라로 찍기" → 후면 카메라 직접 실행 (`capture="environment"`)
 *
 * 실제 파일 읽기는 숨겨진 <input> 를 programmatic click 으로 처리한다.
 * 파일 선택 완료 후 Sheet 를 자동으로 닫는다.
 */
export default function UploadSourceSheet({
  open,
  onOpenChange,
  onFiles,
  disabled = false,
}: UploadSourceSheetProps) {
  const galleryRef = React.useRef<HTMLInputElement>(null);
  const cameraRef = React.useRef<HTMLInputElement>(null);

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (files.length > 0) {
      onFiles(files);
      onOpenChange(false);
    }
    // reset so the same file can be re-selected
    e.target.value = "";
  }

  return (
    <MobileBottomSheet
      open={open}
      onOpenChange={onOpenChange}
      title="사진 추가"
      description="갤러리에서 선택하거나 카메라로 바로 찍어보세요."
    >
      <div className="space-y-3 pb-2">
        {/* 갤러리 선택 */}
        <button
          type="button"
          disabled={disabled}
          onClick={() => galleryRef.current?.click()}
          className={cn(
            "flex w-full items-center gap-4 rounded-xl border border-hairline bg-background px-5 py-4",
            "text-left transition-colors shadow-soft",
            "hover:border-coral-300 hover:bg-coral-50/40",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
            "active:scale-[0.98]",
            disabled && "cursor-not-allowed opacity-60",
          )}
          aria-label="갤러리에서 사진 선택"
        >
          <span className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-coral-100/80 text-coral-600">
            <ImageIcon className="size-6" aria-hidden />
          </span>
          <div>
            <p className="text-base font-semibold leading-snug">사진 선택</p>
            <p className="mt-0.5 text-sm text-muted-foreground">
              갤러리에서 여러 장을 선택할 수 있어요.
            </p>
          </div>
        </button>

        {/* 카메라 촬영 */}
        <button
          type="button"
          disabled={disabled}
          onClick={() => cameraRef.current?.click()}
          className={cn(
            "flex w-full items-center gap-4 rounded-xl border border-hairline bg-background px-5 py-4",
            "text-left transition-colors shadow-soft",
            "hover:border-coral-200 hover:bg-coral-50/30",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
            "active:scale-[0.98]",
            disabled && "cursor-not-allowed opacity-60",
          )}
          aria-label="카메라로 사진 찍기"
        >
          <span className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-peach/60 text-coral-600">
            <Camera className="size-6" aria-hidden />
          </span>
          <div>
            <p className="text-base font-semibold leading-snug">카메라로 찍기</p>
            <p className="mt-0.5 text-sm text-muted-foreground">
              후면 카메라로 바로 촬영해요.
            </p>
          </div>
        </button>

        {/* 취소 */}
        <Button
          type="button"
          variant="ghost"
          className="w-full gap-2 text-muted-foreground"
          onClick={() => onOpenChange(false)}
        >
          <X className="size-4" aria-hidden />
          취소
        </Button>
      </div>

      {/* 숨겨진 file inputs */}
      <input
        ref={galleryRef}
        type="file"
        multiple
        accept="image/*,.heic,.heif"
        onChange={handleChange}
        disabled={disabled}
        className="hidden"
        aria-hidden="true"
        tabIndex={-1}
      />
      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={handleChange}
        disabled={disabled}
        className="hidden"
        aria-hidden="true"
        tabIndex={-1}
      />
    </MobileBottomSheet>
  );
}

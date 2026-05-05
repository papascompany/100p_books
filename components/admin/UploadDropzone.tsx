"use client";

import * as React from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * 단일 파일 업로드 드롭존.
 * - drag & drop + 클릭으로 파일 선택
 * - accept (MIME 또는 ext) / maxSizeBytes 검증
 * - 선택된 파일 미리보기 (이름/크기)
 *
 * onFile 콜백으로 부모가 form 의 일부로 사용한다.
 */
export interface UploadDropzoneProps {
  /** ".ttf,.otf,.woff2" 또는 "image/jpeg,image/png" */
  accept: string;
  /** 검증용 (UI 메시지). 실제 거절은 onFile 호출 전 자체 차단. */
  maxSizeBytes?: number;
  label?: string;
  hint?: string;
  /** 파일 선택 시 호출. null 이면 해제. */
  onFile: (file: File | null) => void;
  /** 외부에서 reset 트리거 */
  resetSignal?: number;
  className?: string;
}

export default function UploadDropzone({
  accept,
  maxSizeBytes,
  label = "파일을 드래그하거나 클릭하여 선택",
  hint,
  onFile,
  resetSignal = 0,
  className,
}: UploadDropzoneProps) {
  const [file, setFile] = React.useState<File | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [hover, setHover] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    setFile(null);
    setError(null);
    if (inputRef.current) inputRef.current.value = "";
  }, [resetSignal]);

  const validate = (f: File): string | null => {
    if (maxSizeBytes && f.size > maxSizeBytes) {
      return `파일이 ${(maxSizeBytes / 1024 / 1024).toFixed(1)}MB 를 초과합니다.`;
    }
    return null;
  };

  const set = (f: File | null) => {
    if (!f) {
      setFile(null);
      setError(null);
      onFile(null);
      return;
    }
    const err = validate(f);
    if (err) {
      setError(err);
      setFile(null);
      onFile(null);
      return;
    }
    setError(null);
    setFile(f);
    onFile(f);
  };

  return (
    <div className={cn("space-y-1", className)}>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setHover(true);
        }}
        onDragLeave={() => setHover(false)}
        onDrop={(e) => {
          e.preventDefault();
          setHover(false);
          const f = e.dataTransfer.files?.[0];
          if (f) set(f);
        }}
        onClick={() => inputRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        className={cn(
          "flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-4 py-8 text-center text-sm transition-colors",
          hover
            ? "border-rose-400 bg-rose-50/60"
            : "border-input bg-muted/20 hover:bg-muted/40",
        )}
      >
        <p className="font-medium">{label}</p>
        {hint ? (
          <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
        ) : null}
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0] ?? null;
            set(f);
          }}
        />
      </div>

      {file ? (
        <div className="flex items-center justify-between rounded-md border bg-card px-3 py-2 text-xs">
          <span className="truncate">
            {file.name}{" "}
            <span className="text-muted-foreground">
              ({(file.size / 1024).toFixed(1)} KB)
            </span>
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              set(null);
            }}
          >
            제거
          </Button>
        </div>
      ) : null}

      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}

"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Download, Loader2, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/use-toast";
import { cn } from "@/lib/utils";

/**
 * 단일 페이지 PNG 미리보기 다이얼로그.
 *
 * 동작:
 *   - open=true 가 되면 /api/pages/[id]/preview 를 호출.
 *   - 응답 PNG dataURL 을 <img> 로 표시.
 *   - "다운로드" 버튼: dataURL → blob → <a download>.
 *   - bleed 가이드 점선 오버레이 옵션 (기본 OFF).
 *
 * 자동 저장(5초 debounce) 직후에 호출하면 최신 상태가 반영됨.
 * fetch 에러는 toast 로 표시 + 다이얼로그는 열려있는 상태 유지.
 */
export interface PagePreviewDialogProps {
  pageId: string;
  pageNo: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 다운로드 파일명 prefix. 기본 "page-{pageNo}". */
  filenamePrefix?: string;
}

export default function PagePreviewDialog({
  pageId,
  pageNo,
  open,
  onOpenChange,
  filenamePrefix,
}: PagePreviewDialogProps) {
  const [pngDataUrl, setPngDataUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showBleed, setShowBleed] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const fetchPreview = useCallback(async () => {
    setLoading(true);
    setError(null);
    setPngDataUrl(null);
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      const res = await fetch(`/api/pages/${pageId}/preview`, {
        method: "GET",
        signal: ac.signal,
      });
      const json = (await res.json()) as {
        ok: boolean;
        data?: { pngDataUrl: string };
        error?: { message: string };
      };
      if (!res.ok || !json.ok || !json.data) {
        throw new Error(json.error?.message ?? "미리보기 생성에 실패했어요.");
      }
      setPngDataUrl(json.data.pngDataUrl);
    } catch (e) {
      if ((e as { name?: string })?.name === "AbortError") return;
      const msg = e instanceof Error ? e.message : "미리보기 생성에 실패했어요.";
      setError(msg);
      toast({ description: msg, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [pageId]);

  // 다이얼로그 open 시 자동 fetch
  useEffect(() => {
    if (open) {
      void fetchPreview();
    } else {
      // 닫힐 때 abort + 상태 리셋 (다음 열림 시 fresh)
      abortRef.current?.abort();
      setPngDataUrl(null);
      setError(null);
      setLoading(false);
    }
    return () => {
      abortRef.current?.abort();
    };
  }, [open, fetchPreview]);

  const onDownload = useCallback(() => {
    if (!pngDataUrl) return;
    try {
      // dataURL → blob → <a download>
      const a = document.createElement("a");
      a.href = pngDataUrl;
      a.download = `${filenamePrefix ?? "page"}-${pageNo}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch (e) {
      toast({
        description: e instanceof Error ? e.message : "다운로드에 실패했어요.",
        variant: "destructive",
      });
    }
  }, [pngDataUrl, pageNo, filenamePrefix]);

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          className={cn(
            "fixed inset-0 z-50 bg-black/60 backdrop-blur-[2px]",
            "data-[state=open]:animate-in data-[state=open]:fade-in-0",
            "data-[state=closed]:animate-out data-[state=closed]:fade-out-0",
          )}
        />
        <DialogPrimitive.Content
          className={cn(
            "fixed left-1/2 top-1/2 z-50 w-[min(96vw,820px)] -translate-x-1/2 -translate-y-1/2",
            "max-h-[92vh] overflow-hidden rounded-xl border bg-background shadow-soft-lg",
            "flex flex-col",
            "focus:outline-none",
          )}
        >
          {/* 헤더 */}
          <div className="flex items-center justify-between gap-3 border-b px-5 py-3">
            <div>
              <DialogPrimitive.Title className="text-base font-semibold">
                페이지 {pageNo} 미리보기
              </DialogPrimitive.Title>
              <DialogPrimitive.Description className="mt-0.5 text-xs text-muted-foreground">
                자동 저장 후 인쇄 시점과 거의 동일한 결과를 미리 볼 수 있어요.
              </DialogPrimitive.Description>
            </div>
            <DialogPrimitive.Close
              aria-label="닫기"
              className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <X className="size-4" />
            </DialogPrimitive.Close>
          </div>

          {/* 본문 */}
          <div className="relative flex flex-1 items-center justify-center overflow-auto bg-[#f6f5f2] p-6 dark:bg-white/[0.02]">
            {loading ? (
              <div className="flex flex-col items-center gap-3 text-sm text-muted-foreground">
                <Loader2 className="size-6 animate-spin" aria-hidden />
                미리보기 만드는 중…
              </div>
            ) : error ? (
              <div className="flex flex-col items-center gap-3 text-sm text-destructive">
                <p>{error}</p>
                <Button variant="outline" size="sm" onClick={() => void fetchPreview()}>
                  다시 시도
                </Button>
              </div>
            ) : pngDataUrl ? (
              <div className="relative inline-block max-h-full max-w-full">
                {/* dataURL base64 — next/image 최적화 부적합 */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={pngDataUrl}
                  alt={`페이지 ${pageNo} 미리보기`}
                  className="max-h-[72vh] max-w-full rounded-md bg-white shadow-soft ring-1 ring-black/5"
                />
                {showBleed ? (
                  <div
                    aria-hidden
                    className="pointer-events-none absolute inset-0 rounded-md"
                    style={{
                      // bleed 2mm 가이드 — PNG 외곽선에서 안쪽으로 비율 추정 (대략 표시).
                      // 정확한 trim 박스는 PageDoc.bleedMm / totalSize 비율로 계산되지만
                      // dataURL 만으론 알 수 없어 보수적으로 외곽 1.5% 안쪽 표시.
                      boxShadow:
                        "inset 0 0 0 1px rgba(220, 38, 38, 0.7), inset 0 0 0 12px transparent",
                      outline: "2px dashed rgba(220, 38, 38, 0.5)",
                      outlineOffset: "-12px",
                    }}
                  />
                ) : null}
              </div>
            ) : null}
          </div>

          {/* 푸터 */}
          <div className="flex flex-wrap items-center justify-between gap-2 border-t bg-background px-5 py-3">
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={showBleed}
                onChange={(e) => setShowBleed(e.target.checked)}
              />
              재단선 가이드(2mm)
            </label>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onOpenChange(false)}
              >
                닫기
              </Button>
              <Button
                size="sm"
                disabled={!pngDataUrl}
                onClick={onDownload}
                variant="gradient"
              >
                <Download className="size-4" aria-hidden />
                PNG 다운로드
              </Button>
            </div>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

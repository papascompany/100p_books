"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { AlertTriangle, X } from "lucide-react";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { buildCollagePage, type CollageTemplateId } from "@/lib/layout/collage";
import { COLLAGE_TEMPLATE_META } from "@/lib/layout/templates";
import type { PageDoc } from "@/lib/layout/types";
import { cn } from "@/lib/utils";

export interface CollageTemplateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 현재 페이지 — 사진 N장과 trim 사이즈를 추출. */
  doc: PageDoc;
  /** 새 PageDoc 으로 교체. (FabricStage.loadDoc 의 페이로드 생성에 사용) */
  onApply: (next: PageDoc) => void;
}

/**
 * 현재 페이지의 사진 ID 목록을 보존하며 다른 콜라주 프리셋으로 재배치.
 * - 사진이 슬롯 수보다 많으면 앞에서부터 사용, 부족하면 빈 슬롯 자리표시자.
 * - 폴라로이드 페이지에서 호출해도 사진 1장 → 콜라주 변환 가능.
 * - 새 레이아웃에는 사진만 옮겨진다 — 내용이 있는 텍스트나 클립아트가 있으면
 *   적용 전에 삭제 경고 확인 단계를 거친다 (EC-8). 적용 시 Undo 히스토리가
 *   리셋되어 복구할 수 없기 때문.
 */
export default function CollageTemplateDialog({
  open,
  onOpenChange,
  doc,
  onApply,
}: CollageTemplateDialogProps) {
  // 확인 대기 중인 템플릿 — null 이면 템플릿 그리드, 값이 있으면 경고 뷰.
  const [pendingTemplate, setPendingTemplate] = useState<CollageTemplateId | null>(
    null,
  );

  // 템플릿 적용 시 사라지는 객체 집계.
  // 빈 캡션(placeholder 텍스트)은 손실로 치지 않는다 — 내용이 있는 텍스트만.
  const lossy = useMemo(() => {
    let textCount = 0;
    let clipartCount = 0;
    for (const obj of doc.objects) {
      if (obj.type === "text" && obj.text.trim().length > 0) textCount += 1;
      else if (obj.type === "clipart") clipartCount += 1;
    }
    return { textCount, clipartCount, total: textCount + clipartCount };
  }, [doc.objects]);

  function applyTemplate(id: CollageTemplateId) {
    const photoIds: string[] = [];
    for (const obj of doc.objects) {
      if (obj.type === "photo") photoIds.push(obj.photoId);
    }
    const next = buildCollagePage({
      bookSize: {
        id: doc.bookSizeId,
        width_mm: doc.widthMm,
        height_mm: doc.heightMm,
      },
      pageNo: doc.pageNo,
      template: id,
      photos: photoIds.map((pid) => ({ id: pid })),
    });
    setPendingTemplate(null);
    onApply(next);
    onOpenChange(false);
  }

  /** 템플릿 클릭 — 손실 객체가 있으면 경고 확인을 먼저 받는다. */
  function handleSelect(id: CollageTemplateId) {
    if (lossy.total > 0) {
      setPendingTemplate(id);
      return;
    }
    applyTemplate(id);
  }

  /** 닫힐 때 경고 대기 상태 초기화. */
  function handleOpenChange(next: boolean) {
    if (!next) setPendingTemplate(null);
    onOpenChange(next);
  }

  const lossyParts: string[] = [];
  if (lossy.textCount > 0) lossyParts.push(`텍스트 ${lossy.textCount}개`);
  if (lossy.clipartCount > 0) lossyParts.push(`클립아트 ${lossy.clipartCount}개`);

  return (
    <DialogPrimitive.Root open={open} onOpenChange={handleOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/50 backdrop-blur-[2px] data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          className={cn(
            "fixed left-1/2 top-1/2 z-50 w-[min(92vw,520px)] -translate-x-1/2 -translate-y-1/2",
            "rounded-xl border border-border bg-background p-5 shadow-soft-lg",
          )}
        >
          <div className="flex items-start justify-between gap-3 pb-3">
            <div>
              <DialogPrimitive.Title className="text-base font-semibold">
                콜라주 템플릿 선택
              </DialogPrimitive.Title>
              <DialogPrimitive.Description className="mt-1 text-sm text-muted-foreground">
                현재 페이지의 사진을 새 레이아웃으로 재배치합니다.
              </DialogPrimitive.Description>
            </div>
            <DialogPrimitive.Close
              aria-label="닫기"
              className="-mt-1 inline-flex size-9 items-center justify-center rounded-md text-muted-foreground hover:bg-accent"
            >
              <X className="size-5" />
            </DialogPrimitive.Close>
          </div>

          {pendingTemplate ? (
            /* 손실 경고 확인 단계 — 텍스트/클립아트가 삭제됨을 명시 (EC-8) */
            <div className="space-y-4">
              <div
                role="alert"
                className="flex items-start gap-2.5 rounded-lg border border-destructive/30 bg-destructive/5 p-3"
              >
                <AlertTriangle
                  className="mt-0.5 size-5 shrink-0 text-destructive"
                  aria-hidden
                />
                <p className="text-sm text-foreground">
                  새 레이아웃에는 사진만 옮겨져요. 이 페이지의{" "}
                  <strong>{lossyParts.join("와 ")}</strong>가 삭제되고,
                  되돌리기로 복구할 수 없어요. 계속할까요?
                </p>
              </div>
              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setPendingTemplate(null)}
                >
                  취소
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  onClick={() => applyTemplate(pendingTemplate)}
                >
                  삭제하고 적용
                </Button>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-3">
              {COLLAGE_TEMPLATE_META.map((meta) => (
                <Button
                  key={meta.id}
                  type="button"
                  variant="outline"
                  onClick={() => handleSelect(meta.id)}
                  className="flex h-auto flex-col items-stretch gap-2 p-2"
                >
                  <span
                    className="block aspect-square w-full overflow-hidden rounded"
                    // eslint-disable-next-line react/no-danger
                    dangerouslySetInnerHTML={{ __html: meta.previewSvg }}
                  />
                  <span className="text-xs">{meta.label}</span>
                </Button>
              ))}
            </div>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

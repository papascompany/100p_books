"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";

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
 */
export default function CollageTemplateDialog({
  open,
  onOpenChange,
  doc,
  onApply,
}: CollageTemplateDialogProps) {
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
    onApply(next);
    onOpenChange(false);
  }

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
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

          <div className="grid grid-cols-3 gap-3">
            {COLLAGE_TEMPLATE_META.map((meta) => (
              <Button
                key={meta.id}
                type="button"
                variant="outline"
                onClick={() => applyTemplate(meta.id)}
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
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

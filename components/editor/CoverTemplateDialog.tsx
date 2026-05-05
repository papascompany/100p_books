"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { BookSize } from "@/lib/db/types";
import { buildDefaultCoverDoc } from "@/lib/layout/cover";
import {
  COVER_TEMPLATE_META,
  type CoverTemplateId,
} from "@/lib/layout/cover-templates";
import type { PageDoc } from "@/lib/layout/types";
import { cn } from "@/lib/utils";

export interface CoverTemplateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 현재 cover PageDoc — 사진/제목을 가능하면 보존. */
  doc: PageDoc;
  /** 책 사이즈 — 책등 두께 재계산용. */
  bookSize: BookSize;
  /** 페이지 수 — 책등 두께 재계산용. */
  pageCount: number;
  /** 새 cover PageDoc 으로 교체. */
  onApply: (next: PageDoc) => void;
}

/**
 * 표지 템플릿 선택 다이얼로그.
 * 적용 시 현재 doc 에서 photoId / title 을 추출해 새 템플릿에 매핑.
 */
export default function CoverTemplateDialog({
  open,
  onOpenChange,
  doc,
  bookSize,
  pageCount,
  onApply,
}: CoverTemplateDialogProps) {
  function applyTemplate(id: CoverTemplateId) {
    // 기존 표지에서 첫 photo 와 제목으로 추정되는 텍스트 추출
    const firstPhotoId =
      doc.objects.find((o) => o.type === "photo")?.type === "photo"
        ? (doc.objects.find((o) => o.type === "photo") as {
            photoId: string;
          }).photoId
        : doc.backgroundImage?.photoId;

    // 제목 후보: 가장 큰 fontSizePt 를 가진 텍스트
    let title = "";
    let maxPt = -Infinity;
    for (const obj of doc.objects) {
      if (obj.type === "text" && obj.text && obj.fontSizePt > maxPt) {
        maxPt = obj.fontSizePt;
        title = obj.text;
      }
    }

    const next = buildDefaultCoverDoc({
      bookSize,
      pageCount,
      title,
      templateId: id,
      photoId: firstPhotoId,
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
            "fixed left-1/2 top-1/2 z-50 w-[min(94vw,720px)] -translate-x-1/2 -translate-y-1/2",
            "rounded-xl border border-border bg-background p-5 shadow-soft-lg",
          )}
        >
          <div className="flex items-start justify-between gap-3 pb-3">
            <div>
              <DialogPrimitive.Title className="text-base font-semibold">
                표지 템플릿 선택
              </DialogPrimitive.Title>
              <DialogPrimitive.Description className="mt-1 text-sm text-muted-foreground">
                현재 사진과 제목은 가능한 보존됩니다.
              </DialogPrimitive.Description>
            </div>
            <DialogPrimitive.Close
              aria-label="닫기"
              className="-mt-1 inline-flex size-9 items-center justify-center rounded-md text-muted-foreground hover:bg-accent"
            >
              <X className="size-5" />
            </DialogPrimitive.Close>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3">
            {COVER_TEMPLATE_META.map((meta) => (
              <Button
                key={meta.id}
                type="button"
                variant="outline"
                onClick={() => applyTemplate(meta.id)}
                className="flex h-auto flex-col items-stretch gap-2 p-2"
              >
                <span
                  className="block w-full overflow-hidden rounded"
                  style={{ aspectRatio: "2 / 1" }}
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

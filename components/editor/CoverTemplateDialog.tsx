"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { useState } from "react";

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
  /**
   * 현재 cover PageDoc — 사진/제목을 가능하면 보존.
   * 미저장 편집도 반영되도록 호출자가 다이얼로그를 열기 전에
   * 라이브 캔버스를 serialize 해 최신 doc 를 넘겨야 한다.
   */
  doc: PageDoc;
  /** 책 사이즈 — 책등 두께 재계산용. */
  bookSize: BookSize;
  /** 페이지 수 — 책등 두께 재계산용. */
  pageCount: number;
  /** 새 cover PageDoc 으로 교체. */
  onApply: (next: PageDoc) => void;
}

/**
 * 현재 doc 에 "템플릿이 보존하지 못하는" 요소가 있는지.
 * 템플릿 적용은 첫 사진 1장 + 제목 텍스트 1개만 이어받으므로,
 * 그 외 요소(추가 사진·클립아트·직접 쓴 글)가 있으면 확인 단계를 거친다.
 */
function hasDiscardableContent(doc: PageDoc): boolean {
  let photoCount = 0;
  let clipartCount = 0;
  let filledTextCount = 0;
  for (const o of doc.objects) {
    if (o.type === "photo") photoCount += 1;
    else if (o.type === "clipart") clipartCount += 1;
    else if (o.type === "text" && o.text && o.text.trim().length > 0) {
      filledTextCount += 1;
    }
  }
  return photoCount > 1 || clipartCount > 0 || filledTextCount > 1;
}

/**
 * 표지 템플릿 선택 다이얼로그.
 *  - 적용 시 현재 doc 에서 photoId / title 을 추출해 새 템플릿에 매핑.
 *  - 보존 불가 요소가 있으면 즉시 적용하지 않고 확인 단계를 먼저 보여준다.
 */
export default function CoverTemplateDialog({
  open,
  onOpenChange,
  doc,
  bookSize,
  pageCount,
  onApply,
}: CoverTemplateDialogProps) {
  // 확인 대기 중인 템플릿 (보존 불가 요소가 있을 때만 사용).
  const [pendingId, setPendingId] = useState<CoverTemplateId | null>(null);

  function handleOpenChange(next: boolean) {
    if (!next) setPendingId(null);
    onOpenChange(next);
  }

  function doApply(id: CoverTemplateId) {
    // 기존 표지에서 첫 photo 와 제목으로 추정되는 텍스트 추출
    const firstPhoto = doc.objects.find((o) => o.type === "photo");
    const firstPhotoId =
      firstPhoto && firstPhoto.type === "photo"
        ? firstPhoto.photoId
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
    setPendingId(null);
    onApply(next);
    onOpenChange(false);
  }

  function requestApply(id: CoverTemplateId) {
    if (hasDiscardableContent(doc)) {
      setPendingId(id);
      return;
    }
    doApply(id);
  }

  const pendingLabel = pendingId
    ? COVER_TEMPLATE_META.find((m) => m.id === pendingId)?.label
    : null;

  return (
    <DialogPrimitive.Root open={open} onOpenChange={handleOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/50 backdrop-blur-[2px] data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          className={cn(
            "fixed left-1/2 top-1/2 z-50 w-[min(94vw,720px)] -translate-x-1/2 -translate-y-1/2",
            "max-h-[85dvh] overflow-y-auto",
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
              className="relative -mt-1 inline-flex size-9 items-center justify-center rounded-md text-muted-foreground after:absolute after:-inset-1 after:content-[''] hover:bg-accent"
            >
              <X className="size-5" />
            </DialogPrimitive.Close>
          </div>

          {pendingId ? (
            <div
              role="alertdialog"
              aria-label="템플릿 적용 확인"
              className="mb-3 rounded-lg border border-amber-300/60 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800/60 dark:bg-amber-950/40 dark:text-amber-200"
            >
              <p className="font-medium">
                {pendingLabel ? `'${pendingLabel}' 템플릿을 적용할까요?` : "템플릿을 적용할까요?"}
              </p>
              <p className="mt-1">
                첫 사진과 제목만 이어지고, 추가한 사진·클립아트·직접 쓴 글 등
                나머지 표지 요소는 삭제돼요.
              </p>
              <div className="mt-3 flex gap-2">
                <Button
                  size="sm"
                  variant="gradient"
                  onClick={() => doApply(pendingId)}
                >
                  적용하기
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setPendingId(null)}
                >
                  취소
                </Button>
              </div>
            </div>
          ) : null}

          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
            {COVER_TEMPLATE_META.map((meta) => (
              <Button
                key={meta.id}
                type="button"
                variant="outline"
                onClick={() => requestApply(meta.id)}
                className={cn(
                  "flex h-auto flex-col items-stretch gap-2 p-2",
                  pendingId === meta.id && "ring-2 ring-ring",
                )}
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

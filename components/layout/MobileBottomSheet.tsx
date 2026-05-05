"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * 모바일 바텀시트 껍데기.
 * Fabric 에디터 툴바·콜라주 모드 팔레트 등 상세 플로우에서 재사용한다.
 *
 * 사용 예:
 *   <MobileBottomSheet
 *     open={open}
 *     onOpenChange={setOpen}
 *     title="레이아웃 선택"
 *   >
 *     ...children...
 *   </MobileBottomSheet>
 */
export interface MobileBottomSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: React.ReactNode;
  description?: React.ReactNode;
  children?: React.ReactNode;
  /** 최대 높이 (예: '85dvh'). 기본 85dvh */
  maxHeight?: string;
  className?: string;
}

export function MobileBottomSheet({
  open,
  onOpenChange,
  title,
  description,
  children,
  maxHeight = "85dvh",
  className,
}: MobileBottomSheetProps) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          className={cn(
            "fixed inset-0 z-50 bg-black/50 backdrop-blur-[2px]",
            "data-[state=open]:animate-in data-[state=open]:fade-in-0",
            "data-[state=closed]:animate-out data-[state=closed]:fade-out-0",
          )}
        />
        <DialogPrimitive.Content
          style={{ maxHeight }}
          className={cn(
            "fixed inset-x-0 bottom-0 z-50 flex flex-col",
            "rounded-t-2xl border-t border-border bg-background shadow-soft-lg",
            "pb-[env(safe-area-inset-bottom)]",
            "data-[state=open]:animate-in data-[state=open]:slide-in-from-bottom",
            "data-[state=closed]:animate-out data-[state=closed]:slide-out-to-bottom",
            "duration-200 ease-out",
            className,
          )}
        >
          {/* grip */}
          <div className="flex justify-center pt-3" aria-hidden>
            <span className="h-1.5 w-10 rounded-full bg-muted-foreground/30" />
          </div>

          {/* 시각적 헤더 — 제목/설명 둘 중 하나라도 있을 때 표시 */}
          {(title || description) && (
            <div className="flex items-start justify-between gap-3 px-5 pb-2 pt-3">
              <div className="min-w-0">
                {title ? (
                  <DialogPrimitive.Title className="text-base font-semibold">
                    {title}
                  </DialogPrimitive.Title>
                ) : null}
                {description ? (
                  <DialogPrimitive.Description className="mt-1 text-sm text-muted-foreground">
                    {description}
                  </DialogPrimitive.Description>
                ) : null}
              </div>
              <DialogPrimitive.Close
                aria-label="닫기"
                className="-mt-1 inline-flex size-9 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <X className="size-5" />
              </DialogPrimitive.Close>
            </div>
          )}

          {/* 접근성 폴백 — Radix 는 DialogContent 에 Title/Description 이 없으면 경고를 낸다.
              호출자가 prop 을 안 줬을 때를 대비해 sr-only 로 보강. */}
          {!title ? (
            <DialogPrimitive.Title className="sr-only">
              메뉴
            </DialogPrimitive.Title>
          ) : null}
          {!description ? (
            <DialogPrimitive.Description className="sr-only">
              {title ? `${title} 옵션을 선택할 수 있어요.` : "옵션을 선택할 수 있어요."}
            </DialogPrimitive.Description>
          ) : null}

          <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5 pt-1">
            {children}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

export default MobileBottomSheet;

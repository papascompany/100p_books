"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { AlertTriangle, X } from "lucide-react";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * 사용중 리소스 삭제 시 띄우는 확인 다이얼로그.
 *
 * 흐름:
 *  - 부모는 우선 일반 DELETE 를 호출 → 409 RESOURCE_IN_USE 응답이 오면
 *    사용처 카운트와 함께 이 다이얼로그를 띄운다.
 *  - 사용자가 "비활성화" 선택 → onDeactivate 호출 (PATCH active=false 권장)
 *  - 사용자가 "강제 삭제" 선택 → onForceDelete 호출 (DELETE ?force=true)
 */

interface UsageInfo {
  usedInPages: number;
  usedInCovers: number;
}

export interface ResourceDeleteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  resourceName: string;
  usage: UsageInfo | null;
  busy?: boolean;
  onDeactivate?: () => void;
  onForceDelete: () => void;
}

export default function ResourceDeleteDialog({
  open,
  onOpenChange,
  resourceName,
  usage,
  busy,
  onDeactivate,
  onForceDelete,
}: ResourceDeleteDialogProps) {
  const total = usage ? usage.usedInPages + usage.usedInCovers : 0;
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          className={cn(
            "fixed inset-0 z-50 bg-black/40 backdrop-blur-sm",
            "data-[state=open]:animate-in data-[state=open]:fade-in-0",
            "data-[state=closed]:animate-out data-[state=closed]:fade-out-0",
          )}
        />
        <DialogPrimitive.Content
          className={cn(
            "fixed left-1/2 top-1/2 z-50 w-[92vw] max-w-md -translate-x-1/2 -translate-y-1/2",
            "rounded-xl border bg-card p-5 shadow-soft-lg",
            "data-[state=open]:animate-fade-in",
            "focus:outline-none",
          )}
        >
          <div className="flex items-start gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300">
              <AlertTriangle className="size-5" aria-hidden />
            </span>
            <div className="flex-1">
              <DialogPrimitive.Title className="text-base font-semibold">
                사용 중인 리소스 삭제
              </DialogPrimitive.Title>
              <DialogPrimitive.Description className="mt-1 text-sm text-muted-foreground">
                <span className="font-medium text-foreground">
                  &lsquo;{resourceName}&rsquo;
                </span>
                {total > 0 ? (
                  <>
                    은(는) 현재{" "}
                    {usage && usage.usedInPages > 0 ? (
                      <>
                        <strong>{usage.usedInPages}개 페이지</strong>
                      </>
                    ) : null}
                    {usage &&
                    usage.usedInPages > 0 &&
                    usage.usedInCovers > 0
                      ? ", "
                      : null}
                    {usage && usage.usedInCovers > 0 ? (
                      <>
                        <strong>{usage.usedInCovers}개 표지</strong>
                      </>
                    ) : null}
                    에서 사용 중입니다.
                  </>
                ) : (
                  <>은(는) 사용 중일 수 있습니다.</>
                )}{" "}
                강제 삭제 시 PDF 재생성 시 기본값으로 대체됩니다.
              </DialogPrimitive.Description>
            </div>
            <DialogPrimitive.Close
              aria-label="닫기"
              className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <X className="size-4" />
            </DialogPrimitive.Close>
          </div>

          <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-end">
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={busy}
            >
              취소
            </Button>
            {onDeactivate ? (
              <Button
                type="button"
                variant="outline"
                onClick={onDeactivate}
                disabled={busy}
              >
                비활성화 (권장)
              </Button>
            ) : null}
            <Button
              type="button"
              variant="destructive"
              onClick={onForceDelete}
              disabled={busy}
            >
              강제 삭제
            </Button>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

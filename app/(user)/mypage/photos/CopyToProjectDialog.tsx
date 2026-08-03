"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/use-toast";
import { cn } from "@/lib/utils";

import type { PhotoLibraryProject } from "./page";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedPhotoIds: string[];
  projects: PhotoLibraryProject[];
  /** 선택한 사진들이 이미 속한 프로젝트 id — 대상 목록에서 비활성 처리 (UP-16). */
  sourceProjectIds: string[];
  /** 복사 완료 콜백 — 정원 초과로 제외된 장수(skipped)도 함께 전달 (UP-13). */
  onDone: (insertedCount: number, skippedCount: number) => void;
}

/**
 * 선택한 사진들을 다른 프로젝트로 복사 — 프로젝트 셀렉터 다이얼로그.
 *  - storage 객체는 path 가 user_id prefix 동일하므로 admin.storage.copy 로 사본 생성.
 *  - photos 행은 새 photoId 로 INSERT.
 */
export default function CopyToProjectDialog({
  open,
  onOpenChange,
  selectedPhotoIds,
  projects,
  sourceProjectIds,
  onDone,
}: Props) {
  const { toast } = useToast();
  const [targetId, setTargetId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const sourceSet = new Set(sourceProjectIds);
  const hasSelectableTarget = projects.some((p) => !sourceSet.has(p.id));

  async function handleConfirm() {
    if (!targetId || selectedPhotoIds.length === 0) return;
    // 소스 프로젝트로의 복사(같은 프로젝트에 사본 중복) 방어
    if (sourceSet.has(targetId)) return;
    setBusy(true);
    try {
      const res = await fetch("/api/photos/copy-to-project", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          photoIds: selectedPhotoIds,
          targetProjectId: targetId,
        }),
      });
      const json = (await res.json()) as {
        ok: boolean;
        data?: { inserted: unknown[]; skipped: number };
        error?: { message?: string };
      };
      if (!res.ok || !json.ok) {
        throw new Error(json.error?.message ?? "복사 실패");
      }
      onDone(json.data?.inserted.length ?? 0, json.data?.skipped ?? 0);
    } catch (e) {
      toast({
        title: "복사 실패",
        description: e instanceof Error ? e.message : "알 수 없는 오류",
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  }

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
          <div className="flex items-start justify-between gap-3">
            <div>
              <DialogPrimitive.Title className="text-base font-semibold">
                다른 프로젝트에 추가
              </DialogPrimitive.Title>
              <DialogPrimitive.Description className="mt-1 text-sm text-muted-foreground">
                선택한 {selectedPhotoIds.length}장을 추가할 프로젝트를 골라
                주세요. 사진은 사본으로 들어가요.
              </DialogPrimitive.Description>
            </div>
            <DialogPrimitive.Close
              aria-label="닫기"
              className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <X className="size-4" />
            </DialogPrimitive.Close>
          </div>

          <div className="mt-4 max-h-[40vh] space-y-1 overflow-y-auto">
            {projects.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                대상 프로젝트가 없어요.
              </p>
            ) : (
              projects.map((p) => {
                const sel = targetId === p.id;
                const isSource = sourceSet.has(p.id);
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setTargetId(p.id)}
                    aria-pressed={sel}
                    disabled={isSource}
                    className={cn(
                      "block w-full rounded-md border px-3 py-2 text-left text-sm transition-colors",
                      sel
                        ? "border-rose-500 bg-rose-50/60 ring-1 ring-rose-300 dark:bg-rose-950/30"
                        : "border-input bg-background hover:bg-accent",
                      isSource &&
                        "cursor-not-allowed opacity-50 hover:bg-background",
                    )}
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span className="truncate">{p.title}</span>
                      {isSource ? (
                        <span className="shrink-0 text-xs text-muted-foreground">
                          사진이 담긴 프로젝트
                        </span>
                      ) : null}
                    </span>
                  </button>
                );
              })
            )}
          </div>

          {projects.length > 0 && !hasSelectableTarget ? (
            <p className="mt-2 text-xs text-muted-foreground" role="status">
              선택한 사진이 담긴 프로젝트뿐이에요. 다른 프로젝트를 먼저 만들어
              주세요.
            </p>
          ) : null}

          <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-end">
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={busy}
            >
              취소
            </Button>
            <Button
              type="button"
              onClick={handleConfirm}
              disabled={!targetId || busy || sourceSet.has(targetId)}
            >
              {busy ? "추가 중..." : "추가"}
            </Button>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { ImageOff, Loader2, Search, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/use-toast";
import { cn } from "@/lib/utils";

interface PhotoListItem {
  id: string;
  projectId: string;
  projectTitle: string;
  filename: string | null;
  thumbUrl: string | null;
  exifTakenAt: string | null;
  createdAt: string;
}

export interface PhotoPickerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 현재 작업중인 프로젝트 ID (scope=project 의 기본). */
  currentProjectId: string;
  /**
   * 사용자가 사진을 선택했을 때 콜백.
   *  - photoId: 최종 사진 id (현재 프로젝트로 복사된 새 photoId 가 될 수 있음)
   *  - url: 캔버스에 즉시 적용 가능한 signed URL.
   */
  onPick: (photoId: string, url: string) => void | Promise<void>;
  /** 다이얼로그 타이틀 (기본 — "사진 선택"). */
  title?: string;
  /** Description (기본 — "캔버스 객체에 적용할 사진을 선택하세요."). */
  description?: string;
}

type Scope = "project" | "library";

/**
 * 편집기 사진 선택 다이얼로그.
 *  - 기본: 현재 프로젝트 사진.
 *  - "다른 프로젝트에서 가져오기" 토글: 사용자 라이브러리 전체.
 *    - 라이브러리 사진 선택 시 자동으로 현재 프로젝트로 복사 → 새 photoId 반환.
 *  - 검색 (파일명 / 프로젝트명) 지원.
 */
export default function PhotoPickerDialog({
  open,
  onOpenChange,
  currentProjectId,
  onPick,
  title = "사진 선택",
  description = "캔버스 객체에 적용할 사진을 선택하세요.",
}: PhotoPickerDialogProps) {
  const { toast } = useToast();

  const [scope, setScope] = useState<Scope>("project");
  const [photos, setPhotos] = useState<PhotoListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [picking, setPicking] = useState<string | null>(null);

  // 사진 로드
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);

    (async () => {
      try {
        const params = new URLSearchParams({ scope });
        if (scope === "project") {
          params.set("projectId", currentProjectId);
        }
        const res = await fetch(`/api/photos/list?${params.toString()}`);
        const json = (await res.json()) as {
          ok: boolean;
          data?: { photos: PhotoListItem[] };
          error?: { message?: string };
        };
        if (!res.ok || !json.ok) {
          throw new Error(json.error?.message ?? "사진 목록을 가져오지 못했어요.");
        }
        if (!cancelled) setPhotos(json.data?.photos ?? []);
      } catch (e) {
        if (!cancelled) {
          toast({
            title: "사진 목록 로드 실패",
            description: e instanceof Error ? e.message : "알 수 없는 오류",
            variant: "destructive",
          });
          setPhotos([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, scope, currentProjectId, toast]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return photos;
    return photos.filter((p) => {
      const fn = (p.filename ?? "").toLowerCase();
      const pt = p.projectTitle.toLowerCase();
      return fn.includes(q) || pt.includes(q);
    });
  }, [photos, query]);

  async function handlePick(p: PhotoListItem) {
    setPicking(p.id);
    try {
      let finalId = p.id;
      let finalUrl = p.thumbUrl ?? "";

      // 라이브러리에서 다른 프로젝트 사진을 골랐다면 현재 프로젝트로 복사.
      if (p.projectId !== currentProjectId) {
        const res = await fetch("/api/photos/copy-to-project", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            photoIds: [p.id],
            targetProjectId: currentProjectId,
          }),
        });
        const json = (await res.json()) as {
          ok: boolean;
          data?: {
            inserted: Array<{ id: string; thumb_key: string | null }>;
          };
          error?: { message?: string };
        };
        if (!res.ok || !json.ok) {
          throw new Error(json.error?.message ?? "사진 가져오기 실패");
        }
        const inserted = json.data?.inserted?.[0];
        if (!inserted) {
          throw new Error("사진 복사 결과가 비어 있어요.");
        }
        finalId = inserted.id;

        // 새 thumb signed URL 발급 — list API 재호출이 비싸므로 원본 URL 재사용.
        // photo-library 가 storage 객체를 복사했지만 signed URL 도메인은 같은 thumb_key 라
        // 기존 url 이 만료 전이면 그대로 쓸 수 있다. 단, key 가 다르므로 새 URL 필요 — 별도 발급.
        const refreshRes = await fetch(
          `/api/photos/list?scope=project&projectId=${encodeURIComponent(currentProjectId)}`,
        );
        const refreshJson = (await refreshRes.json()) as {
          ok: boolean;
          data?: { photos: PhotoListItem[] };
        };
        if (refreshRes.ok && refreshJson.ok) {
          const refreshed = (refreshJson.data?.photos ?? []).find(
            (x) => x.id === finalId,
          );
          if (refreshed?.thumbUrl) finalUrl = refreshed.thumbUrl;
        }
      }

      if (!finalUrl) {
        throw new Error("사진 URL 을 가져오지 못했어요.");
      }
      await onPick(finalId, finalUrl);
      onOpenChange(false);
    } catch (e) {
      toast({
        title: "사진 적용 실패",
        description: e instanceof Error ? e.message : "알 수 없는 오류",
        variant: "destructive",
      });
    } finally {
      setPicking(null);
    }
  }

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
          className={cn(
            "fixed left-1/2 top-1/2 z-50 w-[min(94vw,720px)] -translate-x-1/2 -translate-y-1/2",
            "max-h-[85vh] overflow-hidden rounded-xl border bg-background shadow-soft-lg",
            "data-[state=open]:animate-fade-in",
            "focus:outline-none flex flex-col",
          )}
        >
          <div className="flex items-start justify-between gap-3 border-b p-4">
            <div>
              <DialogPrimitive.Title className="text-base font-semibold">
                {title}
              </DialogPrimitive.Title>
              <DialogPrimitive.Description className="mt-1 text-sm text-muted-foreground">
                {description}
              </DialogPrimitive.Description>
            </div>
            <DialogPrimitive.Close
              aria-label="닫기"
              className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <X className="size-4" />
            </DialogPrimitive.Close>
          </div>

          <div className="flex flex-wrap items-center gap-2 border-b p-3">
            <div className="inline-flex rounded-md border bg-muted p-0.5">
              <button
                type="button"
                onClick={() => setScope("project")}
                className={cn(
                  "rounded-[5px] px-3 py-1 text-xs font-medium transition-colors",
                  scope === "project"
                    ? "bg-background shadow"
                    : "text-muted-foreground",
                )}
              >
                현재 프로젝트
              </button>
              <button
                type="button"
                onClick={() => setScope("library")}
                className={cn(
                  "rounded-[5px] px-3 py-1 text-xs font-medium transition-colors",
                  scope === "library"
                    ? "bg-background shadow"
                    : "text-muted-foreground",
                )}
              >
                전체 라이브러리
              </button>
            </div>

            <label className="relative ml-auto min-w-[12rem] flex-1 sm:max-w-[18rem]">
              <Search
                className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <Input
                type="search"
                placeholder="파일명·프로젝트명 검색"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="h-9 pl-8 text-sm"
              />
            </label>
          </div>

          <div className="flex-1 overflow-y-auto p-3">
            {loading ? (
              <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
                <Loader2 className="mr-2 size-4 animate-spin" aria-hidden />
                불러오는 중...
              </div>
            ) : filtered.length === 0 ? (
              <div className="rounded-xl border border-dashed bg-muted/30 p-8 text-center text-sm text-muted-foreground">
                {photos.length === 0
                  ? scope === "project"
                    ? "이 프로젝트에 사진이 없어요. 라이브러리에서 가져와 보세요."
                    : "라이브러리에 사진이 없어요."
                  : "조건에 맞는 사진이 없어요."}
              </div>
            ) : (
              <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5">
                {filtered.map((p) => {
                  const isPicking = picking === p.id;
                  const isCrossProject = p.projectId !== currentProjectId;
                  return (
                    <li key={p.id}>
                      <button
                        type="button"
                        onClick={() => void handlePick(p)}
                        disabled={isPicking}
                        className={cn(
                          "group relative block w-full overflow-hidden rounded-lg border bg-card text-left shadow-soft transition-all",
                          "hover:border-foreground/30",
                          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                          "disabled:opacity-60",
                        )}
                      >
                        <div className="relative aspect-square w-full bg-muted">
                          {p.thumbUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={p.thumbUrl}
                              alt={p.filename ?? "사진"}
                              loading="lazy"
                              className="h-full w-full object-cover"
                            />
                          ) : (
                            <div className="flex h-full w-full items-center justify-center text-muted-foreground">
                              <ImageOff className="size-6" aria-hidden />
                            </div>
                          )}
                          {isPicking ? (
                            <div className="absolute inset-0 flex items-center justify-center bg-black/40 text-white">
                              <Loader2 className="size-5 animate-spin" />
                            </div>
                          ) : null}
                        </div>
                        <div className="px-2 py-1.5">
                          <p
                            className="truncate text-[11px] font-medium"
                            title={p.filename ?? ""}
                          >
                            {p.filename ?? "(이름 없음)"}
                          </p>
                          {isCrossProject ? (
                            <p
                              className="truncate text-[10px] text-muted-foreground"
                              title={p.projectTitle}
                            >
                              {p.projectTitle}
                            </p>
                          ) : null}
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <div className="flex justify-end border-t p-3">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => onOpenChange(false)}
            >
              닫기
            </Button>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

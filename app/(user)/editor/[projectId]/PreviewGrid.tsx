"use client";

import { MoreVertical, Pencil, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";

import PagePreview from "./PagePreview";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "@/components/ui/use-toast";
import type { BookSize } from "@/lib/db/types";
import type { PageDoc } from "@/lib/layout/types";
import { cn } from "@/lib/utils";

export interface PageSummary {
  id: string;
  pageNo: number;
  layoutMode: "polaroid" | "collage";
  fabricJson: PageDoc | null;
}

export interface PreviewGridProps {
  projectId: string;
  pages: PageSummary[];
  photoUrls: Record<string, string>;
  loading: boolean;
  bookSize: BookSize | null;
  /** 페이지 순서가 바뀌었을 때 — pageIds 는 새 순서. */
  onReorder?: (pageIds: string[]) => Promise<void> | void;
  /** afterPageNo 다음에 페이지 추가. afterPageNo === 0 이면 맨 앞 (실제로 1번 자리). */
  onInsert?: (afterPageNo: number) => Promise<void> | void;
  /** 페이지 삭제. */
  onDelete?: (pageId: string) => Promise<void> | void;
  /** 진행 중 비활성화 플래그. */
  busy?: boolean;
}

/**
 * 썸네일 그리드 (모바일 2 / sm 3 / md 4 / lg 5 열).
 *
 * 기능:
 *  - 카드 클릭/Enter → /editor/[projectId]/pages/[pageId] 로 이동.
 *  - 드래그&드롭 reorder (Pointer Events). 모바일은 long-press 500ms 후 시작.
 *  - 카드 우상단 ⋯ 메뉴: "이 페이지 다음에 추가" / "삭제" / "복제는 X" — 단순.
 *  - 마지막 카드: "+" 빈 카드. 클릭 시 onInsert(maxPageNo).
 *  - 키보드: 카드에 포커스 후 Backspace/Delete → 삭제 confirm.
 */
export default function PreviewGrid({
  projectId,
  pages,
  photoUrls,
  loading,
  bookSize,
  onReorder,
  onInsert,
  onDelete,
  busy,
}: PreviewGridProps) {
  // 카드 폭을 컨테이너 사이즈 기반으로 측정 → PagePreview 에 전달
  const gridRef = useRef<HTMLDivElement>(null);
  const [colWidth, setColWidth] = useState(180);

  // ---------- DnD 상태 ----------
  const [orderedPages, setOrderedPages] = useState<PageSummary[]>(pages);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pointerStartRef = useRef<{ x: number; y: number } | null>(null);

  // 외부 pages 가 갱신되면 동기화 (refresh 후)
  useEffect(() => {
    setOrderedPages(pages);
    setDraggingId(null);
    setOverIndex(null);
  }, [pages]);

  useEffect(() => {
    const el = gridRef.current;
    if (!el) return;
    const measure = () => {
      const first = el.querySelector<HTMLElement>("[data-preview-cell]");
      if (first) {
        const w = first.getBoundingClientRect().width;
        if (w > 40) setColWidth(Math.round(w));
      }
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [orderedPages.length]);

  const beginDrag = useCallback((id: string) => {
    setDraggingId(id);
    if (typeof navigator !== "undefined" && "vibrate" in navigator) {
      try {
        (navigator as Navigator & { vibrate: (n: number) => void }).vibrate(20);
      } catch {
        // ignore
      }
    }
  }, []);

  // pointer events 기반 long-press + drag
  const onCardPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>, id: string) => {
      if (busy) return;
      // 마우스: 즉시 드래그(좌클릭만)
      if (e.pointerType === "mouse") {
        if (e.button !== 0) return;
        // delay until move threshold to avoid blocking link click
        pointerStartRef.current = { x: e.clientX, y: e.clientY };
        return;
      }
      // 터치/펜: 500ms long-press 후 드래그 시작
      pointerStartRef.current = { x: e.clientX, y: e.clientY };
      if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = setTimeout(() => {
        beginDrag(id);
      }, 500);
    },
    [busy, beginDrag],
  );

  const onCardPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>, id: string) => {
      if (!pointerStartRef.current) return;
      const dx = e.clientX - pointerStartRef.current.x;
      const dy = e.clientY - pointerStartRef.current.y;
      const dist = Math.hypot(dx, dy);
      // 8px 이상 움직이면 long-press 취소
      if (dist > 8 && longPressTimerRef.current) {
        clearTimeout(longPressTimerRef.current);
        longPressTimerRef.current = null;
        // 마우스라면 즉시 드래그 시작
        if (e.pointerType === "mouse" && !draggingId) {
          beginDrag(id);
        }
      }
    },
    [draggingId, beginDrag],
  );

  const onCardPointerUp = useCallback(() => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    pointerStartRef.current = null;
  }, []);

  // global pointermove for active drag
  useEffect(() => {
    if (!draggingId) return;
    function findCellIndex(clientX: number, clientY: number): number | null {
      const el = gridRef.current;
      if (!el) return null;
      const cells = el.querySelectorAll<HTMLElement>("[data-preview-cell]");
      for (let i = 0; i < cells.length; i++) {
        const rect = cells[i]!.getBoundingClientRect();
        if (
          clientX >= rect.left &&
          clientX <= rect.right &&
          clientY >= rect.top &&
          clientY <= rect.bottom
        ) {
          return i;
        }
      }
      return null;
    }

    function onMove(e: PointerEvent) {
      const idx = findCellIndex(e.clientX, e.clientY);
      setOverIndex(idx);
    }
    async function onUp() {
      const idx = overIndex;
      const id = draggingId;
      setDraggingId(null);
      setOverIndex(null);
      if (id == null || idx == null) return;
      const fromIdx = orderedPages.findIndex((p) => p.id === id);
      if (fromIdx === idx || fromIdx < 0) return;
      const next = [...orderedPages];
      const [moved] = next.splice(fromIdx, 1);
      if (!moved) return;
      next.splice(idx, 0, moved);
      // 낙관적 업데이트
      setOrderedPages(next);
      try {
        await onReorder?.(next.map((p) => p.id));
      } catch (e) {
        // 롤백
        setOrderedPages(orderedPages);
        toast({
          description:
            e instanceof Error ? e.message : "순서 변경에 실패했어요.",
          variant: "destructive",
        });
      }
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
    window.addEventListener("pointercancel", onUp, { once: true });
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draggingId, overIndex, orderedPages]);

  // ---------- 삭제 ----------
  const [deleteCandidate, setDeleteCandidate] = useState<PageSummary | null>(
    null,
  );

  const confirmDelete = useCallback(async () => {
    if (!deleteCandidate || !onDelete) return;
    const target = deleteCandidate;
    setDeleteCandidate(null);
    try {
      await onDelete(target.id);
      toast({
        description: `페이지 ${target.pageNo} 을(를) 삭제했어요.`,
        variant: "success",
      });
    } catch (e) {
      toast({
        description: e instanceof Error ? e.message : "삭제에 실패했어요.",
        variant: "destructive",
      });
    }
  }, [deleteCandidate, onDelete]);

  // 키보드: 카드에 포커스 시 Backspace/Delete → 삭제
  const onCardKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>, p: PageSummary) => {
      if ((e.key === "Backspace" || e.key === "Delete") && onDelete) {
        e.preventDefault();
        setDeleteCandidate(p);
      }
    },
    [onDelete],
  );

  if (loading) {
    return (
      <div
        className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5"
        aria-busy="true"
      >
        {Array.from({ length: 8 }).map((_, i) => (
          <div
            key={i}
            className="aspect-[3/4] animate-pulse rounded-md bg-muted/60"
          />
        ))}
      </div>
    );
  }

  // 빈 상태 — 자동 편집 안내 + 빈 페이지 추가 버튼
  if (orderedPages.length === 0) {
    return (
      <div className="rounded-xl border border-dashed bg-white/40 p-10 text-center dark:bg-white/[0.03]">
        <p className="text-base text-muted-foreground">
          아직 생성된 페이지가 없어요.
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          위에서 <span className="font-medium text-foreground">자동 편집하기</span>를
          눌러 시작하거나 빈 페이지를 추가해보세요.
        </p>
        {onInsert ? (
          <button
            type="button"
            onClick={() => void onInsert(0)}
            disabled={busy}
            className={cn(
              "mt-4 inline-flex items-center gap-1.5 rounded-md border border-input bg-background px-3 py-2 text-sm font-medium",
              "transition-colors hover:bg-accent hover:text-accent-foreground",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              "disabled:opacity-50",
            )}
          >
            <Plus className="size-4" aria-hidden /> 빈 페이지 추가
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <>
      <div
        ref={gridRef}
        className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5"
        role="list"
        aria-label="페이지 목록 — 길게 누르면 순서를 바꿀 수 있어요."
      >
        {orderedPages.map((p, i) => {
          const doc = p.fabricJson;
          const aspect = doc
            ? doc.widthMm / doc.heightMm
            : bookSize
              ? bookSize.width_mm / bookSize.height_mm
              : 1;
          const isDragging = draggingId === p.id;
          const isDropTarget = overIndex === i && draggingId && draggingId !== p.id;
          return (
            <div
              key={p.id}
              data-preview-cell
              role="listitem"
              tabIndex={0}
              onKeyDown={(e) => onCardKeyDown(e, p)}
              onPointerDown={(e) => onCardPointerDown(e, p.id)}
              onPointerMove={(e) => onCardPointerMove(e, p.id)}
              onPointerUp={onCardPointerUp}
              onPointerCancel={onCardPointerUp}
              className={cn(
                "group relative touch-none focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                isDragging && "z-30 scale-105 opacity-80 shadow-soft-lg",
                isDropTarget && "ring-2 ring-primary/70",
                "transition-transform",
              )}
              style={{ aspectRatio: aspect }}
              aria-label={`페이지 ${p.pageNo}, ${p.layoutMode === "polaroid" ? "폴라로이드" : "콜라주"}`}
              aria-grabbed={isDragging}
            >
              <div className="absolute inset-0 overflow-hidden rounded-md bg-white shadow-soft ring-1 ring-black/5">
                {doc ? (
                  <PagePreview
                    doc={doc}
                    photoUrls={photoUrls}
                    cardWidthPx={colWidth}
                  />
                ) : (
                  <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
                    빈 페이지
                  </div>
                )}
              </div>

              {/* 페이지 번호 배지 */}
              <span
                aria-hidden
                className="absolute left-1.5 top-1.5 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white"
              >
                p.{p.pageNo}
              </span>

              {/* 컨텍스트 메뉴 (⋯) */}
              {!isDragging ? (
                <div className="absolute right-1.5 top-1.5 z-10">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        aria-label={`페이지 ${p.pageNo} 옵션`}
                        onPointerDown={(e) => e.stopPropagation()}
                        className={cn(
                          "inline-flex size-8 items-center justify-center rounded-md bg-black/55 text-white",
                          "opacity-0 transition-opacity",
                          "group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100",
                          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        )}
                      >
                        <MoreVertical className="size-4" aria-hidden />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        onSelect={() => void onInsert?.(p.pageNo)}
                        disabled={busy || !onInsert}
                      >
                        <Plus className="mr-2 size-4" /> 이 페이지 다음에 추가
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        onSelect={() => setDeleteCandidate(p)}
                        disabled={busy || !onDelete}
                        className="text-destructive focus:text-destructive"
                      >
                        <Trash2 className="mr-2 size-4" /> 삭제
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              ) : null}

              {/* 편집 오버레이 — 드래그 중엔 비활성 */}
              {!isDragging ? (
                <Link
                  href={`/editor/${projectId}/pages/${p.id}`}
                  draggable={false}
                  onPointerDown={(e) => {
                    // 카드 부모의 long-press 와 충돌 방지 — 마우스/터치 모두 부모에서 처리됨.
                    if (e.pointerType !== "mouse") {
                      // 모바일에서는 부모의 long-press 가 이미 동작 중. 단, 짧은 탭은 link 가 살아있도록.
                    }
                  }}
                  className={cn(
                    "absolute inset-0 flex items-center justify-center rounded-md bg-black/0 opacity-0 transition-opacity",
                    "focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    "group-hover:bg-black/30 group-hover:opacity-100",
                  )}
                  aria-label={`페이지 ${p.pageNo} 편집`}
                >
                  <span className="inline-flex items-center gap-1 rounded-md bg-white/90 px-2 py-1 text-xs font-medium text-foreground shadow-soft">
                    <Pencil className="size-3" aria-hidden /> 편집
                  </span>
                </Link>
              ) : null}
            </div>
          );
        })}

        {/* 추가 카드 — 마지막 위치 */}
        {onInsert ? (
          <button
            type="button"
            onClick={() => void onInsert(orderedPages[orderedPages.length - 1]?.pageNo ?? 0)}
            disabled={busy}
            data-preview-cell
            className={cn(
              "flex flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed border-border bg-white/40 dark:bg-white/[0.03]",
              "text-muted-foreground transition-colors",
              "hover:border-primary/60 hover:text-primary",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              "disabled:opacity-50",
            )}
            style={{
              aspectRatio: bookSize ? bookSize.width_mm / bookSize.height_mm : 1,
            }}
            aria-label="새 페이지 추가"
          >
            <Plus className="size-7" aria-hidden />
            <span className="text-xs font-medium">새 페이지 추가</span>
          </button>
        ) : null}
      </div>

      {/* 삭제 confirm 다이얼로그 — 단순 prompt */}
      {deleteCandidate ? (
        <DeleteDialog
          page={deleteCandidate}
          onCancel={() => setDeleteCandidate(null)}
          onConfirm={() => void confirmDelete()}
        />
      ) : null}
    </>
  );
}

// =====================================================================
// 삭제 confirm — 가벼운 모달 (Radix Dialog 대신 div + portal-less)
// =====================================================================
function DeleteDialog({
  page,
  onCancel,
  onConfirm,
}: {
  page: PageSummary;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  // ESC 닫기
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-page-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-[2px]"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div className="w-[min(92vw,420px)] rounded-xl border bg-background p-5 shadow-soft-lg">
        <h2 id="delete-page-title" className="text-base font-semibold">
          페이지 {page.pageNo} 을(를) 삭제할까요?
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          이 동작은 되돌릴 수 없어요. 페이지의 모든 편집 내용이 함께 사라집니다.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="inline-flex h-9 items-center justify-center rounded-md px-3 text-sm font-medium text-muted-foreground hover:bg-accent"
          >
            취소
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="inline-flex h-9 items-center justify-center rounded-md bg-destructive px-3 text-sm font-medium text-destructive-foreground hover:bg-destructive/90"
          >
            삭제
          </button>
        </div>
      </div>
    </div>
  );
}

"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Eye, MoreVertical, Pencil, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";

import PagePreview from "./PagePreview";
import PagePreviewDialog from "@/components/editor/PagePreviewDialog";
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

/** 드래그 중 뷰포트 상/하단 이 거리(px) 안에 들어오면 오토스크롤. */
const AUTOSCROLL_EDGE_PX = 64;
/** 오토스크롤 프레임당 최대 이동량(px). */
const AUTOSCROLL_MAX_STEP_PX = 20;

/**
 * 썸네일 그리드 (모바일 2 / sm 3 / md 4 / lg 5 열).
 *
 * 기능:
 *  - 카드 클릭/Enter/Space → /editor/[projectId]/pages/[pageId] 로 이동.
 *  - 드래그&드롭 reorder (Pointer Events). 모바일은 long-press 500ms 후 시작.
 *    - 평상시 카드 위 터치는 세로 스크롤 허용(touch-action: pan-y),
 *      드래그 활성 중에만 스크롤 차단(touch-action: none + touchmove preventDefault).
 *    - 드래그 중 뷰포트 경계 근접 시 오토스크롤로 장거리 이동 지원.
 *  - 카드 우상단 ⋯ 메뉴: "미리보기" / "이 페이지 다음에 추가" / "삭제".
 *    터치(hover 미지원) 환경에서는 상시 노출.
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
  const router = useRouter();

  // 카드 폭을 컨테이너 사이즈 기반으로 측정 → PagePreview 에 전달
  const gridRef = useRef<HTMLDivElement>(null);
  const [colWidth, setColWidth] = useState(180);

  // ---------- DnD 상태 ----------
  const [orderedPages, setOrderedPages] = useState<PageSummary[]>(pages);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pointerStartRef = useRef<{ x: number; y: number } | null>(null);
  // 이벤트 핸들러에서 최신값을 읽기 위한 렌더 미러 ref —
  // 드래그 effect 가 overIndex/orderedPages 를 deps 로 갖지 않게 해
  // pointermove 마다 리스너·rAF 루프가 재구독되는 것을 막는다.
  const overIndexRef = useRef<number | null>(null);
  const orderedPagesRef = useRef<PageSummary[]>(pages);
  orderedPagesRef.current = orderedPages;

  // 외부 pages 가 갱신되면 동기화 (refresh 후)
  useEffect(() => {
    setOrderedPages(pages);
    setDraggingId(null);
    setOverIndex(null);
    overIndexRef.current = null;
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
      }
      // 마우스라면 이동 임계 초과 시 즉시 드래그 시작
      if (dist > 8 && e.pointerType === "mouse" && !draggingId) {
        beginDrag(id);
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

  // long-press(드래그 대기/진행) 중에만 네이티브 컨텍스트 메뉴 차단 —
  // iOS 링크 프리뷰/Android long-press 메뉴가 드래그 시작을 가로채는 것 방지.
  // 데스크톱 우클릭은 pointerStartRef 가 세팅되지 않으므로(button!==0) 그대로 동작.
  const onCardContextMenu = useCallback((e: ReactMouseEvent<HTMLDivElement>) => {
    if (pointerStartRef.current || longPressTimerRef.current) {
      e.preventDefault();
    }
  }, []);

  // global pointermove for active drag — 오토스크롤 포함.
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

    function applyOver(clientX: number, clientY: number) {
      const idx = findCellIndex(clientX, clientY);
      overIndexRef.current = idx;
      setOverIndex(idx);
    }

    // ----- 엣지 오토스크롤 (rAF 루프) -----
    let lastX = 0;
    let lastY = 0;
    let scrollStep = 0; // px/frame — 음수면 위로.
    let rafId: number | null = null;

    function scrollLoop() {
      if (scrollStep === 0) {
        rafId = null;
        return;
      }
      window.scrollBy(0, scrollStep);
      // 스크롤로 셀들이 포인터 아래를 지나가므로 드롭 타깃 재계산.
      applyOver(lastX, lastY);
      rafId = requestAnimationFrame(scrollLoop);
    }

    function onMove(e: PointerEvent) {
      lastX = e.clientX;
      lastY = e.clientY;
      applyOver(e.clientX, e.clientY);

      const vh = window.innerHeight;
      if (e.clientY < AUTOSCROLL_EDGE_PX) {
        scrollStep = -Math.ceil(
          ((AUTOSCROLL_EDGE_PX - e.clientY) / AUTOSCROLL_EDGE_PX) *
            AUTOSCROLL_MAX_STEP_PX,
        );
      } else if (e.clientY > vh - AUTOSCROLL_EDGE_PX) {
        scrollStep = Math.ceil(
          ((e.clientY - (vh - AUTOSCROLL_EDGE_PX)) / AUTOSCROLL_EDGE_PX) *
            AUTOSCROLL_MAX_STEP_PX,
        );
      } else {
        scrollStep = 0;
      }
      if (scrollStep !== 0 && rafId == null) {
        rafId = requestAnimationFrame(scrollLoop);
      }
    }

    // 드래그 중 브라우저 스크롤 개시 차단 — 평상시엔 pan-y 로 스크롤 허용하되
    // 드래그가 시작된 뒤의 터치 이동은 페이지 스크롤로 새지 않게 한다.
    function preventTouchScroll(e: TouchEvent) {
      e.preventDefault();
    }

    async function onUp() {
      scrollStep = 0;
      const idx = overIndexRef.current;
      const id = draggingId;
      setDraggingId(null);
      setOverIndex(null);
      overIndexRef.current = null;
      if (id == null || idx == null) return;
      const current = orderedPagesRef.current;
      const fromIdx = current.findIndex((p) => p.id === id);
      if (fromIdx === idx || fromIdx < 0) return;
      const next = [...current];
      const [moved] = next.splice(fromIdx, 1);
      if (!moved) return;
      next.splice(idx, 0, moved);
      // 낙관적 업데이트
      setOrderedPages(next);
      try {
        await onReorder?.(next.map((p) => p.id));
      } catch (e) {
        // 롤백
        setOrderedPages(current);
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
    window.addEventListener("touchmove", preventTouchScroll, {
      passive: false,
    });
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      window.removeEventListener("touchmove", preventTouchScroll);
      if (rafId != null) cancelAnimationFrame(rafId);
    };
  }, [draggingId, onReorder]);

  // ---------- 삭제 / 미리보기 ----------
  const [deleteCandidate, setDeleteCandidate] = useState<PageSummary | null>(
    null,
  );
  const [previewCandidate, setPreviewCandidate] = useState<PageSummary | null>(
    null,
  );

  const confirmDelete = useCallback(async () => {
    if (!deleteCandidate || !onDelete) return;
    const target = deleteCandidate;
    setDeleteCandidate(null);
    try {
      await onDelete(target.id);
      toast({
        description: `${target.pageNo}페이지를 삭제했어요.`,
        variant: "success",
      });
    } catch (e) {
      toast({
        description: e instanceof Error ? e.message : "삭제에 실패했어요.",
        variant: "destructive",
      });
    }
  }, [deleteCandidate, onDelete]);

  // 키보드: 카드 자체에 포커스 시 Enter/Space → 편집 이동, Backspace/Delete → 삭제.
  // 내부 버튼/링크에서 버블된 키 입력은 무시.
  const onCardKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLDivElement>, p: PageSummary) => {
      if (e.target !== e.currentTarget) return;
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        router.push(`/editor/${projectId}/pages/${p.id}`);
        return;
      }
      if ((e.key === "Backspace" || e.key === "Delete") && onDelete) {
        e.preventDefault();
        setDeleteCandidate(p);
      }
    },
    [onDelete, projectId, router],
  );

  const handleInsertAfter = useCallback(
    (pageNo: number) => {
      void onInsert?.(pageNo);
    },
    [onInsert],
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
      {/* 드래그 reorder 시각 안내 — aria-label 만으로는 발견이 어려움 */}
      <p className="text-xs text-muted-foreground">
        카드를 길게 누르면(마우스는 드래그) 순서를 바꿀 수 있어요.
      </p>
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
          return (
            <PreviewCell
              key={p.id}
              page={p}
              projectId={projectId}
              aspect={aspect}
              colWidth={colWidth}
              photoUrls={photoUrls}
              isDragging={draggingId === p.id}
              isDropTarget={
                overIndex === i && Boolean(draggingId) && draggingId !== p.id
              }
              dragActive={Boolean(draggingId)}
              busy={busy}
              canInsert={Boolean(onInsert)}
              canDelete={Boolean(onDelete)}
              onKeyDown={onCardKeyDown}
              onPointerDown={onCardPointerDown}
              onPointerMove={onCardPointerMove}
              onPointerUp={onCardPointerUp}
              onContextMenu={onCardContextMenu}
              onPreview={setPreviewCandidate}
              onInsertAfter={handleInsertAfter}
              onRequestDelete={setDeleteCandidate}
            />
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

      {/* 삭제 confirm 다이얼로그 */}
      {deleteCandidate ? (
        <DeleteDialog
          page={deleteCandidate}
          onCancel={() => setDeleteCandidate(null)}
          onConfirm={() => void confirmDelete()}
        />
      ) : null}

      {/* 페이지 미리보기 다이얼로그 */}
      {previewCandidate ? (
        <PagePreviewDialog
          pageId={previewCandidate.id}
          pageNo={previewCandidate.pageNo}
          open={Boolean(previewCandidate)}
          onOpenChange={(o) => {
            if (!o) setPreviewCandidate(null);
          }}
          trimGuide={
            previewCandidate.fabricJson
              ? {
                  widthMm: previewCandidate.fabricJson.widthMm,
                  heightMm: previewCandidate.fabricJson.heightMm,
                  bleedMm: previewCandidate.fabricJson.bleedMm,
                }
              : null
          }
        />
      ) : null}
    </>
  );
}

// =====================================================================
// 개별 카드 셀 — memo 로 드래그 중 리렌더를 드롭 타깃 변경 셀로 한정
// =====================================================================
interface PreviewCellProps {
  page: PageSummary;
  projectId: string;
  aspect: number;
  colWidth: number;
  photoUrls: Record<string, string>;
  isDragging: boolean;
  isDropTarget: boolean;
  /** 그리드 어딘가에서 드래그 진행 중 (touch-action 전환용). */
  dragActive: boolean;
  busy?: boolean;
  canInsert: boolean;
  canDelete: boolean;
  onKeyDown: (e: ReactKeyboardEvent<HTMLDivElement>, p: PageSummary) => void;
  onPointerDown: (e: ReactPointerEvent<HTMLDivElement>, id: string) => void;
  onPointerMove: (e: ReactPointerEvent<HTMLDivElement>, id: string) => void;
  onPointerUp: () => void;
  onContextMenu: (e: ReactMouseEvent<HTMLDivElement>) => void;
  onPreview: (p: PageSummary) => void;
  onInsertAfter: (pageNo: number) => void;
  onRequestDelete: (p: PageSummary) => void;
}

const PreviewCell = memo(function PreviewCell({
  page: p,
  projectId,
  aspect,
  colWidth,
  photoUrls,
  isDragging,
  isDropTarget,
  dragActive,
  busy,
  canInsert,
  canDelete,
  onKeyDown,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onContextMenu,
  onPreview,
  onInsertAfter,
  onRequestDelete,
}: PreviewCellProps) {
  const doc = p.fabricJson;
  return (
    <div
      data-preview-cell
      role="listitem"
      tabIndex={0}
      onKeyDown={(e) => onKeyDown(e, p)}
      onPointerDown={(e) => onPointerDown(e, p.id)}
      onPointerMove={(e) => onPointerMove(e, p.id)}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onContextMenu={onContextMenu}
      className={cn(
        // select-none + touch-callout 억제 — long-press 드래그가 iOS 링크
        // 프리뷰/Android 컨텍스트 메뉴·텍스트 선택과 경합하지 않게.
        "group relative select-none [-webkit-touch-callout:none] focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        isDragging && "z-30 scale-105 opacity-80 shadow-soft-lg",
        isDropTarget && "ring-2 ring-primary/70",
        "transition-transform",
      )}
      style={{
        aspectRatio: aspect,
        // 평상시엔 세로 스크롤 허용, 드래그 중에만 터치 제스처 차단.
        touchAction: dragActive ? "none" : "pan-y",
      }}
      aria-label={`페이지 ${p.pageNo}, ${p.layoutMode === "polaroid" ? "폴라로이드" : "콜라주"}`}
      aria-grabbed={isDragging}
    >
      <div className="absolute inset-0 overflow-hidden rounded-md bg-card shadow-soft ring-1 ring-black/5">
        {doc ? (
          <PagePreview doc={doc} photoUrls={photoUrls} cardWidthPx={colWidth} />
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

      {/* 컨텍스트 메뉴 (⋯) — hover 미지원(터치) 환경에서는 상시 노출 + 44px 타깃 */}
      {!isDragging ? (
        <div className="absolute right-1 top-1 z-10">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label={`페이지 ${p.pageNo} 옵션`}
                onPointerDown={(e) => e.stopPropagation()}
                className={cn(
                  "inline-flex size-11 items-center justify-center rounded-md bg-black/55 text-white",
                  "[@media(hover:hover)]:size-8",
                  "transition-opacity",
                  "[@media(hover:hover)]:opacity-0",
                  "group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                )}
              >
                <MoreVertical className="size-4" aria-hidden />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onSelect={() => onPreview(p)}
                disabled={busy || !p.fabricJson}
              >
                <Eye className="mr-2 size-4" /> 미리보기
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => onInsertAfter(p.pageNo)}
                disabled={busy || !canInsert}
              >
                <Plus className="mr-2 size-4" /> 이 페이지 다음에 추가
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={() => onRequestDelete(p)}
                disabled={busy || !canDelete}
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
          className={cn(
            "absolute inset-0 flex items-center justify-center rounded-md bg-black/0 opacity-0 transition-opacity",
            "focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            "group-hover:bg-black/30 group-hover:opacity-100",
          )}
          aria-label={`페이지 ${p.pageNo} 편집`}
        >
          <span className="inline-flex items-center gap-1 rounded-md bg-card/90 px-2 py-1 text-xs font-medium text-foreground shadow-soft">
            <Pencil className="size-3" aria-hidden /> 편집
          </span>
        </Link>
      ) : null}
    </div>
  );
});

// =====================================================================
// 삭제 confirm — Radix Dialog (포커스 트랩·초기 포커스·ESC·오버레이 닫기)
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
  return (
    <DialogPrimitive.Root
      open
      onOpenChange={(o) => {
        if (!o) onCancel();
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          className={cn(
            "fixed inset-0 z-50 bg-black/50 backdrop-blur-[2px]",
            "data-[state=open]:animate-in data-[state=open]:fade-in-0",
            "data-[state=closed]:animate-out data-[state=closed]:fade-out-0",
          )}
        />
        <DialogPrimitive.Content
          role="alertdialog"
          className={cn(
            "fixed left-1/2 top-1/2 z-50 w-[min(92vw,420px)] -translate-x-1/2 -translate-y-1/2",
            "rounded-xl border bg-background p-5 shadow-soft-lg",
            "focus:outline-none",
          )}
        >
          <DialogPrimitive.Title className="text-base font-semibold">
            {page.pageNo}페이지를 삭제할까요?
          </DialogPrimitive.Title>
          <DialogPrimitive.Description className="mt-1 text-sm text-muted-foreground">
            이 동작은 되돌릴 수 없어요. 페이지의 모든 편집 내용이 함께 사라집니다.
          </DialogPrimitive.Description>
          <div className="mt-5 flex justify-end gap-2">
            <button
              type="button"
              onClick={onCancel}
              className="inline-flex h-9 items-center justify-center rounded-md px-3 text-sm font-medium text-muted-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              취소
            </button>
            <button
              type="button"
              onClick={onConfirm}
              className="inline-flex h-9 items-center justify-center rounded-md bg-destructive px-3 text-sm font-medium text-destructive-foreground hover:bg-destructive/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              삭제
            </button>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

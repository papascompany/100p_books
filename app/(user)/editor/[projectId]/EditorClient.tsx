"use client";

import { useCallback, useEffect, useState } from "react";

import GenerateControls from "./GenerateControls";
import PdfActions from "./PdfActions";
import PreviewGrid, { type PageSummary } from "./PreviewGrid";
import TopBar from "./TopBar";
import { toast } from "@/components/ui/use-toast";
import type { BookSize, LayoutMode } from "@/lib/db/types";

export interface EditorClientProps {
  projectId: string;
  initialTitle: string;
  initialLayoutMode: LayoutMode;
  photoCount: number;
  initialPageCount: number;
  bookSize: BookSize | null;
}

/**
 * 내지 편집 메인 클라이언트 셸 —
 *   상단 TopBar + 좌/상단 컨트롤 + 하단 썸네일 프리뷰 구성.
 *   - 페이지 데이터 로딩은 /api/pages 에 한 번만 보내고 재생성 / reorder / insert / delete 시 다시 fetch.
 *   - reorder/insert/delete 는 낙관적 업데이트 후 실패 시 toast.
 */
export default function EditorClient({
  projectId,
  initialTitle,
  initialLayoutMode,
  photoCount,
  initialPageCount,
  bookSize,
}: EditorClientProps) {
  const [pages, setPages] = useState<PageSummary[]>([]);
  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState<boolean>(true);
  const [pageCount, setPageCount] = useState<number>(initialPageCount);
  const [layoutMode, setLayoutMode] = useState<LayoutMode>(initialLayoutMode);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<boolean>(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch(`/api/pages?projectId=${projectId}`, {
        cache: "no-store",
      });
      const json = (await res.json()) as {
        ok: boolean;
        data?: { pages: PageSummary[]; photoUrls: Record<string, string> };
        error?: { message: string };
      };
      if (!res.ok || !json.ok || !json.data) {
        throw new Error(json.error?.message ?? "페이지 로드 실패");
      }
      setPages(json.data.pages);
      setPhotoUrls(json.data.photoUrls ?? {});
      setPageCount(json.data.pages.length);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "페이지 로드 실패");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleReorder = useCallback(
    async (pageIds: string[]) => {
      if (busy) return;
      setBusy(true);
      // 낙관적 — pages state 즉시 업데이트
      const prev = pages;
      const newOrder = pageIds
        .map((id, idx) => {
          const p = prev.find((x) => x.id === id);
          if (!p) return null;
          return { ...p, pageNo: idx + 1 };
        })
        .filter(Boolean) as PageSummary[];
      setPages(newOrder);
      try {
        const res = await fetch(`/api/pages/reorder`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ projectId, pageIds }),
        });
        const json = (await res.json()) as {
          ok: boolean;
          error?: { message: string };
        };
        if (!res.ok || !json.ok) {
          throw new Error(json.error?.message ?? "순서 변경에 실패했어요.");
        }
        toast({ description: "페이지 순서를 변경했어요.", variant: "success" });
      } catch (e) {
        // 롤백
        setPages(prev);
        throw e;
      } finally {
        setBusy(false);
      }
    },
    [busy, pages, projectId],
  );

  const handleInsert = useCallback(
    async (afterPageNo: number) => {
      if (busy) return;
      setBusy(true);
      try {
        const res = await fetch(`/api/pages/insert`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ projectId, afterPageNo, layoutMode }),
        });
        const json = (await res.json()) as {
          ok: boolean;
          data?: { pageId: string; pageNo: number; pageCount: number };
          error?: { message: string };
        };
        if (!res.ok || !json.ok || !json.data) {
          throw new Error(json.error?.message ?? "페이지 추가에 실패했어요.");
        }
        toast({
          description: `페이지를 추가했어요 (페이지 ${json.data.pageNo}).`,
          variant: "success",
        });
        await refresh();
      } catch (e) {
        toast({
          description:
            e instanceof Error ? e.message : "페이지 추가에 실패했어요.",
          variant: "destructive",
        });
      } finally {
        setBusy(false);
      }
    },
    [busy, layoutMode, projectId, refresh],
  );

  const handleDelete = useCallback(
    async (pageId: string) => {
      if (busy) return;
      setBusy(true);
      try {
        const res = await fetch(`/api/pages/${pageId}`, {
          method: "DELETE",
        });
        const json = (await res.json()) as {
          ok: boolean;
          error?: { message: string };
        };
        if (!res.ok || !json.ok) {
          throw new Error(json.error?.message ?? "삭제에 실패했어요.");
        }
        await refresh();
      } catch (e) {
        // toast 는 PreviewGrid 가 던질 때 처리하지만 여기서도 안전망.
        throw e;
      } finally {
        setBusy(false);
      }
    },
    [busy, refresh],
  );

  return (
    <div className="space-y-8">
      <TopBar
        projectId={projectId}
        initialTitle={initialTitle}
        photoCount={photoCount}
        pageCount={pageCount}
      />

      <GenerateControls
        projectId={projectId}
        photoCount={photoCount}
        currentPageCount={pageCount}
        initialLayoutMode={initialLayoutMode}
        onGenerated={(res) => {
          setLayoutMode(res.layoutMode);
          void refresh();
        }}
      />

      <PdfActions projectId={projectId} pageCount={pageCount} />

      <section aria-labelledby="preview-heading" className="space-y-3">
        <div className="flex items-baseline justify-between">
          <h2
            id="preview-heading"
            className="font-display text-xl font-semibold tracking-tight"
          >
            페이지 프리뷰
          </h2>
          <p className="text-xs text-muted-foreground" aria-live="polite">
            {loading
              ? "불러오는 중…"
              : `${pageCount}페이지 · ${layoutMode === "polaroid" ? "폴라로이드" : "콜라주"}`}
          </p>
        </div>
        {loadError ? (
          <p className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
            {loadError}
          </p>
        ) : null}
        <PreviewGrid
          projectId={projectId}
          pages={pages}
          photoUrls={photoUrls}
          loading={loading}
          bookSize={bookSize}
          onReorder={handleReorder}
          onInsert={handleInsert}
          onDelete={handleDelete}
          busy={busy}
        />
      </section>
    </div>
  );
}

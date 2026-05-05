"use client";

import { useCallback, useEffect, useState } from "react";

import GenerateControls from "./GenerateControls";
import PdfActions from "./PdfActions";
import PreviewGrid, { type PageSummary } from "./PreviewGrid";
import TopBar from "./TopBar";
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
 *   - 페이지 데이터 로딩은 /api/pages 에 한 번만 보내고 재생성 시 다시 fetch.
 *   - generate API 호출은 GenerateControls 가 담당, 성공 시 refresh() 트리거.
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
        />
      </section>
    </div>
  );
}

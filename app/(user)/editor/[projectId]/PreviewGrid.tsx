"use client";

import { Pencil } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import PagePreview from "./PagePreview";
import type { BookSize } from "@/lib/db/types";
import type { PageDoc } from "@/lib/layout/types";

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
}

/**
 * 썸네일 그리드 (모바일 2 / sm 3 / md 4 / lg 5 열).
 * 각 카드: PagePreview + 페이지 번호 배지 + hover 시 '편집' 오버레이 (M3 링크).
 */
export default function PreviewGrid({
  projectId,
  pages,
  photoUrls,
  loading,
  bookSize,
}: PreviewGridProps) {
  // 카드 폭을 컨테이너 사이즈 기반으로 측정 → PagePreview 에 전달
  const gridRef = useRef<HTMLDivElement>(null);
  const [colWidth, setColWidth] = useState(180);

  useEffect(() => {
    const el = gridRef.current;
    if (!el) return;
    const measure = () => {
      // 첫 번째 셀의 실측 폭 (패딩 제외) — 없으면 기본값
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
  }, [pages.length]);

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

  if (pages.length === 0) {
    return (
      <div className="rounded-xl border border-dashed bg-white/40 p-10 text-center">
        <p className="text-base text-muted-foreground">
          아직 생성된 페이지가 없어요.
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          위에서 <span className="font-medium text-foreground">자동 편집하기</span>를
          눌러 시작하세요.
        </p>
      </div>
    );
  }

  return (
    <div
      ref={gridRef}
      className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5"
    >
      {pages.map((p) => {
        const doc = p.fabricJson;
        const aspect = doc ? doc.widthMm / doc.heightMm : bookSize ? bookSize.width_mm / bookSize.height_mm : 1;
        return (
          <div
            key={p.id}
            data-preview-cell
            className="group relative"
            style={{ aspectRatio: aspect }}
            aria-label={`페이지 ${p.pageNo}, ${p.layoutMode === "polaroid" ? "폴라로이드" : "콜라주"}`}
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

            {/* 편집 오버레이 */}
            <Link
              href={`/editor/${projectId}/pages/${p.id}`}
              className="absolute inset-0 flex items-center justify-center rounded-md bg-black/0 opacity-0 transition-opacity focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring group-hover:bg-black/30 group-hover:opacity-100"
              aria-label={`페이지 ${p.pageNo} 편집`}
            >
              <span className="inline-flex items-center gap-1 rounded-md bg-white/90 px-2 py-1 text-xs font-medium text-foreground shadow-soft">
                <Pencil className="size-3" aria-hidden /> 편집
              </span>
            </Link>
          </div>
        );
      })}
    </div>
  );
}

import { isPageDoc, type PageDoc } from "@/lib/layout/types";

/**
 * 주문서 "인쇄 전 확인" 카드용 순수 로직.
 *
 * 서버 page.tsx 가 내지 앞쪽 몇 장의 PageDoc 과 그 사진 thumb signed URL 을 조회해
 * OrderPreviewCard 에 넘긴다. 렌더는 내지 편집 그리드와 같은 HTML/CSS 근사
 * (editor/[projectId]/PagePreview) 를 재사용하므로 새 렌더 파이프라인은 없다.
 */

/** 썸네일 띠에 보여줄 내지 앞쪽 페이지 수. */
export const ORDER_PREVIEW_PAGE_LIMIT = 6;

/** 썸네일 높이(px) — 모바일 390px 에서 카드가 길어지지 않도록 96~120 범위. */
export const ORDER_PREVIEW_THUMB_HEIGHT_PX = 104;

export interface OrderPreviewPage {
  id: string;
  pageNo: number;
  doc: PageDoc;
}

export interface OrderPreviewPageRow {
  id: string;
  page_no: number;
  fabric_json: unknown;
}

/**
 * DB 행 → 미리보기 페이지. PageDoc 가드를 통과하지 못한 행(손상·구버전)은 빼고,
 * page_no 오름차순으로 정렬한다(쿼리 정렬이 빠져도 순서가 흔들리지 않게).
 */
export function toOrderPreviewPages(
  rows: readonly OrderPreviewPageRow[],
): OrderPreviewPage[] {
  const out: OrderPreviewPage[] = [];
  for (const r of rows) {
    if (!isPageDoc(r.fabric_json)) continue;
    out.push({ id: r.id, pageNo: r.page_no, doc: r.fabric_json });
  }
  return out.sort((a, b) => a.pageNo - b.pageNo);
}

/** 미리보기 페이지들이 참조하는 사진 id — 중복 제거, 첫 등장 순. */
export function collectPreviewPhotoIds(
  pages: readonly OrderPreviewPage[],
): string[] {
  const seen = new Set<string>();
  for (const p of pages) {
    for (const obj of p.doc.objects) {
      if (obj.type === "photo" && obj.photoId) seen.add(obj.photoId);
    }
  }
  return Array.from(seen);
}

/**
 * 고정 높이에서 문서 비율을 유지하는 썸네일 폭(px, 정수).
 * 치수가 비정상(0·음수·NaN)이면 정사각형으로 폴백한다.
 */
export function thumbWidthPx(
  widthMm: number,
  heightMm: number,
  heightPx: number,
): number {
  if (
    !Number.isFinite(widthMm) ||
    !Number.isFinite(heightMm) ||
    widthMm <= 0 ||
    heightMm <= 0
  ) {
    return Math.round(heightPx);
  }
  return Math.max(1, Math.round((heightPx * widthMm) / heightMm));
}

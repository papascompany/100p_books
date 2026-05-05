import type { BookSize, Photo } from "@/lib/db/types";
import {
  buildCollagePage,
  slotCountOf,
  type CollageTemplateId,
} from "./collage";
import { buildPolaroidPage } from "./polaroid";
import { sortPhotos } from "./sort";
import { DEFAULT_COLLAGE_TEMPLATE } from "./templates";
import type { LayoutMode, PageDoc, SortMode } from "./types";

export interface GeneratePagesArgs {
  bookSize: Pick<BookSize, "id" | "width_mm" | "height_mm">;
  photos: Photo[];
  sortMode: SortMode;
  layoutMode: LayoutMode;
  /** collage 전용. 미지정 시 DEFAULT_COLLAGE_TEMPLATE. */
  templateId?: CollageTemplateId;
  /** random 정렬 재현성용. */
  seed?: number;
}

/**
 * PageDoc 배열 생성.
 *
 * - `polaroid`: sortPhotos → 사진 1장당 1페이지.
 * - `collage` : sortPhotos → 템플릿 슬롯 수 단위로 chunk → 각 chunk 한 페이지.
 *   * 마지막 청크가 슬롯 수보다 작아도 한 페이지로 생성 (빈 슬롯은 자리표시자 rect).
 */
export function generatePages(args: GeneratePagesArgs): PageDoc[] {
  const { bookSize, photos, sortMode, layoutMode, seed } = args;
  const sorted = sortPhotos(photos, sortMode, seed);

  if (layoutMode === "polaroid") {
    return sorted.map((photo, idx) =>
      buildPolaroidPage({
        bookSize,
        pageNo: idx + 1,
        photo,
      }),
    );
  }

  // collage
  const templateId = args.templateId ?? DEFAULT_COLLAGE_TEMPLATE;
  const slotCount = slotCountOf(templateId);
  const pages: PageDoc[] = [];

  for (let i = 0, pageNo = 1; i < sorted.length; i += slotCount, pageNo++) {
    const chunk = sorted.slice(i, i + slotCount);
    pages.push(
      buildCollagePage({
        bookSize,
        pageNo,
        template: templateId,
        photos: chunk,
      }),
    );
  }

  // 사진 0장인 경우에도 최소 빈 페이지 1장 생성하여 사용자가 편집을 시작할 수 있게 함.
  if (pages.length === 0 && sorted.length === 0) {
    pages.push(
      buildCollagePage({
        bookSize,
        pageNo: 1,
        template: templateId,
        photos: [],
      }),
    );
  }

  return pages;
}

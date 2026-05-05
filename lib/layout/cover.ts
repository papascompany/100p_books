/**
 * 표지(cover) PageDoc 빌더.
 *
 * 좌표계:
 *   - 표지는 "뒤표지(좌) + 책등(중앙) + 앞표지(우)" 를 한 장의 펼친 캔버스로 다룬다.
 *   - widthMm = bookWidthMm * 2 + spineMm
 *   - heightMm = bookHeightMm
 *   - bleed 2mm 는 다른 페이지와 동일.
 *
 * 책등 두께:
 *   - book_sizes.spine_formula_per_page (mm/page) × pageCount.
 *   - 너무 얇으면 (8mm 미만) 책등 텍스트 비활성화.
 *
 * 영역 분할:
 *   - 뒤표지: x ∈ [0, bookWidthMm)
 *   - 책등  : x ∈ [bookWidthMm, bookWidthMm + spineMm)
 *   - 앞표지: x ∈ [bookWidthMm + spineMm, totalWidthMm]
 */

import { nanoid } from "nanoid";

import type { BookSize } from "@/lib/db/types";
import {
  buildCoverObjects,
  COVER_TEMPLATES,
  type CoverTemplateId,
  DEFAULT_COVER_TEMPLATE_ID,
} from "./cover-templates";
import {
  PAGEDOC_VERSION,
  type LayoutObject,
  type PageDoc,
  type TextObject,
} from "./types";

/** 책등 텍스트 표시 임계 두께 (mm). 미만이면 책등 텍스트 비활성. */
export const SPINE_TEXT_MIN_MM = 8;

export interface CoverDimensions {
  /** 펼친 표지 전체 폭 (앞+책등+뒤, mm). */
  totalWidthMm: number;
  totalHeightMm: number;
  /** 책등 두께 (mm). */
  spineMm: number;
  /** 책 한 권(앞 또는 뒤) 폭 (mm). */
  bookWidthMm: number;
  bookHeightMm: number;
}

export interface CalcCoverDimensionsArgs {
  bookSize: Pick<
    BookSize,
    "cover_width_mm" | "cover_height_mm" | "spine_formula_per_page"
  >;
  /** 내지 페이지 수. 1 이상. */
  pageCount: number;
}

/**
 * book_size 와 페이지 수로부터 표지 차원을 계산.
 *
 *   spineMm = pageCount × spine_formula_per_page (음수 방지)
 *   totalWidthMm = cover_width_mm × 2 + spineMm
 *   totalHeightMm = cover_height_mm
 *
 * cover_width_mm 은 book_sizes 에 "한 면(앞/뒤) 폭" 으로 등록되어 있다고 가정.
 * (M5 PDF 빌드시에도 이 함수를 단일 소스로 사용한다.)
 */
export function calcCoverDimensions(
  args: CalcCoverDimensionsArgs,
): CoverDimensions {
  const bookWidthMm = args.bookSize.cover_width_mm;
  const bookHeightMm = args.bookSize.cover_height_mm;
  const spinePerPage = args.bookSize.spine_formula_per_page ?? 0.09;
  const spineMm = Math.max(0, args.pageCount * spinePerPage);
  return {
    bookWidthMm,
    bookHeightMm,
    spineMm,
    totalWidthMm: bookWidthMm * 2 + spineMm,
    totalHeightMm: bookHeightMm,
  };
}

export interface BuildCoverDocArgs {
  bookSize: BookSize;
  pageCount: number;
  title: string;
  templateId?: CoverTemplateId;
  /** 표지 대표 사진 (선택). */
  photoId?: string;
}

/**
 * 기본 표지 PageDoc 생성.
 *   - layoutMode: "cover".
 *   - pageNo: 0 (표지 관용 — 내지와 충돌하지 않음).
 *   - widthMm/heightMm: 표지 펼친 사이즈.
 *   - 객체: 선택 템플릿이 만든 배경/제목/책등/캡션 등.
 */
export function buildDefaultCoverDoc(args: BuildCoverDocArgs): PageDoc {
  const dims = calcCoverDimensions({
    bookSize: args.bookSize,
    pageCount: args.pageCount,
  });
  const templateId = args.templateId ?? DEFAULT_COVER_TEMPLATE_ID;
  if (!(templateId in COVER_TEMPLATES)) {
    throw new Error(`[cover] unknown template id: ${templateId}`);
  }

  const objects: LayoutObject[] = buildCoverObjects({
    templateId,
    dims,
    title: args.title,
    photoId: args.photoId,
  });

  return {
    version: PAGEDOC_VERSION,
    bookSizeId: args.bookSize.id,
    pageNo: 0,
    layoutMode: "cover",
    widthMm: dims.totalWidthMm,
    heightMm: dims.totalHeightMm,
    bleedMm: 2,
    backgroundColor: "#f8f5f0",
    objects,
  };
}

/** 안전한 CoverTemplateId 파싱. */
export function asCoverTemplateId(v: string): CoverTemplateId | null {
  return (v in COVER_TEMPLATES ? (v as CoverTemplateId) : null);
}

/**
 * 책등 텍스트 자동 빌더 (rotation=90 시계방향).
 *
 * 좌표 규약:
 *   - leftMm/topMm/widthMm/heightMm 는 **회전 전 박스** 의 trim 좌표.
 *   - rotation 은 박스 중심 기준 시계방향 90deg 적용.
 *   - 회전 전 박스: widthMm = bookHeightMm × 0.7 (가로로 길게),
 *                   heightMm = spineMm × 0.8.
 *   - 박스 중심을 책등 영역 중앙(bookLeftMm + spineMm/2,
 *     bookTopMm + bookHeightMm/2)에 두면 시계방향 90 회전 후
 *     실제 텍스트가 책등 안에 세로로 들어간다.
 *
 * spineMm 이 SPINE_TEXT_MIN_MM(8mm) 미만이면 null 반환.
 */
export interface BuildSpineTextArgs {
  text: string;
  spineMm: number;
  bookHeightMm: number;
  fontSizePt?: number;
  fill?: string;
  /** 책등 영역 시작 X (= bookWidthMm 또는 펼친 표지에서의 책등 left). */
  bookLeftMm: number;
  /** 책등 영역 시작 Y (보통 0). */
  bookTopMm: number;
}

export function buildSpineText(args: BuildSpineTextArgs): TextObject | null {
  if (args.spineMm < SPINE_TEXT_MIN_MM) return null;

  // 회전 전 박스: 가로로 긴 박스 (회전 후 세로로 책등 안에 맞춰짐).
  const widthMm = args.bookHeightMm * 0.7;
  const heightMm = args.spineMm * 0.8;
  // 중심 = 책등 영역의 중앙 (mm).
  const cxMm = args.bookLeftMm + args.spineMm / 2;
  const cyMm = args.bookTopMm + args.bookHeightMm / 2;
  const leftMm = cxMm - widthMm / 2;
  const topMm = cyMm - heightMm / 2;

  return {
    type: "text",
    objectId: nanoid(12),
    leftMm,
    topMm,
    widthMm,
    heightMm,
    text: "",
    placeholder: args.text || "제목",
    fontFamily: "Pretendard",
    fontSizePt: args.fontSizePt ?? 9,
    fill: args.fill ?? "#2b2b2b",
    align: "center",
    lineHeight: 1.2,
    bold: true,
    rotation: 90,
  };
}

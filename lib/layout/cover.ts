/**
 * 표지(cover) PageDoc 빌더.
 *
 * 좌표계:
 *   - 표지는 "뒤표지(좌) + 책등(중앙) + 앞표지(우)" 를 한 장의 펼친 캔버스로 다룬다.
 *   - DB 정본(0003_seed.sql): book_sizes.cover_width_mm 은
 *     "펼친(앞+뒤) 전체 폭 — 책등 제외, 재단 여유 포함" 이다.
 *   - bookWidthMm(한 면) = cover_width_mm / 2
 *   - widthMm(totalWidthMm) = cover_width_mm + spineMm
 *   - heightMm = cover_height_mm
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
 *   bookWidthMm = cover_width_mm / 2          (한 면 — 앞 또는 뒤)
 *   totalWidthMm = cover_width_mm + spineMm   (앞+뒤 펼침 + 책등)
 *   totalHeightMm = cover_height_mm
 *
 * cover_width_mm 은 DB 정본(0003_seed.sql) 의미 그대로
 * "펼친(앞+뒤) 전체 폭 — 책등 제외, 재단 여유 포함" 이다. (예: A5 = 302mm)
 * (M5 PDF 빌드시에도 이 함수를 단일 소스로 사용한다.)
 */
export function calcCoverDimensions(
  args: CalcCoverDimensionsArgs,
): CoverDimensions {
  const bookWidthMm = args.bookSize.cover_width_mm / 2;
  const bookHeightMm = args.bookSize.cover_height_mm;
  const spinePerPage = args.bookSize.spine_formula_per_page ?? 0.09;
  const spineMm = Math.max(0, args.pageCount * spinePerPage);
  return {
    bookWidthMm,
    bookHeightMm,
    spineMm,
    totalWidthMm: args.bookSize.cover_width_mm + spineMm,
    totalHeightMm: bookHeightMm,
  };
}

/** 저장된 표지 폭과 현재 인쇄 규격의 허용 오차(mm). */
export const COVER_WIDTH_TOLERANCE_MM = 0.5;

/**
 * 저장된 표지가 현재 인쇄 규격과 맞지 않는지 — 규격 개정 이전(2배 폭) 표지이거나,
 * 표지를 만든 뒤 페이지 수가 바뀌어 책등 폭이 달라진 경우다. 이대로 인쇄하면 크롭마크가 어긋난다.
 * 주문서 진입 안내 · 주문 생성 · 결제 승인 · 표지 에디터 배너가 모두 이 판정을 쓴다.
 */
export function isCoverFormatOutdated(args: CalcCoverDimensionsArgs & { coverWidthMm: number }): boolean {
  const expected = calcCoverDimensions(args);
  return Math.abs(expected.totalWidthMm - args.coverWidthMm) > COVER_WIDTH_TOLERANCE_MM;
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
 * 책등 텍스트 자동 빌더 — **세로쓰기**(글자를 세워 위→아래로 쌓음, 2026-11-17 오너 결정).
 *
 *   - 회전 없음. 박스 폭 = 한 글자 남짓(verticalTextWidthMm), 높이 = 책 높이 × 0.8.
 *   - 박스 중심 = 책등 영역 중앙(bookLeftMm + spineMm/2, bookTopMm + bookHeightMm/2).
 *   - 텍스트는 비워 두고 제목을 안내 문구(placeholder)로만 보여 준다 — 고객이 입력해야 인쇄된다.
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

  const fontSizePt = args.fontSizePt ?? SPINE_TEXT_FONT_PT;
  const widthMm = verticalTextWidthMm(fontSizePt);
  const heightMm = args.bookHeightMm * 0.8;
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
    fontSizePt,
    fill: args.fill ?? "#2b2b2b",
    align: "center",
    lineHeight: SPINE_TEXT_LINE_HEIGHT,
    bold: true,
    vertical: true,
  };
}

/** 책등 제목 기본 글자 크기(pt). */
export const SPINE_TEXT_FONT_PT = 9;
/** 세로쓰기 글자 간격(줄 높이 배수). */
export const SPINE_TEXT_LINE_HEIGHT = 1.1;

/**
 * 세로쓰기 박스 폭(mm) — 한글 한 글자(1em)는 들어가고 숫자·영문 대문자 두 글자는 안 들어가는 폭(1.05em).
 * 1pt = 25.4/72 mm.
 */
export function verticalTextWidthMm(fontSizePt: number): number {
  return Math.round(fontSizePt * (25.4 / 72) * 1.05 * 100) / 100;
}

/**
 * 예전 형식(가로 텍스트를 90° 회전)의 책등 텍스트를 세로쓰기로 바꾼다 — 표지 문서 전용.
 * 펼친 표지에서 책등 중심은 항상 문서 폭의 절반이다. 회전 ±90° 이고 중심이 거기에 있는
 * 텍스트만 바꾼다(앞·뒤표지 텍스트는 건드리지 않음). 이미 세로쓰기거나 해당 없으면 같은 문서를 돌려준다.
 */
export function normalizeCoverSpineText(doc: PageDoc): PageDoc {
  if (doc.layoutMode !== "cover") return doc;
  const spineCx = doc.widthMm / 2;
  let changed = false;
  const objects = doc.objects.map((obj) => {
    if (obj.type !== "text" || obj.vertical) return obj;
    const rot = (((obj.rotation ?? 0) % 360) + 360) % 360;
    if (rot !== 90 && rot !== 270) return obj;
    const cx = obj.leftMm + obj.widthMm / 2;
    const cy = obj.topMm + obj.heightMm / 2;
    // 회전 전 박스 높이 = 책등 폭 × 0.8 — 중심이 책등 안에 있는지의 허용치로 쓴다.
    if (Math.abs(cx - spineCx) > Math.max(obj.heightMm, 4)) return obj;
    changed = true;
    const widthMm = verticalTextWidthMm(obj.fontSizePt);
    const heightMm = Math.max(obj.widthMm, doc.heightMm * 0.8);
    const next: TextObject = {
      ...obj,
      leftMm: cx - widthMm / 2,
      topMm: cy - heightMm / 2,
      widthMm,
      heightMm,
      lineHeight: SPINE_TEXT_LINE_HEIGHT,
      vertical: true,
    };
    delete next.rotation;
    return next;
  });
  return changed ? { ...doc, objects } : doc;
}

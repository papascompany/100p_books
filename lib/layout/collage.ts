import { nanoid } from "nanoid";

import type { BookSize, Photo } from "@/lib/db/types";
import {
  PAGEDOC_VERSION,
  type PageDoc,
  type PhotoObject,
  type RectObject,
  type TextObject,
} from "./types";

/** 콜라주 공용 팔레트 — 폴라로이드와 시각적 통일감. */
export const COLLAGE_BACKGROUND = "#f8f5f0";
export const COLLAGE_PLACEHOLDER_FILL = "#e6e2db";
export const COLLAGE_TEXT_FILL = "#2b2b2b";

/** 외곽 패딩 비율 / 슬롯 간 간격 비율 (trim 폭 대비). */
const OUTER_PAD_RATIO = 0.06;
const GAP_RATIO = 0.015;
/** 캡션 영역 고정 높이(mm). 슬롯 영역 "밖" 최하단에 위치. */
const CAPTION_AREA_MM = 20;

/** normalized slot (0~1 좌표계, 좌상단 원점). */
export interface NormalizedSlot {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 콜라주 템플릿 — 슬롯 정의 (0~1 좌표, gap 적용 전 기준). */
export interface CollageTemplateDef {
  id: CollageTemplateId;
  slotCount: number;
  slots: NormalizedSlot[];
}

export type CollageTemplateId =
  | "collage-2v"
  | "collage-2h"
  | "collage-3a"
  | "collage-3v"
  | "collage-4"
  | "collage-6";

/**
 * 슬롯 정의는 "전체 배치 영역을 0~1 로 정규화" 한 좌표.
 * 실제 배치 시 외곽 패딩 → 잔여 영역을 이 비율로 나눠 slot box 계산 → gap 으로 축소.
 */
export const COLLAGE_TEMPLATES: Record<CollageTemplateId, CollageTemplateDef> = {
  // 좌우 2분할
  "collage-2v": {
    id: "collage-2v",
    slotCount: 2,
    slots: [
      { x: 0, y: 0, w: 0.5, h: 1 },
      { x: 0.5, y: 0, w: 0.5, h: 1 },
    ],
  },
  // 상하 2분할
  "collage-2h": {
    id: "collage-2h",
    slotCount: 2,
    slots: [
      { x: 0, y: 0, w: 1, h: 0.5 },
      { x: 0, y: 0.5, w: 1, h: 0.5 },
    ],
  },
  // 좌측 큰 1 + 우측 세로 2
  "collage-3a": {
    id: "collage-3a",
    slotCount: 3,
    slots: [
      { x: 0, y: 0, w: 0.5, h: 1 },
      { x: 0.5, y: 0, w: 0.5, h: 0.5 },
      { x: 0.5, y: 0.5, w: 0.5, h: 0.5 },
    ],
  },
  // 세로 3분할
  "collage-3v": {
    id: "collage-3v",
    slotCount: 3,
    slots: [
      { x: 0, y: 0, w: 1 / 3, h: 1 },
      { x: 1 / 3, y: 0, w: 1 / 3, h: 1 },
      { x: 2 / 3, y: 0, w: 1 / 3, h: 1 },
    ],
  },
  // 2x2 그리드
  "collage-4": {
    id: "collage-4",
    slotCount: 4,
    slots: [
      { x: 0, y: 0, w: 0.5, h: 0.5 },
      { x: 0.5, y: 0, w: 0.5, h: 0.5 },
      { x: 0, y: 0.5, w: 0.5, h: 0.5 },
      { x: 0.5, y: 0.5, w: 0.5, h: 0.5 },
    ],
  },
  // 3x2 그리드
  "collage-6": {
    id: "collage-6",
    slotCount: 6,
    slots: [
      { x: 0, y: 0, w: 1 / 3, h: 0.5 },
      { x: 1 / 3, y: 0, w: 1 / 3, h: 0.5 },
      { x: 2 / 3, y: 0, w: 1 / 3, h: 0.5 },
      { x: 0, y: 0.5, w: 1 / 3, h: 0.5 },
      { x: 1 / 3, y: 0.5, w: 1 / 3, h: 0.5 },
      { x: 2 / 3, y: 0.5, w: 1 / 3, h: 0.5 },
    ],
  },
};

export interface BuildCollageArgs {
  bookSize: Pick<BookSize, "id" | "width_mm" | "height_mm">;
  pageNo: number;
  template: CollageTemplateId;
  /** 슬롯 순서대로 사용. slotCount 보다 적으면 나머지는 빈 자리표시자. */
  photos: Pick<Photo, "id">[];
  captionPlaceholder?: string;
}

/**
 * 콜라주 PageDoc 생성.
 *
 * 배치 파이프라인:
 *   1. 외곽 패딩 제거 → inner box.
 *   2. 하단 CAPTION_AREA_MM 만큼을 캡션 박스로 분리 → 슬롯 영역은 그 위쪽.
 *   3. normalized 슬롯 좌표 × 슬롯 영역 → pixel-mm box.
 *   4. 각 box 사방으로 gap/2 만큼 축소해 슬롯 간 간격 확보.
 */
export function buildCollagePage(args: BuildCollageArgs): PageDoc {
  const { bookSize, pageNo, template, photos } = args;
  const tpl = COLLAGE_TEMPLATES[template];
  if (!tpl) {
    throw new Error(`[collage] unknown template: ${template}`);
  }

  const W = bookSize.width_mm;
  const H = bookSize.height_mm;

  const outerPad = W * OUTER_PAD_RATIO;
  const gap = W * GAP_RATIO;
  const halfGap = gap / 2;

  const innerLeft = outerPad;
  const innerTop = outerPad;
  const innerW = W - 2 * outerPad;
  const innerH = H - 2 * outerPad;

  // 캡션 박스를 최하단에 고정 — 슬롯 영역은 위쪽.
  const captionH = CAPTION_AREA_MM;
  const slotsAreaH = Math.max(1, innerH - captionH);
  const slotsAreaTop = innerTop;
  const slotsAreaLeft = innerLeft;

  const objects: (RectObject | PhotoObject | TextObject)[] = [];

  tpl.slots.forEach((slot, idx) => {
    const sLeft = slotsAreaLeft + slot.x * innerW + halfGap;
    const sTop = slotsAreaTop + slot.y * slotsAreaH + halfGap;
    const sWidth = slot.w * innerW - gap;
    const sHeight = slot.h * slotsAreaH - gap;

    const photo = photos[idx];
    if (photo) {
      objects.push({
        type: "photo",
        objectId: nanoid(12),
        photoId: photo.id,
        leftMm: sLeft,
        topMm: sTop,
        widthMm: sWidth,
        heightMm: sHeight,
        rotation: 0,
        cropMode: "cover",
        borderRadiusMm: 0.8,
      });
    } else {
      // 빈 슬롯 자리표시자 — M3 에서 드래그드롭 타깃
      objects.push({
        type: "rect",
        objectId: nanoid(12),
        leftMm: sLeft,
        topMm: sTop,
        widthMm: sWidth,
        heightMm: sHeight,
        fill: COLLAGE_PLACEHOLDER_FILL,
        borderRadiusMm: 0.8,
        placeholderSlot: true,
      });
    }
  });

  // 캡션 박스 — 슬롯 영역 밖 최하단
  objects.push({
    type: "text",
    objectId: nanoid(12),
    leftMm: innerLeft,
    topMm: innerTop + slotsAreaH,
    widthMm: innerW,
    heightMm: captionH,
    text: "",
    placeholder: args.captionPlaceholder ?? "캡션을 입력하세요",
    fontFamily: "Pretendard",
    fontSizePt: 11,
    fill: COLLAGE_TEXT_FILL,
    align: "center",
    lineHeight: 1.5,
  });

  return {
    version: PAGEDOC_VERSION,
    bookSizeId: bookSize.id,
    pageNo,
    layoutMode: "collage",
    widthMm: W,
    heightMm: H,
    bleedMm: 2,
    backgroundColor: COLLAGE_BACKGROUND,
    objects,
  };
}

/** 템플릿에서 슬롯 수 조회 — 청크 분할 시 사용. */
export function slotCountOf(template: CollageTemplateId): number {
  return COLLAGE_TEMPLATES[template].slotCount;
}

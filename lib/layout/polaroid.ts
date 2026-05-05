import { nanoid } from "nanoid";

import type { BookSize, Photo } from "@/lib/db/types";
import {
  PAGEDOC_VERSION,
  type PageDoc,
  type PhotoObject,
  type RectObject,
  type TextObject,
} from "./types";

/** 폴라로이드 기본 팔레트 — 크림 배경 + 다크 그레이 캡션. */
export const POLAROID_BACKGROUND = "#f8f5f0";
export const POLAROID_CARD_FILL = "#ffffff";
export const POLAROID_CARD_SHADOW = "rgba(0, 0, 0, 0.08)";
export const POLAROID_TEXT_FILL = "#2b2b2b";

/** 캡션 기본 placeholder (UI 는 비어있으면 이 문자열을 힌트로 표시). */
export const DEFAULT_CAPTION_PLACEHOLDER = "여기에 글을 입력하세요";

export interface BuildPolaroidArgs {
  bookSize: Pick<BookSize, "id" | "width_mm" | "height_mm">;
  pageNo: number;
  photo: Pick<Photo, "id">;
  captionPlaceholder?: string;
}

/**
 * 한 장의 사진 → 폴라로이드 스타일 단일 페이지 PageDoc.
 *
 * 배치 규칙 (trim 기준, mm):
 *   - 좌우 패딩        padX  = W * 0.08
 *   - 상단 패딩        padT  = H * 0.08
 *   - 하단 캡션 여유   capH  = max(18, H * 0.10)  // 최소 18mm
 *   - 카드 영역        = [padX, padT] ~ [W - padX, H - padT]
 *   - 사진 크기        = min(contentW, contentH - capH) (정사각)
 *   - 카드(흰 사각형)  = 사진 사방 + 하단 캡션 영역을 포함 (사진 기준 여유 CARD_INSET_MM)
 *   - 캡션 텍스트 박스 = 카드 내부 하단 (카드 하단 여백 CAPTION_AREA_MM 높이)
 *
 * 사이즈(A5 / 145² / 200²) 에 관계없이 비율 기반 → 시각 일관성.
 */
export function buildPolaroidPage(args: BuildPolaroidArgs): PageDoc {
  const { bookSize, pageNo, photo } = args;
  const W = bookSize.width_mm;
  const H = bookSize.height_mm;

  const padX = W * 0.08;
  const padT = H * 0.08;
  const capH = Math.max(18, H * 0.1);

  const contentW = W - 2 * padX;
  const contentH = H - 2 * padT;

  // 사진: 정사각, 카드 내부 상단 정렬
  const photoSize = Math.min(contentW, contentH - capH);

  // 카드: 사진 + 사방 여유 + 하단 캡션 영역
  const CARD_INSET_MM = 3; // 사진 둘레 여유
  const cardW = photoSize + CARD_INSET_MM * 2;
  const cardH = photoSize + CARD_INSET_MM * 2 + capH;
  const cardLeft = (W - cardW) / 2;
  const cardTop = padT + Math.max(0, (contentH - (cardH)) / 2);

  const photoLeft = cardLeft + CARD_INSET_MM;
  const photoTop = cardTop + CARD_INSET_MM;

  // 캡션 박스 — 카드 내부 하단
  const CAPTION_SIDE_PAD = 4;
  const captionLeft = cardLeft + CAPTION_SIDE_PAD;
  const captionWidth = cardW - CAPTION_SIDE_PAD * 2;
  const captionTop = photoTop + photoSize + CARD_INSET_MM; // 사진 밑 바로
  const captionHeight = capH - CARD_INSET_MM * 0.5;

  const cardRect: RectObject = {
    type: "rect",
    objectId: nanoid(12),
    leftMm: cardLeft,
    topMm: cardTop,
    widthMm: cardW,
    heightMm: cardH,
    fill: POLAROID_CARD_FILL,
    borderRadiusMm: 0.8,
  };

  const photoObj: PhotoObject = {
    type: "photo",
    objectId: nanoid(12),
    photoId: photo.id,
    leftMm: photoLeft,
    topMm: photoTop,
    widthMm: photoSize,
    heightMm: photoSize,
    rotation: 0,
    cropMode: "cover",
    shadow: {
      blurMm: 2,
      offsetYMm: 1,
      color: POLAROID_CARD_SHADOW,
    },
  };

  const captionObj: TextObject = {
    type: "text",
    objectId: nanoid(12),
    leftMm: captionLeft,
    topMm: captionTop,
    widthMm: captionWidth,
    heightMm: captionHeight,
    text: "",
    placeholder: args.captionPlaceholder ?? DEFAULT_CAPTION_PLACEHOLDER,
    fontFamily: "Pretendard",
    fontSizePt: 12,
    fill: POLAROID_TEXT_FILL,
    align: "center",
    lineHeight: 1.5,
  };

  return {
    version: PAGEDOC_VERSION,
    bookSizeId: bookSize.id,
    pageNo,
    layoutMode: "polaroid",
    widthMm: W,
    heightMm: H,
    bleedMm: 2,
    backgroundColor: POLAROID_BACKGROUND,
    objects: [cardRect, photoObj, captionObj],
  };
}

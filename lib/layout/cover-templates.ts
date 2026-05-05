/**
 * 표지 템플릿 5종.
 *
 * 좌표계:
 *   - dims.totalWidthMm 안에서 작업 (뒤+책등+앞 펼친 캔버스).
 *   - 모든 객체는 trim 좌표 기준 mm.
 *   - 영역 분할:
 *       backLeft  = 0
 *       spineLeft = bookWidthMm
 *       frontLeft = bookWidthMm + spineMm
 *
 * 각 템플릿은 build({ dims, title, photoId }) 으로 PageDoc.objects 배열을 만든다.
 * 캡션/책등 텍스트는 placeholder 로 비워두고, 사용자가 편집한다.
 */

import { nanoid } from "nanoid";

import type { CoverDimensions } from "./cover";
import { SPINE_TEXT_MIN_MM } from "./cover";
import type {
  LayoutObject,
  PhotoObject,
  RectObject,
  TextObject,
} from "./types";

export type CoverTemplateId =
  | "cover-minimal"
  | "cover-frame"
  | "cover-centered"
  | "cover-polaroid"
  | "cover-bold";

export const DEFAULT_COVER_TEMPLATE_ID: CoverTemplateId = "cover-minimal";

export interface CoverTemplateMeta {
  id: CoverTemplateId;
  label: string;
  /** 템플릿 카드용 SVG (viewBox 0 0 200 100, 펼친 표지 비율 가정). */
  previewSvg: string;
}

export interface BuildCoverObjectsArgs {
  templateId: CoverTemplateId;
  dims: CoverDimensions;
  title: string;
  photoId?: string;
}

/** 표지 좌표 헬퍼. */
function regions(dims: CoverDimensions) {
  const back = { x: 0, w: dims.bookWidthMm };
  const spine = { x: dims.bookWidthMm, w: dims.spineMm };
  const front = { x: dims.bookWidthMm + dims.spineMm, w: dims.bookWidthMm };
  return { back, spine, front };
}

function id() {
  return nanoid(12);
}

/** 책등 텍스트(세로). 두께가 충분할 때만 생성. */
function maybeSpineText(
  dims: CoverDimensions,
  title: string,
): TextObject | null {
  if (dims.spineMm < SPINE_TEXT_MIN_MM) return null;
  const { spine } = regions(dims);
  // 책등 텍스트 박스: 회전 전 좌표는 가로로 spine.h(=책 높이) × spine.w(=책등 폭).
  // rotation -90 (반시계) 으로 세로 책등에 들어맞게 한다.
  // 단순화: 박스를 책등 영역 정중앙에 두고, height 를 spine.w 로 잡는다(회전 후 축 일치).
  const widthMm = dims.bookHeightMm * 0.6; // 회전 전 가로(=실제 세로 길이)
  const heightMm = Math.min(spine.w * 0.7, 6); // 회전 전 세로(=실제 가로)
  const leftMm = spine.x + (spine.w - heightMm) / 2;
  const topMm = (dims.bookHeightMm - widthMm) / 2;
  return {
    type: "text",
    objectId: id(),
    leftMm,
    topMm,
    widthMm,
    heightMm,
    text: "",
    placeholder: title || "제목",
    fontFamily: "Pretendard",
    fontSizePt: 9,
    fill: "#2b2b2b",
    align: "center",
    lineHeight: 1.2,
    bold: true,
  };
}

// -----------------------------------------------------------------------------
// Template builders
// -----------------------------------------------------------------------------

function buildMinimal(args: BuildCoverObjectsArgs): LayoutObject[] {
  const { dims, title, photoId } = args;
  const { front, back } = regions(dims);
  const out: LayoutObject[] = [];

  // 앞표지 사진 — 상단 60%
  const photoH = dims.bookHeightMm * 0.62;
  const photoMargin = 8;
  if (photoId) {
    const ph: PhotoObject = {
      type: "photo",
      objectId: id(),
      photoId,
      leftMm: front.x + photoMargin,
      topMm: photoMargin,
      widthMm: front.w - photoMargin * 2,
      heightMm: photoH - photoMargin,
      rotation: 0,
      cropMode: "cover",
      borderRadiusMm: 0.5,
    };
    out.push(ph);
  } else {
    out.push({
      type: "rect",
      objectId: id(),
      leftMm: front.x + photoMargin,
      topMm: photoMargin,
      widthMm: front.w - photoMargin * 2,
      heightMm: photoH - photoMargin,
      fill: "#e6e2db",
      placeholderSlot: true,
      borderRadiusMm: 0.5,
    });
  }

  // 앞표지 제목
  out.push({
    type: "text",
    objectId: id(),
    leftMm: front.x + photoMargin,
    topMm: photoH + 6,
    widthMm: front.w - photoMargin * 2,
    heightMm: 18,
    text: title,
    placeholder: "표지 제목",
    fontFamily: "Playfair Display",
    fontSizePt: 24,
    fill: "#2b2b2b",
    align: "center",
    lineHeight: 1.2,
    bold: true,
  });

  // 작은 캡션
  out.push({
    type: "text",
    objectId: id(),
    leftMm: front.x + photoMargin,
    topMm: dims.bookHeightMm - 16,
    widthMm: front.w - photoMargin * 2,
    heightMm: 8,
    text: "",
    placeholder: "subtitle",
    fontFamily: "Pretendard",
    fontSizePt: 10,
    fill: "rgba(43,43,43,0.6)",
    align: "center",
    lineHeight: 1.2,
  });

  // 뒷표지 캡션
  out.push({
    type: "text",
    objectId: id(),
    leftMm: back.x + 12,
    topMm: dims.bookHeightMm - 32,
    widthMm: back.w - 24,
    heightMm: 14,
    text: "",
    placeholder: "뒷표지 한 줄",
    fontFamily: "Pretendard",
    fontSizePt: 10,
    fill: "#2b2b2b",
    align: "left",
    lineHeight: 1.4,
  });

  const spineText = maybeSpineText(dims, title);
  if (spineText) out.push(spineText);

  return out;
}

function buildFrame(args: BuildCoverObjectsArgs): LayoutObject[] {
  const { dims, title, photoId } = args;
  const { front, back } = regions(dims);
  const out: LayoutObject[] = [];

  // 앞표지 사진 (프레임 내부)
  const frameInset = 10;
  const photoLeft = front.x + frameInset;
  const photoTop = frameInset;
  const photoW = front.w - frameInset * 2;
  const photoH = dims.bookHeightMm - frameInset * 2 - 26;

  // 흰 프레임 (사진보다 큰 흰 사각형 — 사진 뒤로)
  out.push({
    type: "rect",
    objectId: id(),
    leftMm: front.x + 4,
    topMm: 4,
    widthMm: front.w - 8,
    heightMm: dims.bookHeightMm - 8,
    fill: "#ffffff",
    borderRadiusMm: 1,
  });

  if (photoId) {
    out.push({
      type: "photo",
      objectId: id(),
      photoId,
      leftMm: photoLeft,
      topMm: photoTop,
      widthMm: photoW,
      heightMm: photoH,
      rotation: 0,
      cropMode: "cover",
    });
  } else {
    out.push({
      type: "rect",
      objectId: id(),
      leftMm: photoLeft,
      topMm: photoTop,
      widthMm: photoW,
      heightMm: photoH,
      fill: "#e6e2db",
      placeholderSlot: true,
    });
  }

  // 가운데 제목 (프레임 하단)
  out.push({
    type: "text",
    objectId: id(),
    leftMm: photoLeft,
    topMm: photoTop + photoH + 4,
    widthMm: photoW,
    heightMm: 16,
    text: title,
    placeholder: "표지 제목",
    fontFamily: "Playfair Display",
    fontSizePt: 22,
    fill: "#2b2b2b",
    align: "center",
    lineHeight: 1.2,
    bold: true,
  });

  // 뒷표지 캡션 (가운데 정렬)
  out.push({
    type: "text",
    objectId: id(),
    leftMm: back.x + 16,
    topMm: dims.bookHeightMm / 2 - 10,
    widthMm: back.w - 32,
    heightMm: 20,
    text: "",
    placeholder: "뒷표지 글",
    fontFamily: "Pretendard",
    fontSizePt: 11,
    fill: "#2b2b2b",
    align: "center",
    lineHeight: 1.5,
  });

  const spineText = maybeSpineText(dims, title);
  if (spineText) out.push(spineText);

  return out;
}

function buildCentered(args: BuildCoverObjectsArgs): LayoutObject[] {
  const { dims, title, photoId } = args;
  const { front, back } = regions(dims);
  const out: LayoutObject[] = [];

  // 앞표지 풀블리드 사진 (배경처럼)
  if (photoId) {
    out.push({
      type: "photo",
      objectId: id(),
      photoId,
      leftMm: front.x,
      topMm: 0,
      widthMm: front.w,
      heightMm: dims.bookHeightMm,
      rotation: 0,
      cropMode: "cover",
    });
  } else {
    out.push({
      type: "rect",
      objectId: id(),
      leftMm: front.x,
      topMm: 0,
      widthMm: front.w,
      heightMm: dims.bookHeightMm,
      fill: "#bcb4a1",
      placeholderSlot: true,
    });
  }

  // 반투명 어둡게 오버레이 (텍스트 가독성)
  out.push({
    type: "rect",
    objectId: id(),
    leftMm: front.x + front.w * 0.1,
    topMm: dims.bookHeightMm * 0.35,
    widthMm: front.w * 0.8,
    heightMm: dims.bookHeightMm * 0.3,
    fill: "rgba(255,255,255,0.78)",
    borderRadiusMm: 1,
  });

  // 큰 중앙 제목
  out.push({
    type: "text",
    objectId: id(),
    leftMm: front.x + front.w * 0.1,
    topMm: dims.bookHeightMm * 0.42,
    widthMm: front.w * 0.8,
    heightMm: dims.bookHeightMm * 0.18,
    text: title,
    placeholder: "표지 제목",
    fontFamily: "Playfair Display",
    fontSizePt: 32,
    fill: "#2b2b2b",
    align: "center",
    lineHeight: 1.15,
    bold: true,
  });

  // 뒷표지 — 단색 + 작은 캡션
  out.push({
    type: "rect",
    objectId: id(),
    leftMm: back.x,
    topMm: 0,
    widthMm: back.w,
    heightMm: dims.bookHeightMm,
    fill: "#efe9dd",
  });
  out.push({
    type: "text",
    objectId: id(),
    leftMm: back.x + 14,
    topMm: dims.bookHeightMm - 30,
    widthMm: back.w - 28,
    heightMm: 16,
    text: "",
    placeholder: "뒷표지 캡션",
    fontFamily: "Pretendard",
    fontSizePt: 11,
    fill: "#2b2b2b",
    align: "left",
    lineHeight: 1.4,
  });

  const spineText = maybeSpineText(dims, title);
  if (spineText) out.push(spineText);

  return out;
}

function buildPolaroid(args: BuildCoverObjectsArgs): LayoutObject[] {
  const { dims, title, photoId } = args;
  const { front, back } = regions(dims);
  const out: LayoutObject[] = [];

  // 폴라로이드 카드 (흰 배경)
  const cardW = front.w * 0.7;
  const cardH = cardW * 1.15;
  const cardLeft = front.x + (front.w - cardW) / 2;
  const cardTop = (dims.bookHeightMm - cardH) / 2 - 8;
  out.push({
    type: "rect",
    objectId: id(),
    leftMm: cardLeft,
    topMm: cardTop,
    widthMm: cardW,
    heightMm: cardH,
    fill: "#ffffff",
    borderRadiusMm: 1,
  });

  // 사진 (카드 상단)
  const inset = 5;
  const photoSide = cardW - inset * 2;
  if (photoId) {
    out.push({
      type: "photo",
      objectId: id(),
      photoId,
      leftMm: cardLeft + inset,
      topMm: cardTop + inset,
      widthMm: photoSide,
      heightMm: photoSide,
      rotation: 0,
      cropMode: "cover",
      shadow: { blurMm: 2, offsetYMm: 1, color: "rgba(0,0,0,0.12)" },
    });
  } else {
    out.push({
      type: "rect",
      objectId: id(),
      leftMm: cardLeft + inset,
      topMm: cardTop + inset,
      widthMm: photoSide,
      heightMm: photoSide,
      fill: "#e6e2db",
      placeholderSlot: true,
    });
  }

  // 카드 하단 캡션 (작게)
  out.push({
    type: "text",
    objectId: id(),
    leftMm: cardLeft + inset,
    topMm: cardTop + inset + photoSide + 2,
    widthMm: photoSide,
    heightMm: cardH - inset * 2 - photoSide - 2,
    text: "",
    placeholder: "memo",
    fontFamily: "Pretendard",
    fontSizePt: 10,
    fill: "#2b2b2b",
    align: "center",
    lineHeight: 1.3,
  });

  // 카드 아래 큰 제목
  out.push({
    type: "text",
    objectId: id(),
    leftMm: front.x + 10,
    topMm: cardTop + cardH + 6,
    widthMm: front.w - 20,
    heightMm: 18,
    text: title,
    placeholder: "표지 제목",
    fontFamily: "Playfair Display",
    fontSizePt: 22,
    fill: "#2b2b2b",
    align: "center",
    lineHeight: 1.2,
    bold: true,
  });

  // 뒷표지 캡션
  out.push({
    type: "text",
    objectId: id(),
    leftMm: back.x + 14,
    topMm: dims.bookHeightMm - 32,
    widthMm: back.w - 28,
    heightMm: 16,
    text: "",
    placeholder: "뒷표지 한 줄",
    fontFamily: "Pretendard",
    fontSizePt: 10,
    fill: "#2b2b2b",
    align: "left",
    lineHeight: 1.4,
  });

  const spineText = maybeSpineText(dims, title);
  if (spineText) out.push(spineText);

  return out;
}

function buildBold(args: BuildCoverObjectsArgs): LayoutObject[] {
  const { dims, title, photoId } = args;
  const { front, back } = regions(dims);
  const out: LayoutObject[] = [];

  // 좌상단 작은 사진
  const smallW = front.w * 0.4;
  const smallH = smallW;
  const photoLeft = front.x + 8;
  const photoTop = 8;
  if (photoId) {
    out.push({
      type: "photo",
      objectId: id(),
      photoId,
      leftMm: photoLeft,
      topMm: photoTop,
      widthMm: smallW,
      heightMm: smallH,
      rotation: 0,
      cropMode: "cover",
      borderRadiusMm: 0.5,
    });
  } else {
    out.push({
      type: "rect",
      objectId: id(),
      leftMm: photoLeft,
      topMm: photoTop,
      widthMm: smallW,
      heightMm: smallH,
      fill: "#e6e2db",
      placeholderSlot: true,
      borderRadiusMm: 0.5,
    });
  }

  // 큰 헤드라인 (좌측 정렬, 사진 아래)
  out.push({
    type: "text",
    objectId: id(),
    leftMm: front.x + 8,
    topMm: photoTop + smallH + 8,
    widthMm: front.w - 16,
    heightMm: dims.bookHeightMm * 0.4,
    text: title,
    placeholder: "큰 제목",
    fontFamily: "Playfair Display",
    fontSizePt: 38,
    fill: "#2b2b2b",
    align: "left",
    lineHeight: 1.05,
    bold: true,
  });

  // 작은 부제 (하단)
  out.push({
    type: "text",
    objectId: id(),
    leftMm: front.x + 8,
    topMm: dims.bookHeightMm - 18,
    widthMm: front.w - 16,
    heightMm: 8,
    text: "",
    placeholder: "subtitle",
    fontFamily: "Pretendard",
    fontSizePt: 11,
    fill: "rgba(43,43,43,0.7)",
    align: "left",
    lineHeight: 1.2,
  });

  // 뒷표지 캡션
  out.push({
    type: "text",
    objectId: id(),
    leftMm: back.x + 14,
    topMm: 14,
    widthMm: back.w - 28,
    heightMm: 24,
    text: "",
    placeholder: "뒷표지 글",
    fontFamily: "Pretendard",
    fontSizePt: 11,
    fill: "#2b2b2b",
    align: "left",
    lineHeight: 1.5,
  });

  const spineText = maybeSpineText(dims, title);
  if (spineText) out.push(spineText);

  return out;
}

// -----------------------------------------------------------------------------
// Registry + Preview SVG
// -----------------------------------------------------------------------------

type Builder = (args: BuildCoverObjectsArgs) => LayoutObject[];

export const COVER_TEMPLATES: Record<
  CoverTemplateId,
  { id: CoverTemplateId; label: string; build: Builder }
> = {
  "cover-minimal": {
    id: "cover-minimal",
    label: "미니멀",
    build: buildMinimal,
  },
  "cover-frame": {
    id: "cover-frame",
    label: "프레임",
    build: buildFrame,
  },
  "cover-centered": {
    id: "cover-centered",
    label: "센터드(풀블리드)",
    build: buildCentered,
  },
  "cover-polaroid": {
    id: "cover-polaroid",
    label: "폴라로이드",
    build: buildPolaroid,
  },
  "cover-bold": {
    id: "cover-bold",
    label: "볼드 헤드라인",
    build: buildBold,
  },
};

export function buildCoverObjects(
  args: BuildCoverObjectsArgs,
): LayoutObject[] {
  const t = COVER_TEMPLATES[args.templateId];
  if (!t) throw new Error(`[cover-templates] unknown id ${args.templateId}`);
  return t.build(args);
}

/** SVG 마크업 생성 — viewBox 200x100. */
function svgFor(id: CoverTemplateId): string {
  const W = 200;
  const H = 100;
  // 단순화: spine 폭을 8 로 고정 가정.
  const spine = 8;
  const half = (W - spine) / 2;
  const back = { x: 0, w: half };
  const sp = { x: half, w: spine };
  const front = { x: half + spine, w: half };

  // 공통 frame
  const bg = `<rect width="${W}" height="${H}" fill="#f8f5f0"/>`;
  const spineDiv =
    `<line x1="${sp.x}" y1="0" x2="${sp.x}" y2="${H}" stroke="#d8cfbf" stroke-width="0.5"/>` +
    `<line x1="${sp.x + sp.w}" y1="0" x2="${sp.x + sp.w}" y2="${H}" stroke="#d8cfbf" stroke-width="0.5"/>`;

  let inner = "";
  switch (id) {
    case "cover-minimal":
      inner =
        `<rect x="${front.x + 6}" y="6" width="${front.w - 12}" height="62" fill="#c9c2b3" rx="1"/>` +
        `<rect x="${front.x + 14}" y="74" width="${front.w - 28}" height="6" fill="#7d7466"/>` +
        `<rect x="${back.x + 8}" y="78" width="${back.w - 16}" height="3" fill="#a99e8b"/>`;
      break;
    case "cover-frame":
      inner =
        `<rect x="${front.x + 4}" y="4" width="${front.w - 8}" height="${H - 8}" fill="#ffffff" stroke="#c9c2b3"/>` +
        `<rect x="${front.x + 10}" y="10" width="${front.w - 20}" height="${H - 30}" fill="#c9c2b3"/>` +
        `<rect x="${front.x + 20}" y="${H - 16}" width="${front.w - 40}" height="6" fill="#7d7466"/>` +
        `<rect x="${back.x + 16}" y="${H / 2 - 4}" width="${back.w - 32}" height="3" fill="#a99e8b"/>`;
      break;
    case "cover-centered":
      inner =
        `<rect x="${front.x}" y="0" width="${front.w}" height="${H}" fill="#bcb4a1"/>` +
        `<rect x="${front.x + front.w * 0.1}" y="${H * 0.4}" width="${front.w * 0.8}" height="${H * 0.2}" fill="rgba(255,255,255,0.85)"/>` +
        `<rect x="${front.x + front.w * 0.2}" y="${H * 0.46}" width="${front.w * 0.6}" height="6" fill="#2b2b2b"/>` +
        `<rect x="${back.x}" y="0" width="${back.w}" height="${H}" fill="#efe9dd"/>` +
        `<rect x="${back.x + 10}" y="${H - 14}" width="${back.w - 20}" height="3" fill="#a99e8b"/>`;
      break;
    case "cover-polaroid": {
      const cw = front.w * 0.7;
      const ch = cw * 1.1;
      const cx = front.x + (front.w - cw) / 2;
      const cy = (H - ch) / 2 - 6;
      inner =
        `<rect x="${cx}" y="${cy}" width="${cw}" height="${ch}" fill="#ffffff" stroke="#c9c2b3"/>` +
        `<rect x="${cx + 4}" y="${cy + 4}" width="${cw - 8}" height="${cw - 8}" fill="#c9c2b3"/>` +
        `<rect x="${front.x + 10}" y="${cy + ch + 4}" width="${front.w - 20}" height="6" fill="#7d7466"/>` +
        `<rect x="${back.x + 12}" y="${H - 14}" width="${back.w - 24}" height="3" fill="#a99e8b"/>`;
      break;
    }
    case "cover-bold":
      inner =
        `<rect x="${front.x + 4}" y="4" width="${front.w * 0.4}" height="${front.w * 0.4}" fill="#c9c2b3"/>` +
        `<rect x="${front.x + 4}" y="${4 + front.w * 0.4 + 4}" width="${front.w - 8}" height="14" fill="#2b2b2b"/>` +
        `<rect x="${front.x + 4}" y="${H - 8}" width="${front.w * 0.4}" height="3" fill="#a99e8b"/>` +
        `<rect x="${back.x + 10}" y="10" width="${back.w - 20}" height="3" fill="#a99e8b"/>` +
        `<rect x="${back.x + 10}" y="16" width="${back.w * 0.6}" height="3" fill="#a99e8b"/>`;
      break;
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" aria-hidden="true">${bg}${inner}${spineDiv}</svg>`;
}

export const COVER_TEMPLATE_META: CoverTemplateMeta[] = (
  Object.values(COVER_TEMPLATES) as { id: CoverTemplateId; label: string }[]
).map((t) => ({
  id: t.id,
  label: t.label,
  previewSvg: svgFor(t.id),
}));

// 미사용 import 경고 제거용 — 타입 재익스포트.
export type { LayoutObject, PhotoObject, RectObject, TextObject };

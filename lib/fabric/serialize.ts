/**
 * PageDoc ↔ Fabric.js 6.x 양방향 직렬화 어댑터.
 *
 * 정본 스키마는 `lib/layout/types.ts` 의 PageDoc (M2 layout-engine 합의).
 * fabric.toJSON 형식이 아닌 중립 의미 단위(Photo/Text/Rect)로 표현된다.
 *
 * 좌표/단위 규약:
 *   - PageDoc 내 모든 위치/크기는 mm. 폰트는 pt.
 *   - 캔버스에 올릴 때 mm → px(현재 DPI) 로 변환.
 *   - rotation 은 degrees, 양수=시계방향(중심 기준).
 *     → fabric.Object 의 angle 과 1:1 매칭. 단, 우리 회전은 "중심 기준" 이므로
 *       객체 originX/Y 를 "center" 로 두고 left/top 도 center 기준으로 계산한다.
 *
 * 모든 Fabric 객체는 다음 커스텀 프로퍼티를 보존한다:
 *   - `objectId`         : PageDoc 객체 식별자 (uuid/nanoid)
 *   - `oType`            : "photo" | "text" | "rect"
 *   - `photoId`          : photo 일 때 PageDoc 의 photoId
 *   - `placeholderSlot`  : rect 일 때 빈 슬롯 자리표시자 여부
 *   - `cropMode`         : photo 의 cover/contain
 *   - `borderRadiusMm`   : 라운드 코너 (mm 보존)
 *   - `shadow*`          : photo shadow 메타
 *
 * 서버 import 금지 — 이 모듈은 클라이언트 전용.
 */

import * as fabric from "fabric";

import type {
  ClipartObject,
  LayoutObject,
  PageDoc,
  PhotoObject,
  RectObject,
  TextObject,
} from "@/lib/layout/types";

/** 1 inch = 25.4 mm. */
export function mmToPx(mm: number, dpi: number): number {
  return (mm * dpi) / 25.4;
}

export function pxToMm(px: number, dpi: number): number {
  return (px * 25.4) / dpi;
}

/** pt(72pt = 1in) → px. PageDoc fontSizePt 는 PDF 규약. 화면 표시는 동일 DPI 스케일. */
export function ptToPx(pt: number, dpi: number): number {
  return (pt * dpi) / 72;
}

export function pxToPt(px: number, dpi: number): number {
  return (px * 72) / dpi;
}

/** Fabric Object.toObject 가 보존해야 하는 커스텀 프로퍼티 키. */
export const FABRIC_EXTRA_PROPS = [
  "objectId",
  "oType",
  "photoId",
  "resourceId",
  "clipartSrc",
  "placeholderSlot",
  "cropMode",
  "borderRadiusMm",
  "shadowBlurMm",
  "shadowOffsetYMm",
  "shadowColor",
  "originalWidthMm",
  "originalHeightMm",
] as const;

/** 우리 커스텀 프로퍼티가 부착된 Fabric 객체 타입 (느슨). */
export interface TaggedFabricObject extends fabric.FabricObject {
  objectId?: string;
  oType?: "photo" | "text" | "rect" | "clipart";
  photoId?: string;
  /** 클립아트 — resources.id 보존 (signedUrl 만료 시 재발급). */
  resourceId?: string;
  /** 클립아트 — 원본 src URL (signedUrl 또는 public). */
  clipartSrc?: string;
  placeholderSlot?: boolean;
  cropMode?: "cover" | "contain";
  borderRadiusMm?: number;
  shadowBlurMm?: number;
  shadowOffsetYMm?: number;
  shadowColor?: string;
  originalWidthMm?: number;
  originalHeightMm?: number;
}

export interface PageDocToFabricCtx {
  canvas: fabric.Canvas;
  dpi: number;
  /** photoId → signed URL */
  photoUrls: Record<string, string>;
  /** 누락된 사진 photoId 알림(렌더는 회색 박스로 대체). */
  onMissingPhoto?: (photoId: string) => void;
}

/**
 * PageDoc.backgroundImage 를 fabric.Canvas 의 backgroundImage 로 적용.
 * - 캔버스 전체 (bleed 포함) 에 cover/contain 으로 채운다.
 * - 호출자가 캔버스 좌표계를 알고 있어야 함 (stagePxSize).
 */
export async function applyBackgroundImageToCanvas(
  canvas: fabric.Canvas,
  bg: { url: string; cropMode: "cover" | "contain"; opacity: number },
  stagePxSize: { w: number; h: number },
): Promise<void> {
  try {
    const img = await fabric.FabricImage.fromURL(bg.url, {
      crossOrigin: "anonymous",
    });
    const iw = img.width ?? 1;
    const ih = img.height ?? 1;
    const sCover = Math.max(stagePxSize.w / iw, stagePxSize.h / ih);
    const sContain = Math.min(stagePxSize.w / iw, stagePxSize.h / ih);
    const s = bg.cropMode === "contain" ? sContain : sCover;
    img.set({
      originX: "center",
      originY: "center",
      left: stagePxSize.w / 2,
      top: stagePxSize.h / 2,
      scaleX: s,
      scaleY: s,
      opacity: bg.opacity,
      selectable: false,
      evented: false,
    });
    canvas.backgroundImage = img;
    canvas.requestRenderAll();
  } catch {
    // 무시: 이미지 로드 실패 → 기본 배경색만 보이도록.
  }
}

/**
 * PageDoc → fabric.Object 배열 (캔버스에 add 하려면 호출자 책임).
 * Photo 는 비동기 로딩이라 Promise.all 로 처리.
 */
export async function pageDocToFabric(
  doc: PageDoc,
  ctx: PageDocToFabricCtx,
): Promise<TaggedFabricObject[]> {
  const { dpi, photoUrls, onMissingPhoto } = ctx;

  const tasks = doc.objects.map(async (obj) => {
    if (obj.type === "photo") {
      return buildPhoto(obj, dpi, photoUrls, onMissingPhoto);
    }
    if (obj.type === "text") {
      return buildText(obj, dpi);
    }
    if (obj.type === "clipart") {
      return buildClipart(obj, dpi);
    }
    return buildRect(obj, dpi);
  });

  const results = await Promise.all(tasks);
  return results;
}

/** 중심 기준 left/top 계산 (originX/Y = "center" 일 때 fabric 이 받는 좌표). */
function centerLeftTop(
  obj: { leftMm: number; topMm: number; widthMm: number; heightMm: number },
  dpi: number,
) {
  const left = mmToPx(obj.leftMm + obj.widthMm / 2, dpi);
  const top = mmToPx(obj.topMm + obj.heightMm / 2, dpi);
  const width = mmToPx(obj.widthMm, dpi);
  const height = mmToPx(obj.heightMm, dpi);
  return { left, top, width, height };
}

/**
 * 사진 객체 — fabric.Image.fromURL.
 * cover: 내부 비율은 유지하되 슬롯 box 를 클립패스로 잘라낸다.
 * contain: 비율 유지 + 슬롯 안에 contain.
 *
 * 이미지 로드 실패(만료/누락) 시 회색 사각형 placeholder 로 대체.
 */
async function buildPhoto(
  obj: PhotoObject,
  dpi: number,
  photoUrls: Record<string, string>,
  onMissingPhoto?: (photoId: string) => void,
): Promise<TaggedFabricObject> {
  const { left, top, width, height } = centerLeftTop(obj, dpi);
  const url = photoUrls[obj.photoId];

  if (!url) {
    onMissingPhoto?.(obj.photoId);
    return makePhotoFallback(obj, left, top, width, height);
  }

  let img: fabric.FabricImage;
  try {
    img = await fabric.FabricImage.fromURL(url, {
      crossOrigin: "anonymous",
    });
  } catch {
    onMissingPhoto?.(obj.photoId);
    return makePhotoFallback(obj, left, top, width, height);
  }

  // 원본 픽셀 크기
  const iw = img.width ?? 1;
  const ih = img.height ?? 1;

  // cover/contain 스케일
  const scaleCover = Math.max(width / iw, height / ih);
  const scaleContain = Math.min(width / iw, height / ih);
  const scale = obj.cropMode === "contain" ? scaleContain : scaleCover;

  img.set({
    left,
    top,
    originX: "center",
    originY: "center",
    scaleX: scale,
    scaleY: scale,
    angle: obj.rotation || 0,
    selectable: true,
    hasRotatingPoint: true,
  });

  // cover 시 슬롯 box 로 클리핑 — 회전 비독립 클립패스
  // 회전이 적용된 객체에 대해서도 box-aligned 로 자르려면 absolutePositioned + 픽셀 좌표.
  if (obj.cropMode === "cover") {
    const radiusPx = mmToPx(obj.borderRadiusMm ?? 0, dpi);
    const clip = new fabric.Rect({
      left: left - width / 2,
      top: top - height / 2,
      width,
      height,
      rx: radiusPx,
      ry: radiusPx,
      absolutePositioned: true,
      // 클립 자체에 회전을 부여하지 않음 — 슬롯 박스는 페이지 좌표계에 고정
    });
    img.clipPath = clip;
  } else if (obj.borderRadiusMm) {
    // contain 모드일 땐 단순 라운드 클립
    const radiusPx = mmToPx(obj.borderRadiusMm, dpi);
    img.clipPath = new fabric.Rect({
      width: iw,
      height: ih,
      originX: "center",
      originY: "center",
      rx: radiusPx / scale,
      ry: radiusPx / scale,
    });
  }

  if (obj.shadow) {
    img.shadow = new fabric.Shadow({
      blur: mmToPx(obj.shadow.blurMm, dpi),
      offsetX: 0,
      offsetY: mmToPx(obj.shadow.offsetYMm, dpi),
      color: obj.shadow.color,
    });
  }

  const tagged = img as TaggedFabricObject;
  tagged.objectId = obj.objectId;
  tagged.oType = "photo";
  tagged.photoId = obj.photoId;
  tagged.cropMode = obj.cropMode;
  tagged.borderRadiusMm = obj.borderRadiusMm;
  tagged.shadowBlurMm = obj.shadow?.blurMm;
  tagged.shadowOffsetYMm = obj.shadow?.offsetYMm;
  tagged.shadowColor = obj.shadow?.color;
  tagged.originalWidthMm = obj.widthMm;
  tagged.originalHeightMm = obj.heightMm;
  return tagged;
}

function makePhotoFallback(
  obj: PhotoObject,
  left: number,
  top: number,
  width: number,
  height: number,
): TaggedFabricObject {
  const rect = new fabric.Rect({
    left,
    top,
    originX: "center",
    originY: "center",
    width,
    height,
    fill: "#e6e2db",
    stroke: "rgba(0,0,0,0.2)",
    strokeDashArray: [4, 4],
    angle: obj.rotation || 0,
  });
  const tagged = rect as TaggedFabricObject;
  tagged.objectId = obj.objectId;
  tagged.oType = "photo";
  tagged.photoId = obj.photoId;
  tagged.cropMode = obj.cropMode;
  tagged.originalWidthMm = obj.widthMm;
  tagged.originalHeightMm = obj.heightMm;
  return tagged;
}

function buildText(obj: TextObject, dpi: number): TaggedFabricObject {
  const { left, top, width, height } = centerLeftTop(obj, dpi);
  const fontSizePx = ptToPx(obj.fontSizePt, dpi);

  const tb = new fabric.Textbox(obj.text || "", {
    left,
    top,
    originX: "center",
    originY: "center",
    width,
    // fabric.Textbox 는 height 자동(텍스트 라인 기준). 슬롯 height 는 박스 정렬 의도이므로 minHeight 로만 사용.
    fontFamily: obj.fontFamily,
    fontSize: fontSizePx,
    fill: obj.fill,
    textAlign: obj.align,
    lineHeight: obj.lineHeight,
    fontStyle: obj.italic ? "italic" : "normal",
    fontWeight: obj.bold ? 600 : 400,
    editable: true,
    splitByGrapheme: true,
    angle: obj.rotation ?? 0,
  });

  // 빈 텍스트면 placeholder 흐리게 표시 (실제 text 는 비어 있음)
  if ((!obj.text || obj.text.length === 0) && obj.placeholder) {
    tb.set({ text: obj.placeholder, fill: "rgba(0,0,0,0.35)" });
    // 사용자 편집 시작 시 placeholder 정리는 FabricStage 가 처리.
  }

  const tagged = tb as TaggedFabricObject;
  tagged.objectId = obj.objectId;
  tagged.oType = "text";
  tagged.originalWidthMm = obj.widthMm;
  tagged.originalHeightMm = height ? obj.heightMm : obj.heightMm;
  return tagged;
}

/**
 * 클립아트 객체 — fabric.Image.fromURL.
 *  - photoId 가 없는 외부 리소스. resourceId/src 를 커스텀 프로퍼티로 보존.
 *  - cover 모드 고정 (슬롯 박스에 가득 — 회전 후에도 box-aligned 클립).
 *  - 로드 실패 시 회색 placeholder 로 대체.
 */
async function buildClipart(
  obj: ClipartObject,
  dpi: number,
): Promise<TaggedFabricObject> {
  const { left, top, width, height } = centerLeftTop(obj, dpi);

  let img: fabric.FabricImage;
  try {
    img = await fabric.FabricImage.fromURL(obj.src, {
      crossOrigin: "anonymous",
    });
  } catch {
    // 로드 실패 → 회색 박스로 대체.
    const rect = new fabric.Rect({
      left,
      top,
      originX: "center",
      originY: "center",
      width,
      height,
      fill: "#eef0f4",
      stroke: "rgba(0,0,0,0.15)",
      strokeDashArray: [3, 3],
      angle: obj.rotation || 0,
      opacity: obj.opacity ?? 1,
    });
    const tagged = rect as TaggedFabricObject;
    tagged.objectId = obj.objectId;
    tagged.oType = "clipart";
    tagged.resourceId = obj.resourceId;
    tagged.clipartSrc = obj.src;
    tagged.originalWidthMm = obj.widthMm;
    tagged.originalHeightMm = obj.heightMm;
    return tagged;
  }

  const iw = img.width ?? 1;
  const ih = img.height ?? 1;
  // 클립아트는 비율 유지 + contain (PDF 와 클라가 동일 결과를 내도록).
  const scale = Math.min(width / iw, height / ih);

  img.set({
    left,
    top,
    originX: "center",
    originY: "center",
    scaleX: scale,
    scaleY: scale,
    angle: obj.rotation || 0,
    opacity: obj.opacity ?? 1,
    selectable: true,
    hasRotatingPoint: true,
  });

  const tagged = img as TaggedFabricObject;
  tagged.objectId = obj.objectId;
  tagged.oType = "clipart";
  tagged.resourceId = obj.resourceId;
  tagged.clipartSrc = obj.src;
  tagged.originalWidthMm = obj.widthMm;
  tagged.originalHeightMm = obj.heightMm;
  return tagged;
}

function buildRect(obj: RectObject, dpi: number): TaggedFabricObject {
  const { left, top, width, height } = centerLeftTop(obj, dpi);
  const radiusPx = mmToPx(obj.borderRadiusMm ?? 0, dpi);

  const rect = new fabric.Rect({
    left,
    top,
    originX: "center",
    originY: "center",
    width,
    height,
    fill: obj.fill,
    rx: radiusPx,
    ry: radiusPx,
    angle: obj.rotation ?? 0,
    stroke: obj.placeholderSlot ? "rgba(0,0,0,0.25)" : undefined,
    strokeDashArray: obj.placeholderSlot ? [6, 4] : undefined,
    strokeWidth: obj.placeholderSlot ? 1 : 0,
    strokeUniform: true,
  });

  const tagged = rect as TaggedFabricObject;
  tagged.objectId = obj.objectId;
  tagged.oType = "rect";
  tagged.placeholderSlot = obj.placeholderSlot;
  tagged.borderRadiusMm = obj.borderRadiusMm;
  tagged.originalWidthMm = obj.widthMm;
  tagged.originalHeightMm = obj.heightMm;
  return tagged;
}

// =====================================================================
// fabric.Canvas → PageDoc
// =====================================================================

export type PageDocMeta = Pick<
  PageDoc,
  | "version"
  | "bookSizeId"
  | "pageNo"
  | "layoutMode"
  | "widthMm"
  | "heightMm"
  | "bleedMm"
  | "backgroundColor"
> & {
  /** 표지 PageDoc 등 backgroundImage 가 있는 경우 보존. */
  backgroundImage?: PageDoc["backgroundImage"];
};

/**
 * 캔버스의 (자식) 모든 객체를 순회하며 PageDoc 객체로 직렬화.
 * - 캔버스 DPI 는 fabric.Canvas 에 설정된 것과 동일하게 인자로 받는다.
 *   (fabric.Canvas 자체엔 dpi 개념이 없음 → FabricStage 에서 알고 있음.)
 * - 안전선/배경 헬퍼 객체(`__chrome` 플래그)는 제외.
 */
export function fabricToPageDoc(
  canvas: fabric.Canvas,
  meta: PageDocMeta,
  dpi: number,
): PageDoc {
  const objects: LayoutObject[] = [];
  const all = canvas.getObjects() as TaggedFabricObject[];

  for (const o of all) {
    // 캔버스 chrome 객체(안전선 등)는 oType 미부여 → 스킵
    if (!o.oType) continue;
    const out = serializeOne(o, dpi);
    if (out) objects.push(out);
  }

  const out: PageDoc = {
    version: meta.version,
    bookSizeId: meta.bookSizeId,
    pageNo: meta.pageNo,
    layoutMode: meta.layoutMode,
    widthMm: meta.widthMm,
    heightMm: meta.heightMm,
    bleedMm: meta.bleedMm,
    backgroundColor: meta.backgroundColor,
    objects,
  };
  if (meta.backgroundImage) out.backgroundImage = meta.backgroundImage;
  return out;
}

function serializeOne(
  o: TaggedFabricObject,
  dpi: number,
): LayoutObject | null {
  // origin = center 인 객체의 실제 box 크기(스케일 반영) 계산
  const widthPx = (o.width ?? 0) * (o.scaleX ?? 1);
  const heightPx = (o.height ?? 0) * (o.scaleY ?? 1);
  const leftPx = (o.left ?? 0) - widthPx / 2;
  const topPx = (o.top ?? 0) - heightPx / 2;

  const widthMm = pxToMm(widthPx, dpi);
  const heightMm = pxToMm(heightPx, dpi);
  const leftMm = pxToMm(leftPx, dpi);
  const topMm = pxToMm(topPx, dpi);
  const rotation = o.angle ?? 0;
  const objectId = o.objectId ?? cryptoLikeId();

  if (o.oType === "photo") {
    if (!o.photoId) return null;
    const ph: PhotoObject = {
      type: "photo",
      objectId,
      photoId: o.photoId,
      leftMm,
      topMm,
      widthMm,
      heightMm,
      rotation,
      cropMode: o.cropMode ?? "cover",
    };
    if (typeof o.borderRadiusMm === "number") {
      ph.borderRadiusMm = o.borderRadiusMm;
    }
    if (
      typeof o.shadowBlurMm === "number" &&
      typeof o.shadowOffsetYMm === "number" &&
      typeof o.shadowColor === "string"
    ) {
      ph.shadow = {
        blurMm: o.shadowBlurMm,
        offsetYMm: o.shadowOffsetYMm,
        color: o.shadowColor,
      };
    }
    return ph;
  }

  if (o.oType === "text") {
    const tb = o as fabric.Textbox & TaggedFabricObject;
    const fontSizePt = pxToPt(tb.fontSize ?? 12, dpi);
    const txt: TextObject = {
      type: "text",
      objectId,
      leftMm,
      topMm,
      widthMm,
      heightMm,
      text: tb.text ?? "",
      fontFamily: (tb.fontFamily as string) ?? "Pretendard",
      fontSizePt,
      fill: typeof tb.fill === "string" ? tb.fill : "#2b2b2b",
      align:
        (tb.textAlign as "left" | "center" | "right" | undefined) ?? "left",
      lineHeight: tb.lineHeight ?? 1.4,
      italic: tb.fontStyle === "italic" ? true : undefined,
      bold:
        typeof tb.fontWeight === "number"
          ? tb.fontWeight >= 600
          : tb.fontWeight === "bold"
            ? true
            : undefined,
    };
    if (rotation) txt.rotation = rotation;
    return txt;
  }

  if (o.oType === "rect") {
    const r = o as fabric.Rect & TaggedFabricObject;
    const rect: RectObject = {
      type: "rect",
      objectId,
      leftMm,
      topMm,
      widthMm,
      heightMm,
      fill: typeof r.fill === "string" ? r.fill : "#ffffff",
      rotation,
    };
    if (typeof o.borderRadiusMm === "number") {
      rect.borderRadiusMm = o.borderRadiusMm;
    }
    if (o.placeholderSlot) rect.placeholderSlot = true;
    return rect;
  }

  if (o.oType === "clipart") {
    // src 가 누락된 클립아트는 저장 불가 → 스킵.
    const src = o.clipartSrc;
    if (!src) return null;
    const ca: ClipartObject = {
      type: "clipart",
      objectId,
      leftMm,
      topMm,
      widthMm,
      heightMm,
      rotation,
      src,
    };
    if (o.resourceId) ca.resourceId = o.resourceId;
    if (typeof o.opacity === "number" && o.opacity !== 1) {
      ca.opacity = o.opacity;
    }
    return ca;
  }

  return null;
}

/** crypto.randomUUID 가 없어도 동작하도록 얕은 fallback. */
function cryptoLikeId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID().replace(/-/g, "").slice(0, 12);
  }
  return Math.random().toString(36).slice(2, 14);
}

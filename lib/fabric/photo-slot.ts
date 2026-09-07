import * as fabric from "fabric";

import { mmToPx, pxToMm, type TaggedFabricObject } from "./serialize";

/**
 * 사진 "슬롯" 단일 소스.
 *
 * ## 왜 필요한가 (WYSIWYG 파손의 근본 원인)
 *
 * `PhotoObject` 의 `leftMm/topMm/widthMm/heightMm` 는 **슬롯**(사진이 놓일 칸)이고,
 * 렌더러(lib/pdf/render-page.ts)는 그 칸으로 clip 한 뒤 cover/contain 으로 채운다.
 * 그런데 Fabric 에서 cover 사진은 *칸보다 큰 이미지*를 칸으로 clip 해 그린다 —
 * 즉 **fabric 객체의 bounding box ≠ 슬롯**이다.
 *
 * 직렬화가 그 차이를 모르고 `width * scaleX`(= 이미지 박스)를 저장하면서
 * 슬롯이 이미지 크기로 부풀었다. 실측(표지 '프레임' 템플릿):
 *   슬롯 131×168mm → 저장값 224×168mm, leftMm 161.27 → 114.77.
 * 앞표지(151mm)를 넘어 책등·뒷표지까지 번지고 우측 재단선을 넘었다.
 * 화면에는 프레임 안에 크롭돼 보이는데 저장본·서버 렌더·인쇄물은 달랐다.
 *
 * ## 규약
 *
 * - 슬롯 크기는 `slotWidthMm/slotHeightMm` 태그에 mm 로 둔다(진실원본).
 * - `slotScaleX/slotScaleY` 는 그 슬롯을 적용할 때 우리가 넣은 스케일이다.
 *   사용자가 핸들로 키우면 fabric 이 `scaleX` 를 곱하므로 `scaleX / slotScaleX`
 *   가 곧 슬롯 배율이고, 직렬화는 그 배율을 반영해 슬롯을 계산한다.
 * - clip 은 **객체 로컬 좌표계**에 만든다. 그래야 이동·확대·회전에 자동으로 따라붙고,
 *   회전 시 슬롯이 사진과 함께 도는 PDF 렌더러와 결과가 같아진다.
 *   (이전에는 absolutePositioned 로 페이지 좌표계에 고정돼 있어, 회전하면 화면과
 *    인쇄가 달랐고 사진을 옮기면 이미지만 창 아래로 미끄러졌다.)
 * - 로컬 clip 의 픽셀 크기는 `mmToPx(slot) / slotScale` 로 배율과 무관한 상수라,
 *   한 번 만들면 조작 중에 갱신할 필요가 없다.
 */

export interface ApplyPhotoSlotArgs {
  slotWidthMm: number;
  slotHeightMm: number;
  cropMode: "cover" | "contain";
  borderRadiusMm?: number;
  dpi: number;
}

/** 슬롯 태그가 온전한 사진인지. */
export function hasPhotoSlot(o: TaggedFabricObject): boolean {
  return (
    o.oType === "photo" &&
    typeof o.slotWidthMm === "number" &&
    typeof o.slotHeightMm === "number" &&
    typeof o.slotScaleX === "number" &&
    typeof o.slotScaleY === "number" &&
    (o.slotScaleX ?? 0) > 0 &&
    (o.slotScaleY ?? 0) > 0
  );
}

/** 핸들 조작으로 생긴 슬롯 배율. */
function slotRatio(o: TaggedFabricObject): { rx: number; ry: number } {
  const rx = (o.scaleX ?? 1) / (o.slotScaleX ?? 1);
  const ry = (o.scaleY ?? 1) / (o.slotScaleY ?? 1);
  return {
    rx: Number.isFinite(rx) && rx > 0 ? rx : 1,
    ry: Number.isFinite(ry) && ry > 0 ? ry : 1,
  };
}

/**
 * 이미지를 슬롯에 맞춘다 — cover/contain 스케일 + clip + 태그 갱신.
 * `img` 는 originX/originY = center 여야 한다(빌더들이 그렇게 만든다).
 */
export function applyPhotoSlot(
  img: fabric.FabricImage,
  args: ApplyPhotoSlotArgs,
): void {
  const { slotWidthMm, slotHeightMm, cropMode, borderRadiusMm, dpi } = args;
  const slotW = mmToPx(slotWidthMm, dpi);
  const slotH = mmToPx(slotHeightMm, dpi);

  // fabric 은 width/height 를 원본 픽셀 크기로 채운다.
  const iw = img.width ?? 1;
  const ih = img.height ?? 1;
  const scale =
    cropMode === "contain"
      ? Math.min(slotW / iw, slotH / ih)
      : Math.max(slotW / iw, slotH / ih);
  const safeScale = Number.isFinite(scale) && scale > 0 ? scale : 1;

  img.set({ scaleX: safeScale, scaleY: safeScale });

  const tagged = img as TaggedFabricObject;
  tagged.slotWidthMm = slotWidthMm;
  tagged.slotHeightMm = slotHeightMm;
  tagged.slotScaleX = safeScale;
  tagged.slotScaleY = safeScale;
  tagged.cropMode = cropMode;
  if (typeof borderRadiusMm === "number") {
    tagged.borderRadiusMm = borderRadiusMm;
  }

  applyClip(img, dpi);
}

/**
 * 태그로부터 clip 을 다시 만든다.
 * 조작 중에는 필요 없고(로컬 clip 이 알아서 따라간다), JSON 라운드트립 복원처럼
 * clip 객체가 유실될 수 있는 지점에서만 호출한다.
 */
export function syncPhotoClip(img: fabric.FabricImage, dpi: number): void {
  if (!hasPhotoSlot(img as TaggedFabricObject)) return;
  applyClip(img, dpi);
}

/**
 * 직렬화용 — 현재 상태의 슬롯 박스(mm).
 * 슬롯 태그가 없는 legacy 객체는 null 을 반환해 호출부가 기존 bounding box 경로로
 * 폴백하게 한다.
 */
export function readPhotoSlotBox(
  o: TaggedFabricObject,
  dpi: number,
): { leftMm: number; topMm: number; widthMm: number; heightMm: number } | null {
  if (!hasPhotoSlot(o)) return null;
  const { rx, ry } = slotRatio(o);
  const widthMm = (o.slotWidthMm ?? 0) * rx;
  const heightMm = (o.slotHeightMm ?? 0) * ry;
  // 빌더가 originX/originY = center 로 만들므로 left/top 이 곧 중심점이다.
  const centerXMm = pxToMm(o.left ?? 0, dpi);
  const centerYMm = pxToMm(o.top ?? 0, dpi);
  return {
    leftMm: centerXMm - widthMm / 2,
    topMm: centerYMm - heightMm / 2,
    widthMm,
    heightMm,
  };
}

function applyClip(img: fabric.FabricImage, dpi: number): void {
  const tagged = img as TaggedFabricObject;
  const scale = tagged.slotScaleX ?? img.scaleX ?? 1;
  const radiusPx = mmToPx(tagged.borderRadiusMm ?? 0, dpi);

  if (tagged.cropMode === "contain") {
    // contain 은 이미지가 슬롯 안에 통째로 들어가므로 잘라낼 것이 없다 — 라운드 처리만.
    if (!tagged.borderRadiusMm) {
      img.clipPath = undefined;
      return;
    }
    img.clipPath = new fabric.Rect({
      width: img.width ?? 1,
      height: img.height ?? 1,
      originX: "center",
      originY: "center",
      rx: radiusPx / scale,
      ry: radiusPx / scale,
    });
    return;
  }

  // 로컬 좌표계 clip — 객체 변형(이동·확대·회전)에 자동으로 따라간다.
  // 크기를 scale 로 나눠 두면 화면상 정확히 슬롯 크기가 된다.
  img.clipPath = new fabric.Rect({
    width: mmToPx(tagged.slotWidthMm ?? 0, dpi) / scale,
    height: mmToPx(tagged.slotHeightMm ?? 0, dpi) / scale,
    originX: "center",
    originY: "center",
    rx: radiusPx / scale,
    ry: radiusPx / scale,
  });
}

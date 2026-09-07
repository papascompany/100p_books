/**
 * 사진 슬롯 회귀 테스트.
 *
 * 지키려는 것: **화면에 보이는 칸(슬롯)이 그대로 저장된다.**
 * 깨졌을 때의 증상은 표지 템플릿의 사진이 앞표지를 넘어 책등·뒷표지까지 번지고
 * 재단선 밖으로 잘리는 것이었다(실측 슬롯 131×168mm → 저장 224×168mm).
 */

import { describe, expect, it } from "vitest";

import { readPhotoSlotBox } from "./photo-slot";
import { mmToPx, type TaggedFabricObject } from "./serialize";

const DPI = 72;

/**
 * cover 로 렌더된 사진 mock.
 * 슬롯보다 큰 이미지를 슬롯으로 clip 한 상태 — fabric 의 width*scaleX 는 슬롯이 아니다.
 */
function coverPhoto(opts: {
  slotWidthMm: number;
  slotHeightMm: number;
  /** 원본 픽셀 (비율만 중요) */
  imgW: number;
  imgH: number;
  /** 슬롯 중심 (mm) */
  centerXMm: number;
  centerYMm: number;
  /** 사용자가 핸들로 준 추가 배율 */
  handleScale?: number;
}): TaggedFabricObject {
  const slotWpx = mmToPx(opts.slotWidthMm, DPI);
  const slotHpx = mmToPx(opts.slotHeightMm, DPI);
  const baseScale = Math.max(slotWpx / opts.imgW, slotHpx / opts.imgH);
  const scale = baseScale * (opts.handleScale ?? 1);
  return {
    oType: "photo",
    objectId: "p1",
    photoId: "photo-1",
    cropMode: "cover",
    width: opts.imgW,
    height: opts.imgH,
    scaleX: scale,
    scaleY: scale,
    left: mmToPx(opts.centerXMm, DPI),
    top: mmToPx(opts.centerYMm, DPI),
    angle: 0,
    slotWidthMm: opts.slotWidthMm,
    slotHeightMm: opts.slotHeightMm,
    slotScaleX: baseScale,
    slotScaleY: baseScale,
  } as unknown as TaggedFabricObject;
}

describe("readPhotoSlotBox", () => {
  it("cover 사진에서 이미지 박스가 아니라 슬롯을 돌려준다 (표지 프레임 실측 케이스)", () => {
    // QA 실측 재현: 앞표지 폭 151mm, 프레임 inset 10mm → 슬롯 131×168mm.
    // 4:3 사진을 cover 하면 이미지 박스는 224×168mm 로 부푼다.
    const slotLeftMm = 161.27;
    const photo = coverPhoto({
      slotWidthMm: 131,
      slotHeightMm: 168,
      imgW: 4000,
      imgH: 3000,
      centerXMm: slotLeftMm + 131 / 2,
      centerYMm: 10 + 168 / 2,
    });

    // 부풀었을 때의 값 — 회귀하면 이 숫자가 나온다.
    const inflatedWidthMm =
      ((photo.width ?? 0) * (photo.scaleX ?? 1) * 25.4) / DPI;
    expect(inflatedWidthMm).toBeCloseTo(224, 1);

    const slot = readPhotoSlotBox(photo, DPI)!;
    expect(slot).not.toBeNull();
    expect(slot.widthMm).toBeCloseTo(131, 6);
    expect(slot.heightMm).toBeCloseTo(168, 6);
    expect(slot.leftMm).toBeCloseTo(slotLeftMm, 6);
    expect(slot.topMm).toBeCloseTo(10, 6);
    // 앞표지(151mm) 안에 들어와야 한다 — 책등·뒷표지로 번지지 않는다.
    expect(slot.widthMm).toBeLessThanOrEqual(151);
  });

  it("핸들로 키운 배율은 슬롯 크기에 반영된다", () => {
    const photo = coverPhoto({
      slotWidthMm: 100,
      slotHeightMm: 50,
      imgW: 1000,
      imgH: 1000,
      centerXMm: 100,
      centerYMm: 100,
      handleScale: 1.5,
    });
    const slot = readPhotoSlotBox(photo, DPI)!;
    expect(slot.widthMm).toBeCloseTo(150, 6);
    expect(slot.heightMm).toBeCloseTo(75, 6);
    // 중심은 그대로, 박스만 커진다.
    expect(slot.leftMm).toBeCloseTo(100 - 75, 6);
    expect(slot.topMm).toBeCloseTo(100 - 37.5, 6);
  });

  it("세로 사진을 가로 슬롯에 cover 해도 슬롯 그대로", () => {
    const photo = coverPhoto({
      slotWidthMm: 120,
      slotHeightMm: 80,
      imgW: 3000,
      imgH: 4000,
      centerXMm: 60,
      centerYMm: 40,
    });
    const slot = readPhotoSlotBox(photo, DPI)!;
    expect(slot.widthMm).toBeCloseTo(120, 6);
    expect(slot.heightMm).toBeCloseTo(80, 6);
  });

  it("슬롯 태그가 없는 legacy 객체는 null — 호출부가 기존 경로로 폴백한다", () => {
    const legacy = {
      oType: "photo",
      photoId: "p",
      width: 100,
      height: 100,
      scaleX: 1,
      scaleY: 1,
      left: 0,
      top: 0,
    } as unknown as TaggedFabricObject;
    expect(readPhotoSlotBox(legacy, DPI)).toBeNull();
  });
});

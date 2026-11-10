/**
 * 다중 선택(ActiveSelection) 중 직렬화 회귀 테스트 (런북 백로그 D4).
 *
 * ActiveSelection 안 객체의 left/top/scale/angle 은 선택 그룹 기준 **상대값**이다.
 * 자동저장(FabricStage.serialize → fabricToPageDoc)은 선택을 풀지 않고 읽으므로,
 * 여러 객체를 고른 채 옮기거나 돌린 직후 저장되면 그룹 상대 좌표가 페이지 좌표로 저장됐다.
 *
 * 지키려는 것: 선택 중 직렬화 결과 == 선택을 푼 뒤 직렬화 결과, 그리고 직렬화가 선택 중 객체의
 * 상태(상대 변환)를 바꾸지 않는다. bleed 보정(offsetPx)도 선택 중에 같은 결과를 내야 한다.
 *
 * jsdom 에는 2D 컨텍스트가 없어 렌더 없이(renderOnAddRemove:false StaticCanvas) 변환 경로만 탄다.
 */

import * as fabric from "fabric";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { applyPhotoSlot } from "./photo-slot";
import {
  fabricToPageDoc,
  mmToPx,
  type PageDocMeta,
  type TaggedFabricObject,
} from "./serialize";
import { PAGEDOC_VERSION, type PageDoc } from "@/lib/layout/types";

const DPI = 72;
const BLEED_MM = 2;

beforeAll(() => {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
});
afterAll(() => {
  vi.restoreAllMocks();
});

const META: PageDocMeta = {
  version: PAGEDOC_VERSION,
  bookSizeId: "book-test",
  pageNo: 1,
  layoutMode: "collage",
  widthMm: 145,
  heightMm: 145,
  bleedMm: 2,
  backgroundColor: "#ffffff",
};

function makeRect(id: string, leftPx: number, topPx: number): fabric.Rect {
  const r = new fabric.Rect({
    left: leftPx,
    top: topPx,
    width: 80,
    height: 50,
    originX: "center",
    originY: "center",
    fill: "#ff0000",
  });
  Object.assign(r as TaggedFabricObject, { oType: "rect", objectId: id });
  return r;
}

function makeSlotPhoto(id: string, leftPx: number, topPx: number) {
  const el = document.createElement("img");
  Object.defineProperty(el, "naturalWidth", { value: 400 });
  Object.defineProperty(el, "naturalHeight", { value: 300 });
  const img = new fabric.FabricImage(el, {
    left: leftPx,
    top: topPx,
    width: 400,
    height: 300,
    originX: "center",
    originY: "center",
  });
  Object.assign(img as TaggedFabricObject, {
    oType: "photo",
    objectId: id,
    photoId: `p-${id}`,
    cropMode: "cover",
  });
  applyPhotoSlot(img, {
    slotWidthMm: 40,
    slotHeightMm: 30,
    cropMode: "cover",
    dpi: DPI,
  });
  return img;
}

function setup() {
  const canvas = new fabric.StaticCanvas(undefined, {
    width: mmToPx(149, DPI),
    height: mmToPx(149, DPI),
    renderOnAddRemove: false,
  });
  const a = makeRect("a", 100, 120);
  const b = makeRect("b", 260, 200);
  const p = makeSlotPhoto("p", 180, 320);
  canvas.add(a, b, p);
  const sel = new fabric.ActiveSelection([a, b, p], { canvas });
  // 선택을 옮기고, 키우고, 돌린다(사용자가 여러 객체를 한꺼번에 조작한 상태).
  sel.set({
    left: (sel.left ?? 0) + 37,
    top: (sel.top ?? 0) - 21,
    scaleX: 1.5,
    scaleY: 1.25,
    angle: 30,
  });
  sel.setCoords();
  return { canvas, sel, objects: [a, b, p] as fabric.FabricObject[] };
}

/** 선택 해제(discardActiveObject 가 부르는 경로) 뒤의 기준 결과. */
function serializeAfterRelease(offsetPx?: number): PageDoc {
  const { canvas, sel } = setup();
  sel.removeAll();
  return fabricToPageDoc(
    canvas as unknown as fabric.Canvas,
    META,
    DPI,
    offsetPx === undefined ? undefined : { offsetPx },
  );
}

function expectDocsClose(actual: PageDoc, expected: PageDoc) {
  expect(actual.objects).toHaveLength(expected.objects.length);
  actual.objects.forEach((o, i) => {
    const e = expected.objects[i]!;
    expect(o.objectId).toBe(e.objectId);
    expect(o.leftMm).toBeCloseTo(e.leftMm, 6);
    expect(o.topMm).toBeCloseTo(e.topMm, 6);
    expect(o.widthMm).toBeCloseTo(e.widthMm, 6);
    expect(o.heightMm).toBeCloseTo(e.heightMm, 6);
    expect(o.rotation ?? 0).toBeCloseTo(e.rotation ?? 0, 6);
  });
}

describe("fabricToPageDoc — ActiveSelection 중 직렬화", () => {
  it("선택 중 결과가 선택을 푼 뒤 결과와 같다(좌표·크기·회전)", () => {
    const expected = serializeAfterRelease();
    // 기준이 의미 있는지: 선택 변환이 실제로 반영된 값이어야 한다.
    expect(expected.objects[0]!.rotation).toBeCloseTo(30, 6);

    const { canvas, objects } = setup();
    expect(objects.every((o) => o.group instanceof fabric.ActiveSelection)).toBe(
      true,
    );
    const actual = fabricToPageDoc(canvas as unknown as fabric.Canvas, META, DPI);
    expectDocsClose(actual, expected);
  });

  it("bleed 보정(offsetPx)도 선택 중에 같은 결과를 낸다", () => {
    const offsetPx = mmToPx(BLEED_MM, DPI);
    const expected = serializeAfterRelease(offsetPx);
    const { canvas } = setup();
    const actual = fabricToPageDoc(canvas as unknown as fabric.Canvas, META, DPI, {
      offsetPx,
    });
    expectDocsClose(actual, expected);
    // offset 은 순수 평행이동 — 해제 기준 무보정 결과에서 bleed 만큼 빠진다.
    const raw = serializeAfterRelease();
    expect(actual.objects[0]!.leftMm).toBeCloseTo(
      raw.objects[0]!.leftMm - BLEED_MM,
      6,
    );
  });

  it("직렬화 후 선택 중 객체의 상대 변환과 선택은 그대로다", () => {
    const { canvas, sel, objects } = setup();
    const keys = [
      "left",
      "top",
      "scaleX",
      "scaleY",
      "angle",
      "skewX",
      "skewY",
      "flipX",
      "flipY",
    ] as const;
    const before = objects.map((o) => keys.map((k) => o[k]));
    const selBefore = keys.map((k) => sel[k]);
    fabricToPageDoc(canvas as unknown as fabric.Canvas, META, DPI, {
      offsetPx: mmToPx(BLEED_MM, DPI),
    });
    expect(objects.map((o) => keys.map((k) => o[k]))).toEqual(before);
    expect(keys.map((k) => sel[k])).toEqual(selBefore);
    expect(objects.every((o) => o.group === sel)).toBe(true);
    expect(sel.getObjects()).toEqual(objects);
  });

  it("선택 밖 객체는 기존 경로 그대로(offset 만 평행이동)", () => {
    const canvas = new fabric.StaticCanvas(undefined, { renderOnAddRemove: false });
    const a = makeRect("solo", 100, 120);
    canvas.add(a);
    const offsetPx = mmToPx(BLEED_MM, DPI);
    const doc = fabricToPageDoc(canvas as unknown as fabric.Canvas, META, DPI, {
      offsetPx,
    });
    const o = doc.objects[0]!;
    expect(o.leftMm).toBeCloseTo(((100 - 40 - offsetPx) * 25.4) / DPI, 6);
    expect(o.topMm).toBeCloseTo(((120 - 25 - offsetPx) * 25.4) / DPI, 6);
    expect(a.left).toBe(100);
    expect(a.top).toBe(120);
  });
});

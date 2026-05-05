/**
 * fabricClipboard 의 copy → read 라운드트립 테스트.
 *
 * - copy 가 PageDoc.LayoutObject 로 직렬화되는지.
 * - read 가 새 objectId 와 +5mm offset 을 적용하는지.
 * - 연속 read 호출 시 좌표가 계단처럼 누적되는지.
 * - clear 동작.
 *
 * 실제 fabric.Canvas 없이 mock 객체로 테스트 (jsdom 의존 X).
 */

import { afterEach, describe, expect, it } from "vitest";

import {
  fabricClipboard,
  PASTE_OFFSET_MM,
} from "./clipboard";
import { mmToPx, ptToPx, type TaggedFabricObject } from "./serialize";

const DPI = 72;
const BLEED_MM = 2;

/** 헬퍼: PageDoc 좌표(trim 기준 leftMm/topMm)를 받아 fabric origin=center 좌표로 mock 변환. */
function tag(
  oType: "photo" | "text" | "rect" | "clipart",
  partial: Partial<TaggedFabricObject> & {
    leftMm: number;
    topMm: number;
    widthMm: number;
    heightMm: number;
    photoId?: string;
    clipartSrc?: string;
    cropMode?: "cover" | "contain";
  },
): TaggedFabricObject {
  const widthPx = mmToPx(partial.widthMm, DPI);
  const heightPx = mmToPx(partial.heightMm, DPI);
  // FabricStage 의 bleed 보정 후 좌표계 — left/top 은 (trimLeft + bleed + width/2)
  const bleedPx = mmToPx(BLEED_MM, DPI);
  const left = mmToPx(partial.leftMm, DPI) + widthPx / 2 + bleedPx;
  const top = mmToPx(partial.topMm, DPI) + heightPx / 2 + bleedPx;
  return {
    oType,
    objectId: partial.objectId ?? `id-${oType}`,
    photoId: partial.photoId,
    clipartSrc: partial.clipartSrc,
    cropMode: partial.cropMode,
    width: widthPx,
    height: heightPx,
    scaleX: 1,
    scaleY: 1,
    left,
    top,
    angle: partial.angle ?? 0,
    opacity: 1,
    fill: partial.fill ?? "#ffffff",
    fontFamily: "Pretendard",
    fontSize: ptToPx(12, DPI),
    fontStyle: "normal",
    fontWeight: 400,
    text: "",
    textAlign: "center",
    lineHeight: 1.4,
    set(this: TaggedFabricObject, v: { left?: number; top?: number }) {
      if (typeof v.left === "number") this.left = v.left;
      if (typeof v.top === "number") this.top = v.top;
    },
  } as unknown as TaggedFabricObject;
}

afterEach(() => {
  fabricClipboard.clear();
});

describe("fabricClipboard.copy", () => {
  it("초기 상태는 hasContent=false", () => {
    expect(fabricClipboard.hasContent).toBe(false);
  });

  it("rect 객체 copy 후 hasContent=true 가 되고 데이터가 보존됨", () => {
    const obj = tag("rect", {
      leftMm: 10,
      topMm: 20,
      widthMm: 30,
      heightMm: 40,
      fill: "#ff0000",
    });
    const snap = fabricClipboard.copy(obj, DPI, BLEED_MM);
    expect(snap).not.toBeNull();
    expect(fabricClipboard.hasContent).toBe(true);
    expect(snap!.data.type).toBe("rect");
    const data = snap!.data;
    if (data.type === "rect") {
      expect(data.leftMm).toBeCloseTo(10, 4);
      expect(data.topMm).toBeCloseTo(20, 4);
      expect(data.widthMm).toBeCloseTo(30, 4);
      expect(data.heightMm).toBeCloseTo(40, 4);
      expect(data.fill).toBe("#ff0000");
    }
  });

  it("oType 미지정 객체는 copy 실패 (snapshot=null)", () => {
    const obj = tag("rect", {
      leftMm: 0,
      topMm: 0,
      widthMm: 10,
      heightMm: 10,
    });
    delete (obj as Partial<TaggedFabricObject>).oType;
    const snap = fabricClipboard.copy(obj, DPI, BLEED_MM);
    expect(snap).toBeNull();
    expect(fabricClipboard.hasContent).toBe(false);
  });
});

describe("fabricClipboard.read 라운드트립", () => {
  it("read 시 새 objectId 가 부여되고 +5mm offset 가 적용됨", () => {
    const obj = tag("rect", {
      objectId: "original-id",
      leftMm: 10,
      topMm: 20,
      widthMm: 30,
      heightMm: 40,
      fill: "#abcdef",
    });
    fabricClipboard.copy(obj, DPI, BLEED_MM);
    const out = fabricClipboard.read();
    expect(out).not.toBeNull();
    expect(out!.objectId).not.toBe("original-id");
    expect(out!.objectId.length).toBeGreaterThan(0);
    if (out!.type === "rect") {
      expect(out!.leftMm).toBeCloseTo(10 + PASTE_OFFSET_MM, 4);
      expect(out!.topMm).toBeCloseTo(20 + PASTE_OFFSET_MM, 4);
      expect(out!.widthMm).toBeCloseTo(30, 4);
      expect(out!.heightMm).toBeCloseTo(40, 4);
      expect(out!.fill).toBe("#abcdef");
    }
  });

  it("연속 read 시 좌표가 누적 offset (계단)", () => {
    const obj = tag("rect", {
      leftMm: 10,
      topMm: 10,
      widthMm: 5,
      heightMm: 5,
    });
    fabricClipboard.copy(obj, DPI, BLEED_MM);
    const a = fabricClipboard.read()!;
    const b = fabricClipboard.read()!;
    const c = fabricClipboard.read()!;
    if (a.type === "rect" && b.type === "rect" && c.type === "rect") {
      expect(a.leftMm).toBeCloseTo(15, 4);
      expect(b.leftMm).toBeCloseTo(20, 4);
      expect(c.leftMm).toBeCloseTo(25, 4);
    }
    // 새 id 들 — 모두 unique
    expect(new Set([a.objectId, b.objectId, c.objectId]).size).toBe(3);
  });

  it("photo 객체도 photoId 보존", () => {
    const obj = tag("photo", {
      photoId: "photo-xyz",
      leftMm: 5,
      topMm: 5,
      widthMm: 50,
      heightMm: 50,
      cropMode: "cover",
    });
    fabricClipboard.copy(obj, DPI, BLEED_MM);
    const out = fabricClipboard.read()!;
    expect(out.type).toBe("photo");
    if (out.type === "photo") {
      expect(out.photoId).toBe("photo-xyz");
      expect(out.cropMode).toBe("cover");
    }
  });

  it("clipart 객체도 clipartSrc 가 src 로 보존", () => {
    const obj = tag("clipart", {
      clipartSrc: "https://example.com/star.png",
      leftMm: 0,
      topMm: 0,
      widthMm: 20,
      heightMm: 20,
    });
    fabricClipboard.copy(obj, DPI, BLEED_MM);
    const out = fabricClipboard.read()!;
    expect(out.type).toBe("clipart");
    if (out.type === "clipart") {
      expect(out.src).toBe("https://example.com/star.png");
    }
  });
});

describe("fabricClipboard.clear", () => {
  it("clear 후 hasContent=false / read=null", () => {
    const obj = tag("rect", {
      leftMm: 0,
      topMm: 0,
      widthMm: 10,
      heightMm: 10,
    });
    fabricClipboard.copy(obj, DPI, BLEED_MM);
    expect(fabricClipboard.hasContent).toBe(true);
    fabricClipboard.clear();
    expect(fabricClipboard.hasContent).toBe(false);
    expect(fabricClipboard.read()).toBeNull();
  });
});

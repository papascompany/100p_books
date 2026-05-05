/**
 * serialize 어댑터의 좌표/단위 변환과 PageDoc 라운드트립 라우팅 테스트.
 *
 * Fabric.Canvas 는 실제 HTMLCanvasElement 가 필요해 jsdom 환경에선 풀 렌더가
 * 어렵다. 이 테스트는 Canvas 가 아닌 "객체 컬렉션을 흉내내는 mock" 으로
 * fabricToPageDoc 의 직렬화 경로를 검증한다 (mock canvas + tagged 객체).
 */

import { describe, expect, it } from "vitest";

import {
  fabricToPageDoc,
  mmToPx,
  ptToPx,
  pxToMm,
  pxToPt,
  type PageDocMeta,
  type TaggedFabricObject,
} from "./serialize";
import { PAGEDOC_VERSION, type PageDoc } from "@/lib/layout/types";

const DPI = 72;

const META: PageDocMeta = {
  version: PAGEDOC_VERSION,
  bookSizeId: "book-test",
  pageNo: 1,
  layoutMode: "polaroid",
  widthMm: 145,
  heightMm: 145,
  bleedMm: 2,
  backgroundColor: "#f8f5f0",
};

describe("mmToPx / pxToMm", () => {
  it("72 dpi 에서 25.4mm = 72px", () => {
    expect(mmToPx(25.4, 72)).toBeCloseTo(72, 5);
    expect(pxToMm(72, 72)).toBeCloseTo(25.4, 5);
  });
  it("300 dpi 에서 25.4mm = 300px", () => {
    expect(mmToPx(25.4, 300)).toBeCloseTo(300, 5);
  });
  it("ptToPx / pxToPt 라운드트립", () => {
    const px = ptToPx(12, 72);
    expect(px).toBeCloseTo(12, 5);
    expect(pxToPt(px, 72)).toBeCloseTo(12, 5);
  });
});

/**
 * mock fabric.Canvas — fabricToPageDoc 가 사용하는 메서드만 구현.
 */
function makeMockCanvas(objects: TaggedFabricObject[]): {
  getObjects: () => TaggedFabricObject[];
} {
  return {
    getObjects: () => objects,
  };
}

/** mock TaggedFabricObject — origin = center 가정. */
function tag(
  oType: "photo" | "text" | "rect" | "clipart",
  partial: Partial<TaggedFabricObject> & {
    leftMm: number;
    topMm: number;
    widthMm: number;
    heightMm: number;
    opacity?: number;
    clipartSrc?: string;
    resourceId?: string;
  },
): TaggedFabricObject {
  const widthPx = mmToPx(partial.widthMm, DPI);
  const heightPx = mmToPx(partial.heightMm, DPI);
  const left = mmToPx(partial.leftMm, DPI) + widthPx / 2;
  const top = mmToPx(partial.topMm, DPI) + heightPx / 2;
  return {
    oType,
    objectId: partial.objectId ?? `id-${oType}`,
    photoId: partial.photoId,
    resourceId: partial.resourceId,
    clipartSrc: partial.clipartSrc,
    placeholderSlot: partial.placeholderSlot,
    cropMode: partial.cropMode,
    borderRadiusMm: partial.borderRadiusMm,
    shadowBlurMm: partial.shadowBlurMm,
    shadowOffsetYMm: partial.shadowOffsetYMm,
    shadowColor: partial.shadowColor,
    width: widthPx,
    height: heightPx,
    scaleX: 1,
    scaleY: 1,
    left,
    top,
    angle: partial.angle ?? 0,
    opacity: partial.opacity ?? 1,
    fill: partial.fill ?? "#ffffff",
    fontFamily: "Pretendard",
    fontSize: ptToPx(12, DPI),
    fontStyle: "normal",
    fontWeight: 400,
    text: "",
    textAlign: "center",
    lineHeight: 1.4,
  } as unknown as TaggedFabricObject;
}

describe("fabricToPageDoc", () => {
  it("photo / text / rect 모두 직렬화", () => {
    const photo = tag("photo", {
      photoId: "p1",
      leftMm: 10,
      topMm: 10,
      widthMm: 50,
      heightMm: 50,
      cropMode: "cover",
      borderRadiusMm: 0.8,
      shadowBlurMm: 2,
      shadowOffsetYMm: 1,
      shadowColor: "rgba(0,0,0,0.08)",
    });
    const text = tag("text", {
      leftMm: 10,
      topMm: 100,
      widthMm: 100,
      heightMm: 20,
    });
    const rect = tag("rect", {
      leftMm: 0,
      topMm: 0,
      widthMm: 145,
      heightMm: 145,
      placeholderSlot: false,
      borderRadiusMm: 1,
      fill: "#ffffff",
    });

    const canvas = makeMockCanvas([photo, text, rect]);
    const doc = fabricToPageDoc(
      canvas as unknown as Parameters<typeof fabricToPageDoc>[0],
      META,
      DPI,
    );

    expect(doc.version).toBe(PAGEDOC_VERSION);
    expect(doc.objects).toHaveLength(3);

    const p = doc.objects[0]!;
    expect(p.type).toBe("photo");
    if (p.type === "photo") {
      expect(p.photoId).toBe("p1");
      expect(p.leftMm).toBeCloseTo(10, 4);
      expect(p.topMm).toBeCloseTo(10, 4);
      expect(p.widthMm).toBeCloseTo(50, 4);
      expect(p.heightMm).toBeCloseTo(50, 4);
      expect(p.cropMode).toBe("cover");
      expect(p.borderRadiusMm).toBe(0.8);
      expect(p.shadow?.blurMm).toBe(2);
    }

    const r = doc.objects[2]!;
    expect(r.type).toBe("rect");
    if (r.type === "rect") {
      expect(r.fill).toBe("#ffffff");
      expect(r.borderRadiusMm).toBe(1);
    }
  });

  it("oType 미부여 chrome 객체는 직렬화에서 제외", () => {
    const safe = tag("rect", {
      leftMm: 0,
      topMm: 0,
      widthMm: 145,
      heightMm: 145,
    });
    // chrome → oType 제거
    delete (safe as Partial<TaggedFabricObject>).oType;
    const real = tag("rect", {
      leftMm: 5,
      topMm: 5,
      widthMm: 10,
      heightMm: 10,
      fill: "#ff0000",
    });

    const doc = fabricToPageDoc(
      makeMockCanvas([safe, real]) as unknown as Parameters<
        typeof fabricToPageDoc
      >[0],
      META,
      DPI,
    );
    expect(doc.objects).toHaveLength(1);
    expect(doc.objects[0]!.type).toBe("rect");
  });

  it("photoId 가 없는 photo 는 스킵 (M3 클립아트 임시처리)", () => {
    const orphan = tag("photo", {
      leftMm: 0,
      topMm: 0,
      widthMm: 10,
      heightMm: 10,
    });
    delete (orphan as Partial<TaggedFabricObject>).photoId;
    const doc = fabricToPageDoc(
      makeMockCanvas([orphan]) as unknown as Parameters<
        typeof fabricToPageDoc
      >[0],
      META,
      DPI,
    );
    expect(doc.objects).toHaveLength(0);
  });
});

describe("ClipartObject 라운드트립", () => {
  it("clipartSrc / resourceId / opacity 모두 보존", () => {
    const ca = tag("clipart", {
      leftMm: 10,
      topMm: 10,
      widthMm: 30,
      heightMm: 30,
      angle: 15,
      opacity: 0.7,
      clipartSrc: "https://example.com/sign/resources/cliparts/abc.png?token=xyz",
      resourceId: "res-123",
    });
    const doc = fabricToPageDoc(
      makeMockCanvas([ca]) as unknown as Parameters<typeof fabricToPageDoc>[0],
      META,
      DPI,
    );
    expect(doc.objects).toHaveLength(1);
    const out = doc.objects[0]!;
    expect(out.type).toBe("clipart");
    if (out.type === "clipart") {
      expect(out.src).toBe(
        "https://example.com/sign/resources/cliparts/abc.png?token=xyz",
      );
      expect(out.resourceId).toBe("res-123");
      expect(out.leftMm).toBeCloseTo(10, 4);
      expect(out.topMm).toBeCloseTo(10, 4);
      expect(out.widthMm).toBeCloseTo(30, 4);
      expect(out.heightMm).toBeCloseTo(30, 4);
      expect(out.rotation).toBe(15);
      expect(out.opacity).toBe(0.7);
    }
  });

  it("clipartSrc 누락 시 직렬화에서 제외", () => {
    const orphan = tag("clipart", {
      leftMm: 0,
      topMm: 0,
      widthMm: 10,
      heightMm: 10,
    });
    delete (orphan as Partial<TaggedFabricObject>).clipartSrc;
    const doc = fabricToPageDoc(
      makeMockCanvas([orphan]) as unknown as Parameters<
        typeof fabricToPageDoc
      >[0],
      META,
      DPI,
    );
    expect(doc.objects).toHaveLength(0);
  });

  it("opacity 1 (기본값) 은 직렬화 결과에 미포함", () => {
    const ca = tag("clipart", {
      leftMm: 0,
      topMm: 0,
      widthMm: 10,
      heightMm: 10,
      opacity: 1,
      clipartSrc: "https://example.com/x.png",
    });
    const doc = fabricToPageDoc(
      makeMockCanvas([ca]) as unknown as Parameters<typeof fabricToPageDoc>[0],
      META,
      DPI,
    );
    const out = doc.objects[0]!;
    expect(out.type).toBe("clipart");
    if (out.type === "clipart") {
      expect(out.opacity).toBeUndefined();
    }
  });
});

describe("isPageDoc 가드 — clipart 포함", () => {
  it("clipart 객체가 포함된 PageDoc 통과", async () => {
    const { isPageDoc, PAGEDOC_VERSION } = await import("@/lib/layout/types");
    const doc = {
      version: PAGEDOC_VERSION,
      bookSizeId: "b1",
      pageNo: 1,
      layoutMode: "polaroid",
      widthMm: 145,
      heightMm: 145,
      bleedMm: 2,
      backgroundColor: "#ffffff",
      objects: [
        {
          type: "clipart",
          objectId: "c1",
          leftMm: 0,
          topMm: 0,
          widthMm: 30,
          heightMm: 30,
          rotation: 0,
          src: "https://example.com/x.png",
        },
      ],
    };
    expect(isPageDoc(doc)).toBe(true);
  });

  it("알려지지 않은 type 은 reject", async () => {
    const { isPageDoc, PAGEDOC_VERSION } = await import("@/lib/layout/types");
    const doc = {
      version: PAGEDOC_VERSION,
      bookSizeId: "b1",
      pageNo: 1,
      layoutMode: "polaroid",
      widthMm: 145,
      heightMm: 145,
      bleedMm: 2,
      backgroundColor: "#fff",
      objects: [
        { type: "unknownTypeFoo", objectId: "x" },
      ],
    };
    expect(isPageDoc(doc)).toBe(false);
  });
});

describe("PageDoc 좌표 라운드트립 (mock)", () => {
  it("mm 좌표 → tag → fabricToPageDoc 후 동일한 mm 복원 (이미지 src 제외)", () => {
    const original: Pick<
      PageDoc["objects"][number],
      "leftMm" | "topMm" | "widthMm" | "heightMm"
    > = {
      leftMm: 12.5,
      topMm: 30,
      widthMm: 80,
      heightMm: 60,
    };
    const obj = tag("rect", { ...original, fill: "#abcdef" });
    const doc = fabricToPageDoc(
      makeMockCanvas([obj]) as unknown as Parameters<
        typeof fabricToPageDoc
      >[0],
      META,
      DPI,
    );
    const out = doc.objects[0]!;
    if (out.type !== "rect") throw new Error("unexpected type");
    expect(out.leftMm).toBeCloseTo(original.leftMm, 4);
    expect(out.topMm).toBeCloseTo(original.topMm, 4);
    expect(out.widthMm).toBeCloseTo(original.widthMm, 4);
    expect(out.heightMm).toBeCloseTo(original.heightMm, 4);
    expect(out.fill).toBe("#abcdef");
  });
});

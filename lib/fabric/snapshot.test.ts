/**
 * 히스토리 스냅샷 라운드트립 회귀 테스트 (QA-1).
 *
 * 지키려는 것: **undo/redo 로 복원한 캔버스를 저장하면, 복원 전과 같은 PageDoc 이 나온다.**
 * 깨졌을 때의 증상은 되돌리기 1회 뒤 자동저장이 페이지·표지를 0객체 문서로 덮어쓴 것이었다
 * (스냅샷에서 oType·objectId·photoId·슬롯 태그가 빠져 직렬화가 전부 건너뜀).
 *
 * jsdom 에는 2D 컨텍스트가 없어 Textbox 생성과 이미지 로드가 불가능하다.
 *  - 캔버스는 renderOnAddRemove:false StaticCanvas 로 렌더 없이 toObject 경로만 탄다.
 *  - 사진 복원은 FabricImage.fromObject 와 같은 생성 경로(new FabricImage(el, {...object}))를
 *    이미지 로드 없이 흉내 내는 enliven 을 주입한다. Rect 등은 fabric 실제 enlivenObjects 를 쓴다.
 */

import * as fabric from "fabric";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { applyPhotoSlot } from "./photo-slot";
import {
  fabricToPageDoc,
  findUntaggedUserObjects,
  mmToPx,
  type PageDocMeta,
  type TaggedFabricObject,
} from "./serialize";
import {
  createSnapshot,
  parseSnapshot,
  remapPhotoSources,
  restoreSnapshotObjects,
  SNAPSHOT_VERSION,
  type EnlivenFn,
  type SerializedFabricObject,
} from "./snapshot";
import { PAGEDOC_VERSION } from "@/lib/layout/types";

const DPI = 72;

// jsdom 의 getContext 는 "Not implemented" 를 콘솔에 찍고 null 을 돌려준다 — 조용히 null.
beforeAll(() => {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
});
afterAll(() => {
  vi.restoreAllMocks();
});

const META: PageDocMeta = {
  version: PAGEDOC_VERSION,
  bookSizeId: "book-test",
  pageNo: 3,
  layoutMode: "polaroid",
  widthMm: 145,
  heightMm: 145,
  bleedMm: 2,
  backgroundColor: "#f8f5f0",
};

function makeCanvas(): fabric.StaticCanvas {
  // 렌더 요청이 없으면 2D 컨텍스트 없이도 add/toObject 가 동작한다.
  return new fabric.StaticCanvas(document.createElement("canvas"), {
    width: 420,
    height: 420,
    renderOnAddRemove: false,
  });
}

function imageElement(w: number, h: number, src: string): HTMLImageElement {
  const el = document.createElement("img");
  el.width = w;
  el.height = h;
  el.src = src;
  return el;
}

/** 표지 프레임 실측 케이스와 같은 cover 사진 — 슬롯 131×168mm, 4:3 원본. */
function makePhoto(): TaggedFabricObject {
  const img = new fabric.FabricImage(
    imageElement(4000, 3000, "https://cdn.test/thumb-old.jpg"),
  );
  img.set({
    left: mmToPx(161.27 + 131 / 2, DPI),
    top: mmToPx(10 + 168 / 2, DPI),
    originX: "center",
    originY: "center",
    angle: 3,
  });
  applyPhotoSlot(img, {
    slotWidthMm: 131,
    slotHeightMm: 168,
    cropMode: "cover",
    borderRadiusMm: 2,
    dpi: DPI,
  });
  const tagged = img as TaggedFabricObject;
  tagged.objectId = "photo-obj-1";
  tagged.oType = "photo";
  tagged.photoId = "photo-1";
  tagged.originalWidthMm = 131;
  tagged.originalHeightMm = 168;
  tagged.shadowBlurMm = 1.5;
  tagged.shadowOffsetYMm = 0.8;
  tagged.shadowColor = "rgba(0,0,0,0.3)";
  return tagged;
}

function makeRect(): TaggedFabricObject {
  const rect = new fabric.Rect({
    left: mmToPx(40, DPI),
    top: mmToPx(30, DPI),
    originX: "center",
    originY: "center",
    width: mmToPx(50, DPI),
    height: mmToPx(20, DPI),
    fill: "#ffeecc",
  });
  const tagged = rect as TaggedFabricObject;
  tagged.objectId = "rect-obj-1";
  tagged.oType = "rect";
  tagged.placeholderSlot = true;
  tagged.borderRadiusMm = 3;
  return tagged;
}

function makeClipart(): TaggedFabricObject {
  const img = new fabric.FabricImage(
    imageElement(200, 100, "https://cdn.test/clipart-star.png"),
  );
  img.set({
    left: mmToPx(100, DPI),
    top: mmToPx(100, DPI),
    originX: "center",
    originY: "center",
    scaleX: 0.5,
    scaleY: 0.5,
    opacity: 0.8,
  });
  const tagged = img as TaggedFabricObject;
  tagged.objectId = "clip-obj-1";
  tagged.oType = "clipart";
  tagged.clipartSrc = "https://cdn.test/clipart-star.png";
  tagged.resourceId = "res-1";
  return tagged;
}

/** 안전선 같은 chrome — 스냅샷·직렬화 모두에서 제외돼야 한다. */
function makeChrome(): fabric.Rect {
  return new fabric.Rect({
    width: 10,
    height: 10,
    selectable: false,
    evented: false,
    excludeFromExport: true,
  });
}

/**
 * FabricImage.fromObject 와 같은 생성 경로 — 이미지 로드만 가짜 엘리먼트로 대체.
 * (fabric 6.9.1: `new this(el, { ...object, src, filters, resizeFilter, ...hydratedProps })`)
 */
function makeTestEnliven(srcSeen: string[]): EnlivenFn {
  return async (objects) =>
    Promise.all(
      objects.map(async (o: SerializedFabricObject) => {
        if (o.type !== "Image") {
          const [inst] = await fabric.util.enlivenObjects<fabric.FabricObject>([
            o,
          ]);
          return inst!;
        }
        const {
          src,
          type: _type,
          filters: _filters,
          resizeFilter: _resizeFilter,
          crossOrigin: _crossOrigin,
          ...rest
        } = o;
        const srcText = typeof src === "string" ? src : "";
        srcSeen.push(srcText);
        const hydrated = await fabric.util.enlivenObjectEnlivables<
          Record<string, unknown>
        >(rest);
        const el = imageElement(
          Number(rest.width ?? 1),
          Number(rest.height ?? 1),
          srcText,
        );
        return new fabric.FabricImage(el, {
          ...rest,
          src: srcText,
          ...hydrated,
        } as Record<string, unknown>);
      }),
    );
}

function serializeObjects(objects: TaggedFabricObject[]) {
  return fabricToPageDoc(
    { getObjects: () => objects } as unknown as fabric.Canvas,
    META,
    DPI,
  );
}

describe("createSnapshot", () => {
  it("canvas.toObject 경로로 커스텀 태그를 보존하고 chrome 은 제외한다", () => {
    const canvas = makeCanvas();
    canvas.add(makeChrome(), makeRect(), makePhoto());

    const snap = parseSnapshot(createSnapshot(canvas));
    expect(snap).not.toBeNull();
    expect(snap!.version).toBe(SNAPSHOT_VERSION);
    expect(snap!.objects).toHaveLength(2);

    const [rect, photo] = snap!.objects;
    expect(rect).toMatchObject({
      type: "Rect",
      oType: "rect",
      objectId: "rect-obj-1",
      placeholderSlot: true,
      borderRadiusMm: 3,
    });
    expect(photo).toMatchObject({
      type: "Image",
      oType: "photo",
      objectId: "photo-obj-1",
      photoId: "photo-1",
      cropMode: "cover",
      borderRadiusMm: 2,
      slotWidthMm: 131,
      slotHeightMm: 168,
      shadowBlurMm: 1.5,
    });
    expect(typeof photo!.slotScaleX).toBe("number");
    expect(typeof photo!.slotScaleY).toBe("number");
  });

  it("배경은 스냅샷에 넣지 않는다 — 비동기 배경 로드가 no-op 판정을 깨지 않게", () => {
    const canvas = makeCanvas();
    canvas.add(makeRect());
    const before = createSnapshot(canvas);
    canvas.backgroundColor = "#123456";
    expect(createSnapshot(canvas)).toBe(before);
  });

  it("같은 상태면 같은 문자열 (no-op push 판정 근거)", () => {
    const canvas = makeCanvas();
    canvas.add(makeRect(), makePhoto());
    expect(createSnapshot(canvas)).toBe(createSnapshot(canvas));
  });

  it("전역 fabric 직렬화 정밀도를 바꾼 채로 두지 않는다", () => {
    const before = fabric.config.NUM_FRACTION_DIGITS;
    const canvas = makeCanvas();
    canvas.add(makePhoto());
    createSnapshot(canvas);
    expect(fabric.config.NUM_FRACTION_DIGITS).toBe(before);
  });
});

describe("restoreSnapshotObjects — 스냅샷 → 복원 → 저장 라운드트립", () => {
  it("oType/objectId/photoId/슬롯 태그가 살아 있고 직렬화 결과가 복원 전과 같다", async () => {
    const canvas = makeCanvas();
    const originals = [makeRect(), makePhoto(), makeClipart()];
    canvas.add(makeChrome(), ...originals);
    const before = serializeObjects(originals);
    expect(before.objects).toHaveLength(3);

    const restored = await restoreSnapshotObjects(createSnapshot(canvas), {
      dpi: DPI,
      enliven: makeTestEnliven([]),
    });

    expect(restored).toHaveLength(3);
    expect(restored.map((o) => o.oType)).toEqual(["rect", "photo", "clipart"]);
    expect(restored.map((o) => o.objectId)).toEqual([
      "rect-obj-1",
      "photo-obj-1",
      "clip-obj-1",
    ]);
    const photo = restored[1]!;
    expect(photo.photoId).toBe("photo-1");
    expect(photo.slotWidthMm).toBe(131);
    expect(photo.slotHeightMm).toBe(168);
    expect(photo.slotScaleX).toBe(originals[1]!.slotScaleX);
    expect(restored[2]!.clipartSrc).toBe("https://cdn.test/clipart-star.png");
    expect(restored[2]!.resourceId).toBe("res-1");

    // 저장 불변식 통과 — 태그 없는 사용자 객체 0개.
    expect(findUntaggedUserObjects(restored)).toHaveLength(0);

    // 핵심: 복원한 캔버스를 저장하면 복원 전과 같은 문서 (0객체로 덮어쓰기 금지).
    const after = serializeObjects(restored);
    expect(after.objects).toHaveLength(before.objects.length);
    expect(after.objects.map((o) => o.type)).toEqual(
      before.objects.map((o) => o.type),
    );
    for (let i = 0; i < before.objects.length; i += 1) {
      const a = after.objects[i]!;
      const b = before.objects[i]!;
      expect(a.objectId).toBe(b.objectId);
      // 스냅샷은 전체 정밀도 — fabric 기본 4자리 반올림이면 사진 슬롯이 ~0.03mm 어긋났다.
      expect(a.leftMm).toBeCloseTo(b.leftMm, 9);
      expect(a.topMm).toBeCloseTo(b.topMm, 9);
      expect(a.widthMm).toBeCloseTo(b.widthMm, 9);
      expect(a.heightMm).toBeCloseTo(b.heightMm, 9);
    }
    const photoDoc = after.objects[1]!;
    expect(photoDoc.type).toBe("photo");
    if (photoDoc.type === "photo") {
      // 슬롯(131×168)이 저장된다 — 이미지 박스(224×168)로 부풀지 않는다.
      expect(photoDoc.widthMm).toBeCloseTo(131, 2);
      expect(photoDoc.heightMm).toBeCloseTo(168, 2);
      expect(photoDoc.photoId).toBe("photo-1");
      expect(photoDoc.borderRadiusMm).toBe(2);
      expect(photoDoc.shadow).toEqual({
        blurMm: 1.5,
        offsetYMm: 0.8,
        color: "rgba(0,0,0,0.3)",
      });
    }
  });

  it("복원한 사진의 clip 을 슬롯 태그로 다시 만든다 (photo-slot)", async () => {
    const canvas = makeCanvas();
    canvas.add(makePhoto());
    const restored = await restoreSnapshotObjects(createSnapshot(canvas), {
      dpi: DPI,
      enliven: makeTestEnliven([]),
    });
    const photo = restored[0] as fabric.FabricImage & TaggedFabricObject;
    const clip = photo.clipPath as fabric.Rect | undefined;
    expect(clip).toBeInstanceOf(fabric.Rect);
    const scale = photo.slotScaleX ?? 1;
    // 로컬 clip 크기 × 슬롯 스케일 = 슬롯 px (화면상 칸 크기)
    expect((clip!.width ?? 0) * scale).toBeCloseTo(mmToPx(131, DPI), 4);
    expect((clip!.height ?? 0) * scale).toBeCloseTo(mmToPx(168, DPI), 4);
    expect(clip!.absolutePositioned).toBe(false);
  });

  it("사진 src 는 최신 signed URL 로 바꿔 로드한다 (만료 URL 로 undo 실패 방지)", async () => {
    const canvas = makeCanvas();
    canvas.add(makePhoto(), makeClipart());
    const seen: string[] = [];
    await restoreSnapshotObjects(createSnapshot(canvas), {
      dpi: DPI,
      photoUrls: { "photo-1": "https://cdn.test/thumb-fresh.jpg" },
      enliven: makeTestEnliven(seen),
    });
    expect(seen).toEqual([
      "https://cdn.test/thumb-fresh.jpg",
      // 클립아트는 사진이 아니므로 그대로
      "https://cdn.test/clipart-star.png",
    ]);
  });

  it("실제 fabric enlivenObjects 경로에서도 태그가 보존된다 (Rect)", async () => {
    const canvas = makeCanvas();
    canvas.add(makeRect());
    const restored = await restoreSnapshotObjects(createSnapshot(canvas), {
      dpi: DPI,
    });
    expect(restored).toHaveLength(1);
    expect(restored[0]).toBeInstanceOf(fabric.Rect);
    expect(restored[0]!.oType).toBe("rect");
    expect(restored[0]!.objectId).toBe("rect-obj-1");
    expect(serializeObjects(restored).objects).toHaveLength(1);
  });

  it("형식이 깨진 스냅샷은 reject — 호출자가 포인터를 되돌린다", async () => {
    await expect(
      restoreSnapshotObjects("{not json", { dpi: DPI }),
    ).rejects.toThrow();
    await expect(
      restoreSnapshotObjects(JSON.stringify({ version: "0", objects: [] }), {
        dpi: DPI,
      }),
    ).rejects.toThrow();
  });
});

describe("parseSnapshot / remapPhotoSources", () => {
  it("버전·objects·type 이 맞지 않으면 null", () => {
    expect(parseSnapshot("[]")).toBeNull();
    expect(parseSnapshot(JSON.stringify({ version: "1" }))).toBeNull();
    expect(
      parseSnapshot(JSON.stringify({ version: "1", objects: [{ left: 1 }] })),
    ).toBeNull();
    expect(
      parseSnapshot(JSON.stringify({ version: "1", objects: [] })),
    ).toEqual({ version: "1", objects: [] });
  });

  it("사진만, URL 이 있을 때만 바꾸고 원본 배열은 건드리지 않는다", () => {
    const objects: SerializedFabricObject[] = [
      { type: "Image", oType: "photo", photoId: "a", src: "old-a" },
      { type: "Image", oType: "photo", photoId: "b", src: "old-b" },
      { type: "Image", oType: "clipart", photoId: "a", src: "clip" },
    ];
    const out = remapPhotoSources(objects, { a: "new-a" });
    expect(out.map((o) => o.src)).toEqual(["new-a", "old-b", "clip"]);
    expect(objects[0]!.src).toBe("old-a");
  });
});

describe("findUntaggedUserObjects — 저장 불변식", () => {
  it("태그가 빠진 사용자 객체를 찾아낸다 (QA-1 복원 결과 재현)", () => {
    const untaggedPhoto = { excludeFromExport: false } as {
      excludeFromExport?: boolean;
      oType?: string;
    };
    const chrome = { excludeFromExport: true };
    const tagged = { excludeFromExport: false, oType: "text" };
    expect(findUntaggedUserObjects([chrome, tagged, untaggedPhoto])).toEqual([
      untaggedPhoto,
    ]);
  });

  it("사용자가 모두 지운 캔버스(chrome 만)는 통과 — 빈 문서 저장은 정상", () => {
    expect(
      findUntaggedUserObjects([
        { excludeFromExport: true },
        { excludeFromExport: true },
      ]),
    ).toEqual([]);
    expect(findUntaggedUserObjects([])).toEqual([]);
  });
});

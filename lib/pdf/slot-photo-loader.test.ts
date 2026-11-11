// @vitest-environment node
import type { SharpConstructor } from "sharp";
import { beforeAll, describe, expect, it } from "vitest";

import { loadHardenedSharp } from "@/lib/image/sharp-safe";
import { PAGEDOC_VERSION, type PageDoc, type PhotoObject } from "@/lib/layout/types";

import { PageCanvasPool, renderPageToJpeg, renderPageToPng } from "./render-page";
import { ByteBudgetCache, createSlotPhotoLoader, planPhotoUses } from "./slot-photo-loader";

/**
 * lib/pdf/slot-photo-loader.ts — 같은 사진 반복 사용 시 다운로드·디코드 1회 (D5 측정 후속, 2026-11-11).
 *   - 같은 사진·같은 슬롯 N회 → 원본 resolve 1회.
 *   - 축소 결과 캐시는 바이트 상한을 넘지 않는다.
 *   - loader 경로와 기존 경로(resolve + decodePhotoForSlot)의 렌더 픽셀이 같다.
 */

let sharp: SharpConstructor;

beforeAll(async () => {
  sharp = await loadHardenedSharp();
});

/** 사분면 색이 다른 JPEG — 잘라내기·축소 방향이 틀리면 픽셀이 달라진다. */
async function quadrants(W: number, H: number, opts: { orientation?: number } = {}): Promise<Buffer> {
  const q = (r: number, g: number, b: number) =>
    sharp({ create: { width: W / 2, height: H / 2, channels: 3, background: { r, g, b } } })
      .png()
      .toBuffer();
  const img = sharp({ create: { width: W, height: H, channels: 3, background: { r: 0, g: 0, b: 0 } } })
    .composite([
      { input: await q(220, 40, 40), left: 0, top: 0 },
      { input: await q(40, 200, 60), left: W / 2, top: 0 },
      { input: await q(40, 60, 220), left: 0, top: H / 2 },
      { input: await q(230, 200, 40), left: W / 2, top: H / 2 },
    ])
    .jpeg({ quality: 92 });
  if (opts.orientation) img.withMetadata({ orientation: opts.orientation });
  return img.toBuffer();
}

function photo(id: string, over: Partial<PhotoObject> = {}): PhotoObject {
  return {
    type: "photo",
    objectId: `${id}-${Math.random().toString(36).slice(2, 8)}`,
    photoId: id,
    leftMm: 5,
    topMm: 5,
    widthMm: 30,
    heightMm: 40,
    rotation: 0,
    cropMode: "cover",
    ...over,
  };
}

function page(objects: PhotoObject[], pageNo = 1): PageDoc {
  return {
    version: PAGEDOC_VERSION,
    bookSizeId: "test",
    pageNo,
    layoutMode: "collage",
    widthMm: 80,
    heightMm: 80,
    bleedMm: 2,
    backgroundColor: "#f8f5f0",
    objects,
  };
}

function countingResolver(files: Record<string, Buffer>) {
  const calls: string[] = [];
  return {
    calls,
    resolve: async (id: string): Promise<Buffer> => {
      calls.push(id);
      const b = files[id];
      if (!b) throw new Error(`missing ${id}`);
      return b;
    },
  };
}

describe("planPhotoUses", () => {
  it("렌더 순서대로 사진별 사용 위치를 센다(사진 객체만)", () => {
    const docs = [page([photo("a"), photo("b")]), page([photo("a")], 2)];
    const plan = planPhotoUses(docs);
    expect(plan.get("a")).toEqual([0, 2]);
    expect(plan.get("b")).toEqual([1]);
  });
});

describe("ByteBudgetCache", () => {
  it("LRU(plan 없음) — 상한을 넘지 않고 가장 오래 안 쓴 항목부터 내보낸다", () => {
    const c = new ByteBudgetCache<string>(100);
    c.set("a", "A", 40, "a");
    c.set("b", "B", 40, "b");
    c.get("a"); // a 를 최근으로
    c.set("c", "C", 40, "c");
    expect(c.has("a")).toBe(true);
    expect(c.has("b")).toBe(false);
    expect(c.has("c")).toBe(true);
    expect(c.totalBytes).toBeLessThanOrEqual(100);
    expect(c.peakBytes).toBeLessThanOrEqual(100);
    expect(c.evictions).toBe(1);
  });

  it("상한보다 큰 단일 항목은 넣지 않는다", () => {
    const c = new ByteBudgetCache<string>(100);
    expect(c.set("big", "X", 101, "big")).toBe(false);
    expect(c.size).toBe(0);
  });

  it("다음 사용이 가장 먼 항목부터 내보낸다 — 새 항목이 가장 멀면 넣지 않는다", () => {
    const next: Record<string, number> = { a: 5, b: 50, c: 500 };
    const c = new ByteBudgetCache<string>(100, (g) => next[g] ?? Infinity);
    c.set("a", "A", 40, "a");
    c.set("b", "B", 40, "b");
    expect(c.set("c", "C", 40, "c")).toBe(false); // c 가 가장 멀다
    expect(c.has("a") && c.has("b")).toBe(true);
    next.c = 1;
    expect(c.set("c", "C", 40, "c")).toBe(true); // 이번엔 b 가 가장 멀다
    expect(c.has("b")).toBe(false);
    expect(c.totalBytes).toBe(80);
  });
});

describe("createSlotPhotoLoader", () => {
  const SLOT = { wPx: 300, hPx: 400 };

  it("같은 사진·같은 슬롯 N회(순차) → 원본 resolve 1회, 같은 캔버스", async () => {
    const r = countingResolver({ p1: await quadrants(2400, 1600) });
    const loader = createSlotPhotoLoader({ resolve: r.resolve });
    const first = await loader.load("p1", SLOT, "cover");
    for (let i = 0; i < 9; i++) {
      expect(await loader.load("p1", { wPx: 300.2, hPx: 399.8 }, "cover")).toBe(first);
    }
    expect(r.calls).toEqual(["p1"]);
    expect(loader.stats()).toMatchObject({ fetches: 1, rasterMisses: 1, rasterHits: 9 });
    expect(first.width).toBe(300);
    expect(first.height).toBe(400);
  });

  it("동시 요청(페이지 병렬 렌더)도 원본 resolve·축소 1회", async () => {
    const r = countingResolver({ p1: await quadrants(2400, 1600) });
    const loader = createSlotPhotoLoader({ resolve: r.resolve });
    // 첫 요청이 헤더를 읽은 뒤에 나머지가 같은 축소 작업을 기다린다.
    await loader.load("p1", { wPx: 100, hPx: 100 }, "cover");
    const out = await Promise.all(Array.from({ length: 6 }, () => loader.load("p1", SLOT, "cover")));
    expect(new Set(out).size).toBe(1);
    expect(loader.stats().rasterMisses).toBe(2);
    expect(r.calls.length).toBeLessThanOrEqual(2);
  });

  it("바이트 상한 — 상한보다 큰 축소 결과는 캐시하지 않고(매번 다시 받음) 상한을 넘지 않는다", async () => {
    const r = countingResolver({ p1: await quadrants(2400, 1600) });
    const loader = createSlotPhotoLoader({ resolve: r.resolve, maxBytes: 300 * 400 * 4 - 1 });
    await loader.load("p1", SLOT, "cover");
    await loader.load("p1", SLOT, "cover");
    expect(loader.stats().rasterHits).toBe(0);
    expect(loader.stats().peakBytes).toBe(0);
    expect(r.calls).toEqual(["p1", "p1"]);
  });

  it("순환 재사용 — 캐시가 작업 집합보다 작아도 plan 이 있으면 적중한다(LRU 는 0%)", async () => {
    const files = {
      a: await quadrants(1200, 800),
      b: await quadrants(1200, 800),
      c: await quadrants(1200, 800),
    };
    const slot = { wPx: 100, hPx: 100 };
    const oneRaster = 100 * 100 * 4;
    const ids = ["a", "b", "c", "a", "b", "c", "a", "b", "c"];
    const docs = [page(ids.map((id) => photo(id, { widthMm: 8.4666, heightMm: 8.4666 })))];

    const lru = createSlotPhotoLoader({ resolve: countingResolver(files).resolve, maxBytes: oneRaster * 2 });
    for (const id of ids) await lru.load(id, slot, "cover");
    expect(lru.stats().rasterHits).toBe(0);

    const r = countingResolver(files);
    const planned = createSlotPhotoLoader({ resolve: r.resolve, docs, maxBytes: oneRaster * 2 });
    for (const id of ids) await planned.load(id, slot, "cover");
    expect(planned.stats().rasterHits).toBeGreaterThanOrEqual(4);
    expect(planned.stats().peakBytes).toBeLessThanOrEqual(oneRaster * 2);
    expect(r.calls.length).toBeLessThan(ids.length);
  });

  it("사용이 끝난 사진은 원본 캐시에서 놓도록 알린다", async () => {
    const files = { a: await quadrants(1200, 800), b: await quadrants(1200, 800) };
    const released: string[] = [];
    const docs = [page([photo("a"), photo("b"), photo("a")])];
    const loader = createSlotPhotoLoader({
      resolve: countingResolver(files).resolve,
      docs,
      releaseOriginal: (id) => released.push(id),
    });
    await loader.load("a", SLOT, "cover"); // a 축소 결과 보관 → 원본 놓음
    await loader.load("b", SLOT, "cover"); // b 마지막 사용 → 놓음
    await loader.load("a", SLOT, "cover"); // a 마지막 사용 → 놓음
    expect(released).toEqual(["a", "b", "a"]);
  });

  it("기존 경로 유지 — 업스케일·EXIF 방향 태그는 캐시하지 않고 원본 loadImage, resolve 실패는 throw", async () => {
    const r = countingResolver({
      small: await quadrants(200, 100),
      rotated: await quadrants(2400, 1600, { orientation: 6 }),
    });
    const loader = createSlotPhotoLoader({ resolve: r.resolve });
    const s1 = await loader.load("small", SLOT, "cover");
    await loader.load("small", SLOT, "cover");
    expect([s1.width, s1.height]).toEqual([200, 100]);
    await loader.load("rotated", SLOT, "cover");
    expect(loader.stats()).toMatchObject({ rasterHits: 0, rasterMisses: 0 });
    expect(r.calls).toEqual(["small", "small", "rotated"]);
    await expect(loader.load("missing", SLOT, "cover")).rejects.toThrow("missing");
    await expect(
      createSlotPhotoLoader({ resolve: async () => Buffer.from("not an image") }).load("x", SLOT, "cover"),
    ).rejects.toThrow();
  });
});

describe("렌더 픽셀 동일성 — loader 경로 == 기존 경로", () => {
  it("cover·contain·회전·반복·업스케일·방향 태그·로드 실패가 섞인 페이지", async () => {
    const files: Record<string, Buffer> = {
      big: await quadrants(3000, 2000),
      tall: await quadrants(1600, 2400),
      small: await quadrants(120, 80),
      rotated: await quadrants(2400, 1600, { orientation: 6 }),
    };
    const docs = [
      page([
        photo("big"),
        photo("big", { leftMm: 40, topMm: 5 }),
        photo("big", { leftMm: 5, topMm: 48, widthMm: 30, heightMm: 25, cropMode: "contain" }),
        photo("tall", { leftMm: 40, topMm: 48, widthMm: 30, heightMm: 25, rotation: 12, borderRadiusMm: 2 }),
      ]),
      page(
        [
          photo("big", { shadow: { blurMm: 2, offsetYMm: 1, color: "rgba(0,0,0,0.35)" } }),
          photo("small", { leftMm: 40 }),
          photo("rotated", { leftMm: 5, topMm: 48, widthMm: 30, heightMm: 25 }),
          photo("missing", { leftMm: 40, topMm: 48, widthMm: 30, heightMm: 25 }),
          photo("tall", { leftMm: 40, topMm: 48, widthMm: 30, heightMm: 25, rotation: 12, borderRadiusMm: 2 }),
        ],
        2,
      ),
    ];

    const plain = countingResolver(files);
    const cached = countingResolver(files);
    const loader = createSlotPhotoLoader({ resolve: cached.resolve, docs });

    for (const doc of docs) {
      const a = await renderPageToPng(doc, { resolveImageUrl: plain.resolve });
      const b = await renderPageToPng(doc, { resolveImageUrl: cached.resolve, loadSlotPhoto: loader.load });
      expect(b.equals(a)).toBe(true);
    }
    expect(cached.calls.length).toBeLessThan(plain.calls.length);
    expect(loader.stats().rasterHits).toBeGreaterThanOrEqual(3);
  });
});

describe("PageCanvasPool — 페이지 캔버스 재사용", () => {
  it("같은 크기는 반납한 캔버스를 다시 쓰고, 크기별 보관 수를 넘기지 않는다", () => {
    const pool = new PageCanvasPool(1);
    const a = pool.acquire(40, 30);
    const b = pool.acquire(40, 30);
    pool.release(a);
    pool.release(b); // 보관 한도 1 — 버림
    expect(pool.acquire(40, 30)).toBe(a);
    expect(pool.acquire(40, 30)).not.toBe(b);
    expect(pool.acquire(30, 40)).not.toBe(a);
  });

  it("재사용 캔버스의 렌더 픽셀 == 새 캔버스 (투명 배경·회전 clip·highQuality=false 섞어 연속 렌더)", async () => {
    const files = { big: await quadrants(3000, 2000), small: await quadrants(120, 80) };
    const r = countingResolver(files);
    const docs: PageDoc[] = [
      page([photo("big", { rotation: 30, borderRadiusMm: 3 }), photo("small", { leftMm: 40 })]),
      { ...page([photo("big", { leftMm: 20, topMm: 20, cropMode: "contain" })], 2), backgroundColor: "rgba(0,0,0,0)" },
      { ...page([], 3), backgroundColor: "rgba(255,0,0,0.3)" },
      page([photo("small", { widthMm: 70, heightMm: 70 })], 4),
    ];
    const pool = new PageCanvasPool();
    for (const hq of [true, false]) {
      for (const doc of docs) {
        const fresh = await renderPageToPng(doc, { resolveImageUrl: r.resolve, highQuality: hq });
        const pooled = await renderPageToPng(doc, { resolveImageUrl: r.resolve, highQuality: hq, canvasPool: pool });
        expect(pooled.equals(fresh)).toBe(true);
        const freshJ = await renderPageToJpeg(doc, { resolveImageUrl: r.resolve, highQuality: hq });
        const pooledJ = await renderPageToJpeg(doc, { resolveImageUrl: r.resolve, highQuality: hq, canvasPool: pool });
        expect(pooledJ.equals(freshJ)).toBe(true);
      }
    }
  });
});

describe("PageCanvasPool.clear", () => {
  it("clear 후에는 보관하지 않고 새 캔버스를 만든다", async () => {
    const { PageCanvasPool } = await import("./render-page");
    const pool = new PageCanvasPool(2);
    const a = pool.acquire(10, 10);
    pool.release(a);
    expect(pool.acquire(10, 10)).toBe(a);
    pool.release(a);
    pool.clear();
    pool.release(a); // 무시돼야 함
    expect(pool.acquire(10, 10)).not.toBe(a);
  });
});

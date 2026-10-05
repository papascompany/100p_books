// @vitest-environment node
import type { Canvas } from "@napi-rs/canvas";
import type { SharpConstructor } from "sharp";
import { beforeAll, describe, expect, it } from "vitest";

import { loadHardenedSharp } from "@/lib/image/sharp-safe";

import { decodePhotoForSlot, downscaleTarget, slotScale } from "./photo-downscale";

/**
 * lib/pdf/photo-downscale.ts — PDF 사진 슬롯 축소 디코드 (collage-6 메모리 한도 대응, 2026-10-05).
 *   - 축소가 필요할 때만 슬롯 크기로 줄인다(cover = 슬롯 크기·가운데 잘라내기, contain = 비율 유지).
 *   - 업스케일·EXIF 방향 태그·sharp 실패는 기존 경로(원본 loadImage)로 — 렌더 결과를 바꾸지 않는다.
 */

let sharp: SharpConstructor;

beforeAll(async () => {
  sharp = await loadHardenedSharp();
});

/** 왼쪽 절반 빨강 · 오른쪽 절반 파랑 (가로 W × 세로 H). */
async function halves(W: number, H: number, opts: { orientation?: number } = {}): Promise<Buffer> {
  const left = await sharp({
    create: { width: W / 2, height: H, channels: 3, background: { r: 255, g: 0, b: 0 } },
  })
    .png()
    .toBuffer();
  const img = sharp({ create: { width: W, height: H, channels: 3, background: { r: 0, g: 0, b: 255 } } })
    .composite([{ input: left, left: 0, top: 0 }])
    .jpeg({ quality: 95 });
  if (opts.orientation) img.withMetadata({ orientation: opts.orientation });
  return img.toBuffer();
}

function pixel(c: Canvas, x: number, y: number): [number, number, number] {
  const d = c.getContext("2d").getImageData(x, y, 1, 1).data;
  return [d[0] ?? 0, d[1] ?? 0, d[2] ?? 0];
}

describe("slotScale · downscaleTarget — 기존 drawPhoto 수식과 동일", () => {
  const img = { width: 4000, height: 3000 };
  const slot = { wPx: 1000, hPx: 1000 };

  it("cover 는 max, contain 은 min 배율", () => {
    expect(slotScale(img, slot, "cover")).toBeCloseTo(1000 / 3000);
    expect(slotScale(img, slot, "contain")).toBeCloseTo(1000 / 4000);
    expect(slotScale(img, slot, undefined)).toBeCloseTo(1000 / 3000);
  });

  it("cover 목표 = 슬롯 크기, contain 목표 = 비율 유지 크기", () => {
    expect(downscaleTarget(img, { wPx: 999.6, hPx: 700.4 }, "cover")).toEqual({ width: 1000, height: 700 });
    expect(downscaleTarget(img, slot, "contain")).toEqual({ width: 1000, height: 750 });
  });
});

describe("decodePhotoForSlot", () => {
  it("cover — 원본 4000×2000 을 슬롯 400×400 으로 줄이고 가운데를 잘라낸다", async () => {
    const buf = await halves(4000, 2000);
    const r = await decodePhotoForSlot(buf, { wPx: 400, hPx: 400 }, "cover");
    expect(r.downscaled).toBe(true);
    expect(r.image.width).toBe(400);
    expect(r.image.height).toBe(400);
    // 가운데 2000×2000 을 잘랐으므로 왼쪽 절반 빨강·오른쪽 절반 파랑이 그대로 남는다.
    const c = r.image as Canvas;
    const [lr, , lb] = pixel(c, 50, 200);
    const [rr, , rb] = pixel(c, 350, 200);
    expect(lr).toBeGreaterThan(200);
    expect(lb).toBeLessThan(50);
    expect(rb).toBeGreaterThan(200);
    expect(rr).toBeLessThan(50);
  });

  it("contain — 비율을 유지한 채 슬롯 안에 들어가는 크기로 줄인다", async () => {
    const buf = await halves(4000, 2000);
    const r = await decodePhotoForSlot(buf, { wPx: 400, hPx: 400 }, "contain");
    expect(r.downscaled).toBe(true);
    expect(r.image.width).toBe(400);
    expect(r.image.height).toBe(200);
  });

  it("업스케일(원본이 슬롯보다 작음)은 원본 그대로 — 렌더 결과 불변", async () => {
    const buf = await halves(200, 100);
    const r = await decodePhotoForSlot(buf, { wPx: 400, hPx: 400 }, "cover");
    expect(r.downscaled).toBe(false);
    expect(r.image.width).toBe(200);
    expect(r.image.height).toBe(100);
  });

  it("EXIF orientation 이 1 이 아닌 옛 원본은 건드리지 않는다", async () => {
    const buf = await halves(4000, 2000, { orientation: 6 });
    const r = await decodePhotoForSlot(buf, { wPx: 400, hPx: 400 }, "cover");
    expect(r.downscaled).toBe(false);
  });

  it("sharp 가 거부하는 입력은 기존 경로로 넘기고, 그 경로도 실패하면 throw(호출 측 placeholder)", async () => {
    await expect(decodePhotoForSlot(Buffer.from("not an image"), { wPx: 10, hPx: 10 }, "cover")).rejects.toThrow();
  });
});

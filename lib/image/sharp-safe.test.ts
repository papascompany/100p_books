// @vitest-environment node
import { crc32 } from "node:zlib";

import type { SharpConstructor } from "sharp";
import { beforeAll, describe, expect, it } from "vitest";

import { MAX_INPUT_PIXELS } from "./constants";
import { UNTRUSTED_INPUT_OPTIONS, loadHardenedSharp } from "./sharp-safe";
import { sniffImageFormat } from "./sniff";

/**
 * lib/image/sharp-safe.test.ts — 실제 sharp 네이티브 바이너리로 검증한다.
 *
 * 고정하려는 계약:
 *   1. 로더 allowlist 적용 후에도 서비스가 쓰는 JPEG/PNG/WebP 는 디코드·회전·썸네일이 된다.
 *   2. HEIF/AVIF·GIF·TIFF·SVG 는 디코더에 닿기 전에 "unsupported image format" 으로 거부된다.
 *      libvips 는 모르는 operation 이름을 조용히 무시하므로, sharp/libvips 업그레이드로 로더
 *      이름이 바뀌면 여기서 깨져야 한다.
 *   3. 픽셀 한도는 헤더 단계(metadata)에서 강제된다 — 작은 파일이 거대한 크기를 선언하는 압축 폭탄 방어.
 *   4. 매직 바이트 판정이 sharp 가 실제로 만든 바이트와 일치한다(특히 AVIF brand).
 */

let sharp: SharpConstructor;

/** 차단과 무관하게 만들 수 있는 입력들 — 인코더·create 는 로더가 아니다. */
const samples: Record<string, Buffer> = {};

beforeAll(async () => {
  sharp = await loadHardenedSharp();
  const base = () =>
    sharp({ create: { width: 64, height: 48, channels: 4, background: { r: 10, g: 120, b: 200, alpha: 0.5 } } });
  samples.jpeg = await base().flatten().jpeg().withMetadata({ orientation: 6 }).toBuffer();
  samples.jpegCmyk = await base().flatten().toColourspace("cmyk").jpeg().toBuffer();
  samples.png = await base().png().toBuffer();
  samples.png16 = await base().toColourspace("rgb16").png().toBuffer();
  samples.webp = await base().webp().toBuffer();
  samples.webpLossless = await base().webp({ lossless: true }).toBuffer();
  samples.gif = await base().gif().toBuffer();
  samples.tiff = await base().tiff().toBuffer();
  samples.avif = await base().avif().toBuffer();
  samples.svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8"/></svg>');
});

/** 64×48 PNG 의 IHDR 크기만 바꿔(CRC 재계산) 거대한 이미지를 선언하는 작은 파일을 만든다. */
function pngDeclaring(width: number, height: number): Buffer {
  const png = Buffer.from(samples.png!);
  // 8(signature) + 4(length) + 4("IHDR") 뒤가 width/height
  png.writeUInt32BE(width, 16);
  png.writeUInt32BE(height, 20);
  png.writeUInt32BE(crc32(png.subarray(12, 29)), 29); // "IHDR" + 13바이트 데이터의 CRC
  return png;
}

describe("loadHardenedSharp — 로더 allowlist", () => {
  it("같은 인스턴스를 재사용한다 (block/unblock 은 한 번만)", async () => {
    expect(await loadHardenedSharp()).toBe(sharp);
  });

  it.each(["jpeg", "jpegCmyk", "png", "png16", "webp", "webpLossless"])(
    "%s 는 업로드 파이프라인(rotate → toBuffer → webp 썸네일)을 통과한다",
    async (name) => {
      const input = samples[name]!;
      const normalized = sharp(input, { ...UNTRUSTED_INPUT_OPTIONS, failOn: "none" }).rotate();
      const meta = await normalized.metadata();
      const out = await normalized.toBuffer();
      const thumb = await sharp(out, UNTRUSTED_INPUT_OPTIONS)
        .resize({ width: 32, height: 32, fit: "inside", withoutEnlargement: true })
        .webp({ quality: 80 })
        .toBuffer();

      expect(meta.format).toBe(sniffImageFormat(input));
      expect((await sharp(out).metadata()).format).toBe(meta.format);
      expect((await sharp(thumb).metadata()).format).toBe("webp");
    },
  );

  it("EXIF orientation 을 적용하고 메타데이터(EXIF)를 남기지 않는다", async () => {
    const out = await sharp(samples.jpeg!, { ...UNTRUSTED_INPUT_OPTIONS, failOn: "none" }).rotate().toBuffer();
    const meta = await sharp(out).metadata();
    expect([meta.width, meta.height]).toEqual([48, 64]); // orientation 6 → 90° 회전
    expect(meta.orientation).toBeUndefined();
    expect(meta.exif).toBeUndefined();
  });

  it.each(["avif", "gif", "tiff", "svg"])("%s 는 디코드 단계에서 거부된다", async (name) => {
    await expect(sharp(samples[name]!, UNTRUSTED_INPUT_OPTIONS).metadata()).rejects.toThrow(
      /unsupported image format/i,
    );
  });
});

describe("UNTRUSTED_INPUT_OPTIONS — 픽셀 한도", () => {
  it("한도를 명시한다", () => {
    expect(UNTRUSTED_INPUT_OPTIONS.limitInputPixels).toBe(MAX_INPUT_PIXELS);
  });

  it("한도를 넘는 크기를 선언한 작은 PNG 는 헤더 단계에서 거부된다", async () => {
    const bomb = pngDeclaring(20_000, 20_000); // 400MP
    expect(bomb.length).toBeLessThan(1024);
    await expect(sharp(bomb, UNTRUSTED_INPUT_OPTIONS).metadata()).rejects.toThrow(/pixel limit/i);
  });

  it("한도 이내 선언은 헤더를 읽는다 (IHDR 조작이 유효함을 확인)", async () => {
    const meta = await sharp(pngDeclaring(10_000, 10_000), UNTRUSTED_INPUT_OPTIONS).metadata();
    expect([meta.width, meta.height]).toEqual([10_000, 10_000]);
  });
});

describe("sniffImageFormat — sharp 가 실제로 만든 바이트", () => {
  it.each([
    ["jpeg", "jpeg"],
    ["png", "png"],
    ["webp", "webp"],
    ["webpLossless", "webp"],
    ["gif", "gif"],
    ["tiff", "tiff"],
    ["avif", "avif"],
    ["svg", "unknown"],
  ])("%s → %s", (name, expected) => {
    expect(sniffImageFormat(samples[name]!)).toBe(expected);
  });
});

// @vitest-environment node
import type { SharpConstructor } from "sharp";
import { beforeAll, describe, expect, it } from "vitest";

import { MAX_FILE_BYTES } from "@/lib/image/constants";
import { loadHardenedSharp } from "@/lib/image/sharp-safe";

import { InvalidOriginalError, validatePdfOriginal } from "./validate-original";

/**
 * lib/pdf/validate-original.test.ts — PDF 조립 직전 원본 재검증 계약.
 * 업로드 검증 뒤 storage 객체가 바뀌어도 loadImage 에 닿기 전에 막히는지 실제 sharp 로 확인한다.
 */
let sharp: SharpConstructor;
const samples = {} as Record<"jpeg" | "png" | "webp" | "gif" | "avif", Buffer>;

beforeAll(async () => {
  sharp = await loadHardenedSharp();
  const base = () =>
    sharp({ create: { width: 32, height: 24, channels: 3, background: { r: 200, g: 50, b: 50 } } });
  samples.jpeg = await base().jpeg().toBuffer();
  samples.png = await base().png().toBuffer();
  samples.webp = await base().webp().toBuffer();
  samples.gif = await base().gif().toBuffer();
  samples.avif = await base().avif().toBuffer();
});

async function reason(buf: Buffer): Promise<string> {
  try {
    await validatePdfOriginal("p1", buf);
    return "ok";
  } catch (e) {
    expect(e).toBeInstanceOf(InvalidOriginalError);
    return (e as InvalidOriginalError).reason;
  }
}

describe("validatePdfOriginal", () => {
  it("JPEG/PNG/WebP 는 통과한다", async () => {
    expect(await reason(samples.jpeg)).toBe("ok");
    expect(await reason(samples.png)).toBe("ok");
    expect(await reason(samples.webp)).toBe("ok");
  });

  it("GIF·AVIF·임의 바이트·빈 버퍼는 거부한다", async () => {
    expect(await reason(samples.gif)).toMatch(/format not allowed/);
    expect(await reason(samples.avif)).toMatch(/format not allowed/);
    expect(await reason(Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>"))).toMatch(
      /format not allowed/,
    );
    expect(await reason(Buffer.alloc(0))).toBe("empty");
  });

  it("매직 바이트만 JPEG 이고 본문이 깨진 파일은 디코드 단계에서 거부한다", async () => {
    const fake = Buffer.concat([samples.jpeg.subarray(0, 4), Buffer.alloc(64, 0x41)]);
    expect(await reason(fake)).toMatch(/decode rejected|format mismatch|bad dimensions/);
  });

  it("크기 한도를 넘으면 디코드 전에 거부한다", async () => {
    const big = Buffer.alloc(MAX_FILE_BYTES + 1);
    samples.jpeg.copy(big);
    expect(await reason(big)).toMatch(/too large/);
  });

  it("픽셀 한도를 넘는 헤더(압축 폭탄)를 거부한다", async () => {
    // PNG IHDR 의 폭·높이만 부풀린다 — 작은 파일이 거대한 크기를 선언하는 형태.
    const png = Buffer.from(samples.png);
    png.writeUInt32BE(30_000, 16);
    png.writeUInt32BE(30_000, 20);
    expect(await reason(png)).toMatch(/decode rejected|bad dimensions/);
  });
});

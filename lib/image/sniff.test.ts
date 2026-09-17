import { describe, expect, it } from "vitest";

import { ALLOWED_MIME_TYPES } from "./constants";
import { sniffAllowedImage, sniffImageFormat, type SniffedFormat } from "./sniff";

/**
 * lib/image/sniff.test.ts
 *
 * 고정하려는 계약: 서버 디코더에 넘기기 전 **바이트로** 형식을 판정한다(SEC-1).
 * 특히 AVIF 는 sharp 가 format='heif' 로 보고해 예전 화이트리스트를 통과했으므로,
 * ftyp brand 로 HEIC 와 AVIF 를 구분하는 경계를 표로 고정한다.
 */

const ascii = (s: string): number[] => Array.from(s, (c) => c.charCodeAt(0));

/** ISO-BMFF ftyp 박스 (+ 뒤따르는 더미 바이트). size 는 실제 박스 길이로 채운다. */
function ftyp(major: string, compatible: string[], opts: { size?: number } = {}): Uint8Array {
  const body = [...ascii(major), 0, 0, 0, 0, ...compatible.flatMap(ascii)];
  const size = opts.size ?? 8 + body.length;
  return Uint8Array.from([
    (size >>> 24) & 0xff,
    (size >>> 16) & 0xff,
    (size >>> 8) & 0xff,
    size & 0xff,
    ...ascii("ftyp"),
    ...body,
    ...ascii("\0\0\0\x08meta"),
  ]);
}

const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, ...ascii("JFIF"), 0x00]);
const JPEG_EXIF = Uint8Array.from([0xff, 0xd8, 0xff, 0xe1, 0x12, 0x34, ...ascii("Exif"), 0, 0]);
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, ...ascii("IHDR")]);
const webp = (chunk: string) =>
  Uint8Array.from([...ascii("RIFF"), 0x24, 0, 0, 0, ...ascii("WEBP"), ...ascii(chunk), 0, 0, 0, 0]);

const CASES: Array<[name: string, bytes: Uint8Array, format: SniffedFormat, mime: string | null]> = [
  // 허용
  ["JPEG (JFIF)", JPEG, "jpeg", "image/jpeg"],
  ["JPEG (EXIF APP1)", JPEG_EXIF, "jpeg", "image/jpeg"],
  ["PNG", PNG, "png", "image/png"],
  ["WebP lossy (VP8)", webp("VP8 "), "webp", "image/webp"],
  ["WebP lossless (VP8L)", webp("VP8L"), "webp", "image/webp"],
  ["WebP extended (VP8X)", webp("VP8X"), "webp", "image/webp"],
  ["HEIC (Apple: heic + mif1)", ftyp("heic", ["mif1", "heic"]), "heic", "image/heic"],
  ["HEIC (heix)", ftyp("heix", ["mif1"]), "heic", "image/heic"],
  ["HEIC (hevc 시퀀스)", ftyp("hevc", ["msf1"]), "heic", "image/heic"],
  ["HEIC (major mif1 + compatible heic)", ftyp("mif1", ["heic"]), "heic", "image/heic"],
  ["HEIF 일반 (mif1 만)", ftyp("mif1", ["miaf"]), "heif", "image/heif"],

  // 거부 — AVIF
  ["AVIF (avif)", ftyp("avif", ["mif1", "miaf"]), "avif", null],
  ["AVIF 시퀀스 (avis)", ftyp("avis", ["msf1"]), "avif", null],
  ["AVIF (major mif1 + compatible avif)", ftyp("mif1", ["avif", "miaf"]), "avif", null],
  ["AVIF 와 HEIC brand 동시 표기 → AVIF 로 판정", ftyp("heic", ["avif"]), "avif", null],

  // 거부 — 기타 형식
  ["GIF89a", Uint8Array.from([...ascii("GIF89a"), 1, 0, 1, 0]), "gif", null],
  ["GIF87a", Uint8Array.from([...ascii("GIF87a"), 1, 0, 1, 0]), "gif", null],
  ["TIFF (II)", Uint8Array.from([0x49, 0x49, 0x2a, 0x00, 8, 0, 0, 0]), "tiff", null],
  ["TIFF (MM)", Uint8Array.from([0x4d, 0x4d, 0x00, 0x2a, 0, 0, 0, 8]), "tiff", null],
  ["BigTIFF", Uint8Array.from([0x49, 0x49, 0x2b, 0x00, 8, 0, 0, 0]), "tiff", null],
  ["SVG 텍스트", Uint8Array.from(ascii('<svg xmlns="http://www.w3.org/2000/svg"/>')), "unknown", null],
  ["MP4 (isom)", ftyp("isom", ["iso2", "mp41"]), "unknown", null],
  ["빈 바이트", new Uint8Array(0), "unknown", null],
  ["JPEG 서명 불완전 (FF D8 만)", Uint8Array.from([0xff, 0xd8]), "unknown", null],
  ["RIFF 이지만 WAVE", Uint8Array.from([...ascii("RIFF"), 0, 0, 0, 0, ...ascii("WAVE"), ...ascii("fmt ")]), "unknown", null],
  ["RIFF/WEBP 이지만 청크 이름이 비정상", webp("ABCD"), "unknown", null],
  ["PNG 서명 1바이트 변조", Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0b]), "unknown", null],

  // 거부 — 비정상 ftyp
  ["ftyp size=1 (largesize)", ftyp("heic", ["mif1"], { size: 1 }), "unknown", null],
  ["ftyp size<16", ftyp("heic", ["mif1"], { size: 12 }), "unknown", null],
  ["ftyp 잘림 (16바이트 미만)", Uint8Array.from([0, 0, 0, 24, ...ascii("ftyp"), ...ascii("hei")]), "unknown", null],
];

describe("sniffAllowedImage — 업로드 사진 허용 목록 (ALLOWED_MIME_TYPES)", () => {
  it.each(CASES)("%s", (_name, bytes, format, mime) => {
    expect(sniffImageFormat(bytes)).toBe(format);
    expect(sniffAllowedImage(bytes, ALLOWED_MIME_TYPES)).toEqual({ format, mime });
  });

  it("ftyp size=0 (파일 끝까지) 은 뒤따르는 brand 까지 읽는다", () => {
    expect(sniffImageFormat(ftyp("mif1", ["avif"], { size: 0 }))).toBe("avif");
  });

  it("JPEG 서명 뒤에 ftyp 를 끼운 polyglot 은 JPEG 로 통과시키지 않는다", () => {
    const polyglot = Uint8Array.from([0xff, 0xd8, 0xff, 0xe1, ...ascii("ftyp"), ...ascii("heic"), 0, 0, 0, 0]);
    expect(sniffImageFormat(polyglot)).not.toBe("jpeg");
    expect(sniffAllowedImage(polyglot, ["image/jpeg"]).mime).toBeNull();
  });

  it("클라이언트 선언 MIME 과 무관하게 바이트만 본다 (AVIF 를 image/jpeg 로 선언해도 거부)", () => {
    const avif = ftyp("avif", ["mif1"]);
    expect(sniffAllowedImage(avif, ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]).mime).toBeNull();
  });
});

describe("sniffAllowedImage — 리소스 종류별 허용 목록", () => {
  const BACKGROUND = ["image/jpeg", "image/png"];

  it.each([
    ["JPEG", JPEG, "image/jpeg"],
    ["PNG", PNG, "image/png"],
    ["WebP", webp("VP8 "), null],
    ["HEIC", ftyp("heic", ["mif1"]), null],
    ["GIF", Uint8Array.from(ascii("GIF89a")), null],
  ] as const)("배경: %s", (_name, bytes, mime) => {
    expect(sniffAllowedImage(bytes, BACKGROUND).mime).toBe(mime);
  });

  it("허용 목록 대소문자는 무시한다", () => {
    expect(sniffAllowedImage(PNG, ["IMAGE/PNG"]).mime).toBe("IMAGE/PNG");
  });
});

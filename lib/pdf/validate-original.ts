import "server-only";

import { MAX_FILE_BYTES, MAX_INPUT_PIXELS } from "@/lib/image/constants";
import { UNTRUSTED_INPUT_OPTIONS, loadHardenedSharp } from "@/lib/image/sharp-safe";
import { sniffAllowedImage } from "@/lib/image/sniff";

/**
 * PDF 조립 직전 사진 원본 재검증 (심층 방어).
 *
 * 업로드 경로(photos/complete)는 매직 바이트·sharp 검증 뒤 정규화 원본을 저장한다. 그러나 PDF 빌드는
 * storage 에서 받은 바이트를 `@napi-rs/canvas` 의 `loadImage` 로 바로 디코드한다 — 저장 후 객체가
 * 바뀌었다면(0032 이전 사용자 세션 upsert, 운영자 실수, 다른 경로 버그) 검증되지 않은 바이트가
 * 인쇄 파이프라인의 디코더에 닿는다. 여기서 업로드와 같은 기준으로 다시 막는다.
 *
 *   1. 크기 ≤ MAX_FILE_BYTES
 *   2. 매직 바이트가 JPEG/PNG/WebP (행의 mime 은 보지 않는다 — 초기 행은 클라 선언값이라 신뢰 불가)
 *   3. 로더 allowlist sharp 로 헤더 파싱 + 픽셀 한도(압축 폭탄) — 판정 포맷이 매직 바이트와 일치
 */
const PDF_ALLOWED_MIMES = ["image/jpeg", "image/png", "image/webp"] as const;

export class InvalidOriginalError extends Error {
  constructor(
    readonly photoId: string,
    readonly reason: string,
  ) {
    super(`[pdf/photos] invalid original for ${photoId}: ${reason}`);
    this.name = "InvalidOriginalError";
  }
}

const SHARP_FORMAT_BY_MIME: Record<(typeof PDF_ALLOWED_MIMES)[number], string> = {
  "image/jpeg": "jpeg",
  "image/png": "png",
  "image/webp": "webp",
};

export async function validatePdfOriginal(photoId: string, buf: Buffer): Promise<void> {
  if (buf.byteLength === 0) throw new InvalidOriginalError(photoId, "empty");
  if (buf.byteLength > MAX_FILE_BYTES) {
    throw new InvalidOriginalError(photoId, `too large (${buf.byteLength} bytes)`);
  }

  const sniffed = sniffAllowedImage(buf, PDF_ALLOWED_MIMES);
  if (!sniffed.mime) {
    throw new InvalidOriginalError(photoId, `format not allowed (${sniffed.format})`);
  }

  const sharp = await loadHardenedSharp();
  let meta: { format?: string; width?: number; height?: number };
  try {
    meta = await sharp(buf, UNTRUSTED_INPUT_OPTIONS).metadata();
  } catch (e) {
    throw new InvalidOriginalError(
      photoId,
      `decode rejected (${e instanceof Error ? e.message.slice(0, 80) : "unknown"})`,
    );
  }
  if (meta.format !== SHARP_FORMAT_BY_MIME[sniffed.mime]) {
    throw new InvalidOriginalError(
      photoId,
      `format mismatch (sniffed ${sniffed.format}, decoded ${meta.format ?? "none"})`,
    );
  }
  const { width = 0, height = 0 } = meta;
  if (width <= 0 || height <= 0 || width * height > MAX_INPUT_PIXELS) {
    throw new InvalidOriginalError(photoId, `bad dimensions (${width}x${height})`);
  }
}

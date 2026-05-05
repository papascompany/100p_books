/**
 * 이미지 파이프라인 공통 상수.
 * 클라/서버 양쪽에서 import 가능 (순수 값만).
 */

/** 단일 파일 최대 크기 (20MB). */
export const MAX_FILE_BYTES = 20 * 1024 * 1024;

/** 단일 프로젝트당 최대 사진 수. */
export const MAX_PHOTOS_PER_PROJECT = 100;

/** 업로드 시 동시성 제한. */
export const UPLOAD_CONCURRENCY = 6;

/** 썸네일 긴 변(px). */
export const THUMB_LONG_EDGE = 480;

/** 서버 sharp webp 품질 (0-100). */
export const THUMB_WEBP_QUALITY = 80;

/** Storage 버킷 이름. */
export const ORIGINALS_BUCKET = "photo-originals";
export const THUMBS_BUCKET = "photo-thumbs";

/** 허용 MIME. HEIC/HEIF 는 클라에서 JPEG 로 변환 후 업로드되지만 관용적으로 허용. */
export const ALLOWED_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
] as const;

export type AllowedMime = (typeof ALLOWED_MIME_TYPES)[number];

/** MIME → 파일 확장자 매핑. */
export function extForMime(mime: string): string {
  switch (mime) {
    case "image/jpeg":
      return "jpg";
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    case "image/heic":
      return "heic";
    case "image/heif":
      return "heif";
    default:
      return "bin";
  }
}

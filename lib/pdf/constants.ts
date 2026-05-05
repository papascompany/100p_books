/**
 * PDF 파이프라인 공통 상수.
 * 클라/서버 모두 import 가능 (순수 값만).
 */

/** 인쇄 출력 DPI. */
export const PRINT_DPI = 300;

/** 사방 재단 여유 (mm). PageDoc.bleedMm 와 동일해야 한다. */
export const BLEED_MM = 2;

/** 1 inch = 25.4 mm. */
export const MM_PER_INCH = 25.4;

/** 1 inch = 72 PDF point. */
export const PT_PER_INCH = 72;

/** mm → px (지정 dpi). */
export function mmToPx(mm: number, dpi: number = PRINT_DPI): number {
  return (mm * dpi) / MM_PER_INCH;
}

/** mm → pt (PDF 좌표). */
export function mmToPt(mm: number): number {
  return (mm * PT_PER_INCH) / MM_PER_INCH;
}

/** pt → px (지정 dpi). */
export function ptToPx(pt: number, dpi: number = PRINT_DPI): number {
  return (pt * dpi) / PT_PER_INCH;
}

/** PDF 산출 Storage 버킷. */
export const PDFS_BUCKET = "pdfs";

/** PDF 다운로드 signed URL TTL (1시간). */
export const PDF_SIGNED_TTL_SEC = 3600;

/** PNG 렌더 동시성 (메모리 보호). */
export const RENDER_CONCURRENCY = 4;

/** 사진 LRU 캐시 한도 (byte). */
export const PHOTO_CACHE_MAX_BYTES = 100 * 1024 * 1024;

/** crop mark 길이 (mm). */
export const CROP_MARK_LEN_MM = 4;

/** crop mark 두께 (pt). */
export const CROP_MARK_WIDTH_PT = 0.25;

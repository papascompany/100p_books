import { ALLOWED_MIME_TYPES, MAX_FILE_BYTES } from "./constants";

/**
 * 단일 파일 검증. 유효하면 null, 실패면 사람 읽기 좋은 한국어 메시지 반환.
 * 클라/서버 공용.
 */
export function validateFile(file: {
  name?: string;
  type: string;
  size: number;
}): string | null {
  const mime = (file.type || "").toLowerCase();
  const name = (file.name ?? "").toLowerCase();
  const looksHeic = name.endsWith(".heic") || name.endsWith(".heif");

  if (!mime && !looksHeic) {
    return "파일 형식을 확인할 수 없습니다.";
  }

  if (
    mime &&
    !ALLOWED_MIME_TYPES.includes(mime as (typeof ALLOWED_MIME_TYPES)[number]) &&
    !looksHeic
  ) {
    return "JPEG, PNG, WebP, HEIC 형식만 업로드 가능합니다.";
  }

  if (!Number.isFinite(file.size) || file.size <= 0) {
    return "빈 파일이거나 크기를 읽을 수 없습니다.";
  }

  if (file.size > MAX_FILE_BYTES) {
    return `파일 크기가 ${Math.round(MAX_FILE_BYTES / 1024 / 1024)}MB를 초과합니다.`;
  }

  return null;
}

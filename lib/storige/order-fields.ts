import "server-only";

import type {
  StorigeValidationCache,
  StorigeValidationResult,
} from "@/lib/db/types";

/** PDF 빌드 성공 결과(onSuccess payload / runProjectPdfBuild 반환)의 부분집합. */
export interface PdfBuildSuccessFields {
  coverKey?: string; // Storige 파일 ID
  interiorKey?: string; // Storige 파일 ID
  coverValidation?: StorigeValidationResult;
  interiorValidation?: StorigeValidationResult;
}

/**
 * 빌드 성공 결과 → orders 갱신 patch (Storige fileId + 검증 캐시).
 *
 *   - storige_cover_file_id / storige_interior_file_id 에 fileId 기록.
 *   - storige_validation 에 표지/내지 검증 결과 캐시(있을 때만).
 *   - 빈 객체면 호출자는 update 를 건너뛰면 된다.
 *
 * 부분 빌드(target='cover'|'interior')는 해당 파트만 갱신한다. 단,
 * storige_validation 은 통째로 교체되므로 부분 재빌드 시 반대편 검증 결과가
 * 사라질 수 있다(허용 — 검증은 재생성 가능한 파생물).
 */
export function storigeOrderPatch(
  r: PdfBuildSuccessFields,
  nowIso: string,
): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  if (r.coverKey) patch.storige_cover_file_id = r.coverKey;
  if (r.interiorKey) patch.storige_interior_file_id = r.interiorKey;
  if (r.coverValidation || r.interiorValidation) {
    const validation: StorigeValidationCache = { validatedAt: nowIso };
    if (r.coverValidation) validation.cover = r.coverValidation;
    if (r.interiorValidation) validation.interior = r.interiorValidation;
    patch.storige_validation = validation;
  }
  return patch;
}

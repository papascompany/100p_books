/**
 * Storige 인쇄 검증 결과 → 발주(in_production) 게이트 판정.
 *
 * 정책 (2-D Option ② — 2026-07):
 *   - 차단: FIXABLE / FAILED — 워커가 명시적으로 "규격 에러 존재"를 판정한 상태.
 *     (FIXABLE = 에러 전부 autoFixable, FAILED = 수정불가 에러 — 둘 다 에러 ≥1)
 *   - 비차단: COMPLETED(통과) 는 물론, ERROR / PROCESSING / SKIPPED / 미검증도
 *     차단하지 않는다. 검증은 best-effort(폴링 4s 예산, 키 미설정 시 생략)라
 *     "검증이 못 돌았다"는 이유로 발주를 막으면 정상 주문이 무한 보류된다.
 *   - 차단돼도 관리자는 force 로 오버라이드 가능(감사로그 기록) — 최종 판단은 사람.
 */

import type { StorigeValidationCache } from "@/lib/db/types";

/** 발주를 보류시키는 워커 판정 상태. */
export const BLOCKING_VALIDATION_STATUSES = ["FIXABLE", "FAILED"] as const;

export interface ValidationBlock {
  part: "cover" | "interior";
  status: string;
  /** 워커 result.errors 개수 (있을 때만). */
  errorCount?: number;
}

/**
 * 검증 캐시에서 발주 차단 사유 목록을 계산한다. 빈 배열 = 발주 가능.
 * 순수 함수 — 서버 라우트(권위 판정)와 관리자 페이지(배너 표시)가 공유.
 */
export function getValidationBlocks(
  v: StorigeValidationCache | null | undefined,
): ValidationBlock[] {
  if (!v) return [];
  const blocks: ValidationBlock[] = [];
  for (const part of ["cover", "interior"] as const) {
    const r = v[part];
    if (!r) continue;
    const status = (r.status ?? "").toUpperCase();
    if ((BLOCKING_VALIDATION_STATUSES as readonly string[]).includes(status)) {
      blocks.push({
        part,
        status,
        ...(Array.isArray(r.errors) ? { errorCount: r.errors.length } : {}),
      });
    }
  }
  return blocks;
}

/** 차단 사유를 관리자 메시지 문자열로 요약. */
export function formatValidationBlocks(blocks: ValidationBlock[]): string {
  return blocks
    .map(
      (b) =>
        `${b.part === "cover" ? "표지" : "내지"} ${b.status}` +
        (typeof b.errorCount === "number" ? ` (에러 ${b.errorCount}건)` : ""),
    )
    .join(", ");
}

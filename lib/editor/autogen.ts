import type { LayoutMode } from "@/lib/db/types";
import type { SortMode } from "@/lib/layout/types";

/**
 * 업로드 직후 자동 페이지 생성(P6) 판정 — 화면 배선과 분리한 순수 로직.
 *
 * 흐름: 업로드의 "다음" 링크가 `/editor/[id]?autogen=1` 로 들어오면 내지 목록이 마운트 시
 * 한 번만 기본값으로 생성하고 쿼리를 지운다. 이미 페이지가 있으면 절대 덮어쓰지 않는다.
 */

/** 자동 생성 요청 쿼리 키·값. */
export const AUTOGEN_PARAM = "autogen";
export const AUTOGEN_PARAM_VALUE = "1";

/** 자동 생성 기본값 — 촬영시각 순 · 폴라로이드. */
export const AUTOGEN_DEFAULTS: Readonly<{
  sortMode: SortMode;
  layoutMode: LayoutMode;
}> = { sortMode: "exif", layoutMode: "polaroid" };

/** 내지 목록 진입 경로. `autogen` 이면 자동 생성 요청 쿼리를 붙인다. */
export function editorEntryHref(
  projectId: string,
  options: { autogen?: boolean } = {},
): string {
  const base = `/editor/${projectId}`;
  return options.autogen
    ? `${base}?${AUTOGEN_PARAM}=${AUTOGEN_PARAM_VALUE}`
    : base;
}

/** 서버 searchParams 값에서 자동 생성 요청 여부 — 정확히 "1" 일 때만(배열이면 첫 값). */
export function isAutogenRequested(
  value: string | string[] | undefined,
): boolean {
  const first = Array.isArray(value) ? value[0] : value;
  return first === AUTOGEN_PARAM_VALUE;
}

export interface AutogenInput {
  /** `?autogen=1` 로 들어왔는가. */
  requested: boolean;
  /** 서버가 확인한 현재 내지 수 — 0 일 때만 생성(덮어쓰기 금지). */
  pageCount: number;
  /** 사진이 없으면 서버가 거절하므로 시도하지 않는다. */
  photoCount: number;
  /** 결제 후 편집 잠금. */
  locked: boolean;
}

/** 마운트 시 자동 생성을 실행할지. */
export function shouldAutoGenerate({
  requested,
  pageCount,
  photoCount,
  locked,
}: AutogenInput): boolean {
  return requested && !locked && pageCount === 0 && photoCount > 0;
}

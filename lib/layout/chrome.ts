/**
 * 사이트 공통 크롬(Header·Footer) 노출 판정.
 *
 * 캔버스 편집 화면은 자체 sticky 툴바(top-0)를 가지므로 사이트 헤더(sticky top-0 z-40)가
 * 붙으면 스크롤 시 툴바가 헤더 밑으로 겹치고 캔버스 높이도 줄어든다. 이 화면들에서는
 * Header·Footer 를 렌더하지 않는다. 내지 개요(`/editor/[projectId]`)는 대상이 아니다.
 */
const EDITOR_ONLY_PATTERNS: readonly RegExp[] = [
  // 표지 편집 — /cover/[projectId]
  /^\/cover\/[^/]+$/,
  // 내지 단일 페이지 편집 — /editor/[projectId]/pages/[pageId]
  /^\/editor\/[^/]+\/pages\/[^/]+$/,
];

/** 사이트 Header·Footer 를 숨겨야 하는 에디터 전용 경로인지. pathname 이 없으면 false. */
export function isEditorOnlyPath(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  return EDITOR_ONLY_PATTERNS.some((re) => re.test(pathname));
}

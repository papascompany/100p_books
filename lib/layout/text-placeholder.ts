/**
 * 빈 텍스트 자리의 안내 문구(placeholder) 규약 — 클라이언트·서버(PDF) 공용, fabric 의존 없음.
 *
 * 저장 형식: 비어 있는 텍스트는 `text: ""` + `placeholder: "여기에 글을 입력하세요"` 다.
 * 편집기는 안내 문구를 PLACEHOLDER_TEXT_FILL 로 흐리게 그려 보여 줄 뿐이고, 인쇄(PDF)에는
 * `text` 만 그린다.
 *
 * 2026-11-16 이전 편집기는 저장할 때 화면에 보이던 안내 문구를 실제 텍스트로 직렬화했다
 * (`text: "여기에 글을 입력하세요"`, `fill: rgba(0,0,0,0.35)`, placeholder 필드 없음).
 * 그렇게 저장된 문서가 인쇄물에 안내 문구를 찍지 않도록, 읽는 쪽에서 normalizePlaceholderText 로 고친다.
 */

import type { TextObject } from "./types";

/** 편집기가 안내 문구를 그릴 때 쓰는 색. 색 선택기(hex)로는 나오지 않는 값이다. */
export const PLACEHOLDER_TEXT_FILL = "rgba(0,0,0,0.35)";

/** 안내 문구 상태에서 원래 색을 알 수 없을 때 쓰는 기본 글자색. */
export const DEFAULT_TEXT_FILL = "#2b2b2b";

/**
 * 레이아웃·표지 템플릿이 만드는 고정 안내 문구.
 * 템플릿에 새 placeholder 를 추가하면 여기에도 넣는다(text-placeholder.test.ts 가 누락을 잡는다).
 */
export const KNOWN_PLACEHOLDER_TEXTS: readonly string[] = [
  "여기에 글을 입력하세요",
  "캡션을 입력하세요",
  "표지 제목",
  "큰 제목",
  "subtitle",
  "memo",
  "뒷표지 한 줄",
  "뒷표지 글",
  "뒷표지 캡션",
];

/**
 * 예전 편집기가 안내 문구를 실제 텍스트로 저장한 객체를 바로잡는다.
 *  - 흐린 색(PLACEHOLDER_TEXT_FILL)이 아니면 그대로 둔다.
 *  - 흐린 색 + 텍스트가 안내 문구와 같으면 → 빈 텍스트(인쇄 안 함), 안내 문구는 placeholder 로.
 *  - 흐린 색 + 그 밖의 텍스트(사용자가 입력한 글, 책등 제목 등) → 글은 살리고 기본 글자색으로.
 */
export function normalizePlaceholderText(obj: TextObject): TextObject {
  if (obj.fill !== PLACEHOLDER_TEXT_FILL) return obj;
  const text = obj.text ?? "";
  if (text.length === 0) return { ...obj, fill: DEFAULT_TEXT_FILL };
  const isPlaceholder =
    text === obj.placeholder || KNOWN_PLACEHOLDER_TEXTS.includes(text);
  if (isPlaceholder) {
    return {
      ...obj,
      text: "",
      placeholder: obj.placeholder ?? text,
      fill: DEFAULT_TEXT_FILL,
    };
  }
  return { ...obj, fill: DEFAULT_TEXT_FILL };
}

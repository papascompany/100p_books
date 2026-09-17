import "server-only";

import { createHash } from "node:crypto";

/**
 * 편집 문서(pages.fabric_json · projects.cover_json) 내용 버전.
 *
 * 왜 updated_at 이 아니라 내용 해시인가:
 *   - 표지는 projects.cover_json 에 저장된다. projects.updated_at 은 제목 변경·레이아웃 재생성·
 *     주문 상태 등 표지와 무관한 갱신에도 바뀐다 → updated_at 으로 비교하면 거짓 충돌이 난다.
 *   - 내용 해시는 "에디터가 기준으로 삼은 문서와 서버 문서가 같은가" 를 그대로 표현한다.
 *
 * 해시는 항상 **DB 에서 읽은 값**으로 계산한다(페이지 렌더·GET·PATCH 응답의 returning).
 * jsonb 는 키 순서를 보존하지 않으므로 키를 정렬한 canonical JSON 을 해시한다.
 */

const VERSION_PREFIX = "v1-";
/** baseVersion 입력 최대 길이 (prefix + 해시 32자 여유). */
const MAX_BASE_VERSION_LENGTH = 128;

/** 키 정렬 JSON — undefined 속성은 JSON.stringify 와 동일하게 제외한다. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    const s = JSON.stringify(value);
    return s === undefined ? "null" : s;
  }
  if (Array.isArray(value)) {
    return `[${value
      .map((v) => (v === undefined ? "null" : canonicalJson(v)))
      .join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record)
    .filter((k) => record[k] !== undefined)
    .sort();
  return `{${keys
    .map((k) => `${JSON.stringify(k)}:${canonicalJson(record[k])}`)
    .join(",")}}`;
}

/** 문서 내용 버전 토큰. null(미저장 표지 등)도 고정 토큰을 갖는다. */
export function computeDocVersion(doc: unknown): string {
  const digest = createHash("sha256")
    .update(canonicalJson(doc ?? null))
    .digest("hex");
  return `${VERSION_PREFIX}${digest.slice(0, 32)}`;
}

export type ParsedBaseVersion =
  | { ok: true; value: string | null }
  | { ok: false };

/**
 * PATCH body 의 baseVersion 검증.
 *  - 없음/null → 구 클라이언트(기준 없음, 기존 동작).
 *  - 비어있지 않은 문자열(≤128자) → 기준 버전.
 *  - 그 외 → 잘못된 요청.
 */
export function parseBaseVersion(raw: unknown): ParsedBaseVersion {
  if (raw === undefined || raw === null) return { ok: true, value: null };
  if (
    typeof raw === "string" &&
    raw.length > 0 &&
    raw.length <= MAX_BASE_VERSION_LENGTH
  ) {
    return { ok: true, value: raw };
  }
  return { ok: false };
}

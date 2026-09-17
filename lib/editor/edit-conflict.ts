/**
 * 편집 저장 충돌(stale-write) 계약 — 서버 라우트와 에디터 클라이언트가 공유한다.
 *
 * 흐름:
 *   1. 서버가 문서 내용 해시(`version`)를 에디터에 내려준다(페이지 렌더·GET·PATCH 응답).
 *   2. 에디터는 PATCH 시 마지막으로 알고 있는 version 을 `baseVersion` 으로 보낸다.
 *   3. 서버의 현재 문서 해시가 baseVersion 과 다르면 409 EDIT_CONFLICT —
 *      저장 이전 화면(라우터 캐시 재생·다른 탭)이 최신 저장본을 덮어쓰지 못하게 한다.
 *   4. baseVersion 을 보내지 않는 구 클라이언트는 기존처럼 무조건 저장된다.
 *
 * 클라이언트에서도 import 하므로 server-only 가 아니다(서버 전용 해시는 doc-version.ts).
 */

export const EDIT_CONFLICT_CODE = "EDIT_CONFLICT";

export const EDIT_CONFLICT_MESSAGE =
  "다른 곳에서 먼저 저장된 내용이 있어요. 최신 내용을 불러온 뒤 다시 편집해주세요.";

/** 에디터 save() 결과. */
export type SaveOutcome =
  /** 서버 저장 완료. */
  | "saved"
  /** 409 — 최신본을 다시 불러왔다(로컬 변경은 버려짐). */
  | "conflict"
  /** 저장 불변식 위반 — 서버 호출 없이 중단(덮어쓰기 방지). */
  | "blocked"
  /** 네트워크·서버 오류. */
  | "failed"
  /** 캔버스 미준비 등으로 시도하지 않음. */
  | "skipped";

export type SaveResponse =
  | { kind: "saved"; version: string | null }
  | { kind: "conflict"; currentVersion: string | null }
  | { kind: "failed"; message: string | null };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * PATCH /api/pages/[id] · PATCH /api/cover 응답 해석.
 * 표준 응답 포맷 `{ ok, data?, error? }` (app/api/_lib/response.ts) 기준.
 */
export function interpretSaveResponse(
  status: number,
  body: unknown,
): SaveResponse {
  const json = isRecord(body) ? body : null;
  const error = json && isRecord(json.error) ? json.error : null;

  if (status === 409 && error?.code === EDIT_CONFLICT_CODE) {
    const details = isRecord(error.details) ? error.details : null;
    const currentVersion =
      details && typeof details.currentVersion === "string"
        ? details.currentVersion
        : null;
    return { kind: "conflict", currentVersion };
  }

  if (status >= 200 && status < 300 && json?.ok === true) {
    const data = isRecord(json.data) ? json.data : null;
    const version =
      data && typeof data.version === "string" ? data.version : null;
    return { kind: "saved", version };
  }

  const message =
    error && typeof error.message === "string" ? error.message : null;
  return { kind: "failed", message };
}

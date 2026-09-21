/**
 * 편집 저장 충돌(stale-write) 계약 — 서버 라우트와 에디터 클라이언트가 공유한다.
 *
 * 흐름:
 *   1. 서버가 문서 내용 해시(`version`)를 에디터에 내려준다(페이지 렌더·GET·PATCH 응답).
 *   2. 에디터는 PATCH 시 마지막으로 알고 있는 version 을 `baseVersion` 으로 보낸다.
 *   3. 서버의 현재 문서 해시가 baseVersion 과 다르면 409 EDIT_CONFLICT —
 *      저장 이전 화면(라우터 캐시 재생·다른 탭)이 최신 저장본을 덮어쓰지 못하게 한다.
 *   4. baseVersion 을 보내지 않는 구 클라이언트는 기존처럼 무조건 저장된다.
 *   5. 결제 이후 주문이 있는 포토북은 409 PROJECT_LOCKED(버전 판정보다 먼저) — 에디터는 서버 message 를
 *      한 번 보여주고 읽기 전용으로 전환한다(자동저장 중단·이탈 경고 해제).
 *
 * 클라이언트에서도 import 하므로 server-only 가 아니다(서버 전용 해시는 doc-version.ts).
 */

export const EDIT_CONFLICT_CODE = "EDIT_CONFLICT";

export const EDIT_CONFLICT_MESSAGE =
  "다른 곳에서 먼저 저장된 내용이 있어요. 최신 내용을 불러온 뒤 다시 편집해주세요.";

/**
 * 결제 후 편집 잠금(DEBT-2) 응답 코드 — 서버 lib/orders/edit-lock.ts ProjectLockedError.code 와 같다
 * (edit-conflict.test.ts 가 일치를 고정한다. 그 모듈은 server-only 라 여기서 import 하지 않는다).
 */
export const PROJECT_LOCKED_CODE = "PROJECT_LOCKED";

/** 서버 message 가 비어 있을 때 쓰는 안내 — 서버 PROJECT_LOCKED_MESSAGE 와 같은 문구. */
export const PROJECT_LOCKED_FALLBACK_MESSAGE =
  "결제가 완료된 포토북은 수정할 수 없어요. 수정이 필요하면 고객센터로 문의해 주세요.";

/** 에디터 save() 결과. */
export type SaveOutcome =
  /** 서버 저장 완료. */
  | "saved"
  /** 409 — 최신본을 다시 불러왔다(로컬 변경은 버려짐). */
  | "conflict"
  /** 409 PROJECT_LOCKED — 결제 후 편집 잠금. 읽기 전용으로 전환됐다(안내는 1회). */
  | "locked"
  /** 저장 불변식 위반 — 서버 호출 없이 중단(덮어쓰기 방지). */
  | "blocked"
  /** 네트워크·서버 오류. */
  | "failed"
  /** 캔버스 미준비 등으로 시도하지 않음. */
  | "skipped";

export type SaveResponse =
  | { kind: "saved"; version: string | null }
  | { kind: "conflict"; currentVersion: string | null }
  | { kind: "locked"; message: string }
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

  if (status === 409 && error?.code === PROJECT_LOCKED_CODE) {
    const message =
      typeof error.message === "string" && error.message.trim().length > 0
        ? error.message
        : PROJECT_LOCKED_FALLBACK_MESSAGE;
    return { kind: "locked", message };
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

/**
 * 저장을 시도한 뒤 화면 이동을 어떻게 할지 (표지·내지 에디터 공용).
 *  - proceed: 저장됨 → 이동.
 *  - stay: 방금 화면이 바뀌었다(최신본 재로드·읽기 전용 전환) — 사용자가 안내를 확인한 뒤 다시 누른다.
 *    둘 다 dirty 가 내려가므로 다음 클릭은 저장 없이 이동한다(화면에 가두지 않는다).
 *  - confirm_discard: 저장하지 못했다(차단·실패·미준비). "저장하지 않고 이동" 확인을 받는다.
 *    blocked 는 새로고침 전까지 풀리지 않으므로, 확인 없이 멈추면 사용자가 화면에 갇힌다.
 */
export type NavigationDecision = "proceed" | "stay" | "confirm_discard";

export function decideNavigationAfterSave(
  outcome: SaveOutcome,
): NavigationDecision {
  switch (outcome) {
    case "saved":
      return "proceed";
    case "conflict":
    case "locked":
      return "stay";
    case "blocked":
    case "failed":
    case "skipped":
      return "confirm_discard";
  }
}

/** "저장하지 않고 이동" 확인 문구. */
export const LEAVE_WITHOUT_SAVING_CONFIRM =
  "변경 사항을 저장하지 못했어요. 저장하지 않고 이동하면 최근 변경 사항이 사라져요. 그래도 이동할까요?";

/**
 * 결제 후 편집 잠금 상태 — 한 번 잠기면 풀리지 않는다(새로고침으로만 재판정).
 *
 * lock() 은 **처음 잠길 때만 true** — 호출자는 true 일 때만 안내(토스트)를 띄운다.
 * 서버 페이지가 진입 시 잠금을 알려준 경우(initialMessage)는 이미 배너로 안내했으므로
 * 이후 저장 409 에서도 다시 안내하지 않는다.
 */
export interface EditLockGate {
  readonly locked: boolean;
  readonly message: string | null;
  lock(message: string | null): boolean;
}

export function createEditLockGate(initialMessage: string | null): EditLockGate {
  let message: string | null = initialMessage;
  return {
    get locked() {
      return message !== null;
    },
    get message() {
      return message;
    },
    lock(next: string | null): boolean {
      if (message !== null) return false;
      message =
        next !== null && next.trim().length > 0
          ? next
          : PROJECT_LOCKED_FALLBACK_MESSAGE;
      return true;
    },
  };
}

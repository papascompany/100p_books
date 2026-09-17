/**
 * 에디터 최신본 동기화 순서 규약 (표지·내지 공용, 의존성 없음).
 *
 * 저장·최신본 확인은 같은 직렬 큐에서 돈다(async-gates.createSerialQueue).
 * 최신본 재로드가 끝나면 큐에서 기다리던 저장이 **곧바로** 실행되므로, 저장이 읽는 값
 * (문서 메타 ref · 기준 버전)은 재로드 작업 안에서 이미 새 값이어야 한다.
 *
 * 과거 결함(CoverEditor): 메타 ref 를 렌더에서만 갱신해(`ref.current = state`) 재로드 직후
 * 렌더 전에 실행된 저장이 **옛 크기·배경 메타 + 새 기준 버전**으로 서버 최신 표지를 덮었다.
 * → 메타는 캔버스 로드를 기다리기 전에 동기로 커밋하고, 기준 버전은 로드 성공 뒤에 커밋한다.
 */

/**
 * 저장을 서버 호출 없이 멈추는 사유 (save() → "blocked").
 *  - load_failed: 캔버스가 문서를 반영하지 못했다(loadDoc 실패). 이 상태로 저장하면 화면과 다른
 *    내용·빈 문서가 서버를 덮는다. 이후 문서 로드가 성공하면 해제된다.
 *  - server_doc_unreadable: 서버 문서를 해석할 수 없다(decideLatestDoc "unreadable").
 *    새로고침 전까지 유지한다 — 저장해도 409 만 반복된다.
 */
export type SaveBlockReason = "load_failed" | "server_doc_unreadable";

export interface LatestDocPayload {
  version: unknown;
  doc: unknown;
}

export type LatestDocDecision<TDoc> =
  /** 조회 실패 — 기준을 바꾸지 않는다(저장 시 서버가 409 로 다시 막는다). */
  | { kind: "unavailable" }
  /** 기준 버전과 같다 — 할 일 없음. */
  | { kind: "up_to_date" }
  /**
   * 서버 문서를 이 클라이언트가 해석할 수 없다(더 새 포맷·손상).
   * 기준을 바꾸지 않으면 저장마다 409 가 반복되고, 빈 문서로 간주해 덮으면 모르는 내용을 지운다.
   * → 저장을 멈추고 새로고침을 안내한다.
   */
  | { kind: "unreadable"; version: string }
  | { kind: "reload"; doc: TDoc; version: string };

export function decideLatestDoc<TDoc>(
  latest: LatestDocPayload | undefined,
  baseVersion: string,
  isDoc: (value: unknown) => value is TDoc,
): LatestDocDecision<TDoc> {
  if (!latest || typeof latest.version !== "string") {
    return { kind: "unavailable" };
  }
  if (latest.version === baseVersion) return { kind: "up_to_date" };
  if (!isDoc(latest.doc)) {
    return { kind: "unreadable", version: latest.version };
  }
  return { kind: "reload", doc: latest.doc, version: latest.version };
}

export interface ReloadEditorDocSteps<TDoc> {
  doc: TDoc;
  version: string;
  /** 저장이 읽는 문서 메타(ref) 갱신 — **동기**. 렌더를 기다리지 않는다. */
  commitMeta: (doc: TDoc) => void;
  /** 캔버스 교체. 실패하면 false(예외를 던지지 않는다). */
  loadCanvas: (doc: TDoc) => Promise<boolean>;
  /** 기준 버전 갱신 — 캔버스가 이 문서를 반영한 뒤에만. */
  commitVersion: (version: string) => void;
  /** 사용자 편집 순번 읽기 — 로드 중 편집 판정용. */
  readEditSeq: () => number;
}

export type ReloadEditorDocResult =
  | { loaded: false }
  | {
      loaded: true;
      /** 캔버스 로드를 기다리는 동안 사용자 편집이 있었다 — dirty 를 유지해야 한다. */
      editedDuringLoad: boolean;
    };

/**
 * 최신본 재로드: 메타 커밋(동기) → 캔버스 로드 → 기준 버전 커밋.
 *
 *  - 로드 실패 시 기준 버전을 바꾸지 않는다. 캔버스는 옛 객체 그대로라 새 기준으로 저장하면
 *    서버 최신본을 옛 내용으로 덮는다(옛 기준이면 서버가 409 로 막는다).
 *  - 로드 중 편집(추가한 객체는 FabricStage 가 보존한다)이 있었으면 알려, 호출자가 dirty 를
 *    내리지 않게 한다.
 */
export async function reloadEditorDoc<TDoc>(
  steps: ReloadEditorDocSteps<TDoc>,
): Promise<ReloadEditorDocResult> {
  steps.commitMeta(steps.doc);
  const seqBefore = steps.readEditSeq();
  const loaded = await steps.loadCanvas(steps.doc);
  if (!loaded) return { loaded: false };
  steps.commitVersion(steps.version);
  return { loaded: true, editedDuringLoad: steps.readEditSeq() !== seqBefore };
}

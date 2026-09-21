import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * 에디터 저장 무결성 소스 가드 — 런타임 테스트로 잡기 어려운 "배선 순서" 를 소스 수준에서 고정한다.
 *
 * FabricStage 는 React + 실제 캔버스라 jsdom 단위 테스트로 마운트하지 않는다. 대신 lib 쪽 규약
 * (history-wiring.test.ts · load-guards.test.ts · doc-sync.test.ts)이 가정하는 배선이 컴포넌트에서
 * 깨지지 않았는지 확인한다. 실패하면 해당 규약 테스트의 머리 주석을 먼저 읽을 것.
 *
 *  - QA-1: 스냅샷을 canvas.toJSON(props) 로 만들면 fabric 6.9.1 이 인자를 무시해 태그가 빠진다.
 *  - QA-4: 히스토리 연결은 chrome 을 그린 뒤, 기준점 → 필터 연결 순서여야 한다.
 *          loadDoc·복원은 await **전에** recorder 를 멈춰야 한다.
 *  - 대기 중 추가 객체 유실: 교체 대상은 await 전에 캡처해야 한다.
 *  - CoverEditor 옛 메타 덮어쓰기: 저장이 읽는 ref 를 렌더에서 미러링하면 안 된다.
 */

function read(relativeToThisFile: string): string {
  return readFileSync(
    fileURLToPath(new URL(relativeToThisFile, import.meta.url)),
    "utf8",
  );
}

/** 주석에 식별자를 언급한 설명까지 위반으로 잡지 않도록 제거한다. */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|\s)\/\/[^\n]*/g, "$1");
}

/** start 표식부터 end 표식 직전까지. 표식이 없으면 실패시킨다(리팩터링 시 가드 갱신 유도). */
function section(src: string, start: string, end: string): string {
  const from = src.indexOf(start);
  expect(from, `표식을 찾지 못함: ${start}`).toBeGreaterThanOrEqual(0);
  const to = src.indexOf(end, from + start.length);
  expect(to, `표식을 찾지 못함: ${end}`).toBeGreaterThan(from);
  return src.slice(from, to);
}

function indexOrFail(src: string, needle: string): number {
  const i = src.indexOf(needle);
  expect(i, `찾지 못함: ${needle}`).toBeGreaterThanOrEqual(0);
  return i;
}

function count(src: string, needle: string): number {
  return src.split(needle).length - 1;
}

function firstAwait(body: string): number {
  const m = /\bawait\s/.exec(body);
  expect(m, "await 가 없음").not.toBeNull();
  return m ? m.index : -1;
}

const STAGE = stripComments(read("./FabricStage.tsx"));
const COVER = stripComments(
  read("../../app/(user)/cover/[projectId]/CoverEditor.tsx"),
);
const PAGE = stripComments(
  read("../../app/(user)/editor/[projectId]/pages/[pageId]/PageEditor.tsx"),
);

describe("FabricStage 소스 가드 — 히스토리 스냅샷·연결 순서", () => {
  it("toJSON / loadFromJSON 을 쓰지 않는다 (QA-1: fabric 6.9.1 toJSON 은 props 인자를 무시)", () => {
    expect(STAGE).not.toMatch(/\.toJSON\s*\(/);
    expect(STAGE).not.toMatch(/\bloadFromJSON\s*\(/);
  });

  it("히스토리 스냅샷은 createSnapshot(canvas) 로만 찍는다", () => {
    expect(STAGE).toContain("takeSnapshot: () => createSnapshot(canvas)");
  });

  it("객체 이벤트를 히스토리에 직접 연결하지 않는다 — connectCanvasHistory(chrome 필터) 경유", () => {
    expect(STAGE).not.toMatch(
      /\.on\(\s*["'`]object:(added|removed|modified)["'`]/,
    );
    expect(count(STAGE, "connectCanvasHistory(")).toBe(1);
    expect(count(STAGE, "drawSafeLineOverlay(canvas")).toBe(1);
  });

  it("캔버스 초기화: chrome 그리기 → recorder 생성 → 기준점 → 히스토리 연결 순서 (QA-4)", () => {
    const init = section(
      STAGE,
      "const canvas = new fabric.Canvas(",
      "return () => {",
    );
    const chrome = indexOrFail(init, "drawSafeLineOverlay(canvas");
    const recorder = indexOrFail(init, "new HistoryRecorder(");
    const baseline = indexOrFail(init, "recorder.ensureBaseline()");
    const connect = indexOrFail(init, "connectCanvasHistory(");
    expect(chrome).toBeLessThan(recorder);
    expect(recorder).toBeLessThan(baseline);
    expect(baseline).toBeLessThan(connect);
  });

  it("loadDoc: recorder 정지·교체 대상 캡처·배경 등록은 첫 await 전에 동기로 한다", () => {
    const body = section(
      STAGE,
      "const loadDoc = useCallback(",
      "loadDocRef.current = loadDoc;",
    );
    const awaitAt = firstAwait(body);
    expect(indexOrFail(body, "suspendActiveRecorder();")).toBeLessThan(awaitAt);
    expect(
      indexOrFail(body, "captureUserObjects(initialCanvas.getObjects())"),
    ).toBeLessThan(awaitAt);
    expect(indexOrFail(body, "bgGateRef.current.claim(")).toBeLessThan(awaitAt);
    // 교체는 캡처한 객체만 — "chrome 아닌 객체 전부 제거" 로 되돌아가지 않게.
    expect(body).toContain("replaceUserObjects(canvas, previous, objs)");
  });

  it("undo/redo 복원: recorder 정지·교체 대상 캡처는 첫 await 전, 교체는 캡처한 객체만", () => {
    const body = section(
      STAGE,
      "const restoreSnapshot = useCallback(",
      "const undo = useCallback(",
    );
    const awaitAt = firstAwait(body);
    expect(indexOrFail(body, "recorder.suspend();")).toBeLessThan(awaitAt);
    expect(
      indexOrFail(body, "captureUserObjects(canvas.getObjects())"),
    ).toBeLessThan(awaitAt);
    expect(body).toContain("replaceUserObjects(canvas, previous, objs)");
  });

  it("어디서도 chrome 아닌 객체를 통째로 지우지 않는다(대기 중 추가 객체 유실 경로)", () => {
    expect(STAGE).not.toMatch(
      /\.remove\(\s*\.\.\.canvas\s*\.getObjects\(\)\s*\.filter/,
    );
  });

  it("비동기 배경 이미지 적용은 배경 등록(claim) 을 확인한다", () => {
    const setBackground = section(
      STAGE,
      "const setBackground = useCallback(",
      "const restoreSnapshot = useCallback(",
    );
    expect(setBackground).toContain('claim.isCurrent("image")');
  });
});

describe("에디터 소스 가드 — 저장이 읽는 문서 메타·캔버스 로드 경로", () => {
  it("CoverEditor: 메타·사진 URL ref 는 커밋 함수에서만 갱신한다(렌더 미러링 금지)", () => {
    expect(count(COVER, "currentDocRef.current =")).toBe(1);
    expect(count(COVER, "setCurrentDocState(")).toBe(1);
    expect(count(COVER, "photoUrlsRef.current =")).toBe(1);
    expect(count(COVER, "setPhotoUrlsState(")).toBe(1);
    const commit = section(
      COVER,
      "const commitCurrentDoc = useCallback(",
      "const photoUrlsRef",
    );
    expect(commit).toContain("currentDocRef.current = next;");
  });

  it("최신본 재로드는 reloadEditorDoc(메타 동기 커밋 → 로드 → 기준 버전) 순서를 쓴다", () => {
    for (const src of [COVER, PAGE]) {
      const sync = section(
        src,
        "const syncWithServer = useCallback(",
        "const save = useCallback(",
      );
      expect(sync).toContain("reloadEditorDoc(");
      expect(sync).not.toMatch(/baseVersionRef\.current = data\./);
    }
  });

  it("캔버스 로드는 실패 처리 래퍼(loadIntoStage) 한 곳에서만 부른다", () => {
    for (const src of [COVER, PAGE]) {
      expect(count(src, ".loadDoc(")).toBe(1);
      const wrapper = section(
        src,
        "const loadIntoStage = useCallback(",
        "const syncWithServer = useCallback(",
      );
      expect(wrapper).toContain("handle.loadDoc(");
    }
  });
});

describe("로드 실패 저장 차단 — 대기 중 저장보다 먼저 선다 (A 리뷰 should_fix)", () => {
  it("FabricStage.loadDoc: 실패 래치는 catch 에서, 로드 종료 알림(finally)보다 앞에 건다", () => {
    const body = section(
      STAGE,
      "const loadDoc = useCallback(",
      "loadDocRef.current = loadDoc;",
    );
    const catchAt = indexOrFail(body, "} catch (err) {");
    const latchAt = indexOrFail(body, "loadFailureRef.current.markFailed(");
    const finallyAt = indexOrFail(body, "} finally {");
    expect(catchAt).toBeLessThan(latchAt);
    expect(latchAt).toBeLessThan(finallyAt);
    // 최신 로드일 때만 — 밀린 옛 로드의 실패가 새 로드 결과를 덮지 않게.
    expect(body).toContain("markFailed(seq === loadSeqRef.current)");
  });

  it("FabricStage.loadDoc: 밀린 로드는 해제하지 않는다 — markApplied 는 교체(replaceUserObjects) 뒤에만", () => {
    const body = section(
      STAGE,
      "const loadDoc = useCallback(",
      "loadDocRef.current = loadDoc;",
    );
    expect(count(body, "markApplied()")).toBe(1);
    expect(indexOrFail(body, 'return "superseded"')).toBeLessThan(
      indexOrFail(body, "markApplied()"),
    );
    expect(indexOrFail(body, "replaceUserObjects(canvas, previous, objs)")).toBeLessThan(
      indexOrFail(body, "markApplied()"),
    );
  });

  it("FabricStage.serializeForSave 가 래치를 본다 → load_failed", () => {
    const body = section(
      STAGE,
      "const serializeForSave = useCallback(",
      "[serialize],",
    );
    expect(body).toContain("loadFailureRef.current.failed");
    expect(body).toContain('reason: "load_failed"');
  });

  it("캔버스 재생성 후 재로드의 reject 를 삼키지 않고 처리한다(래치가 저장을 막는다)", () => {
    expect(STAGE).not.toMatch(/void loadDocRef\.current\?\.\([^)]*\);/);
  });

  it("에디터: 차단 해제는 applied 일 때만, load_failed 직렬화 결과는 blocked", () => {
    for (const src of [COVER, PAGE]) {
      const wrapper = section(
        src,
        "const loadIntoStage = useCallback(",
        "const syncWithServer = useCallback(",
      );
      expect(wrapper).toContain('result === "applied" && saveBlockRef.current === "load_failed"');
      const save = section(src, "const save = useCallback(", "const res = await fetch(");
      expect(save).toContain('result.reason === "load_failed"');
    }
  });
});

describe("결제 후 편집 잠금 — 에디터 읽기 전용 전환 (DEBT-2 클라이언트)", () => {
  it("저장은 잠금이면 서버 호출·idle 대기 없이 locked, 409 PROJECT_LOCKED 는 enterReadOnly", () => {
    for (const src of [COVER, PAGE]) {
      const save = section(src, "const save = useCallback(", "} finally {");
      expect(indexOrFail(save, "lockGateRef.current.locked) return \"locked\"")).toBeLessThan(
        indexOrFail(save, "handle.whenIdle("),
      );
      expect(save).toMatch(/outcome\.kind === "locked"\) \{\s*[^}]*enterReadOnly\(outcome\.message\);\s*return "locked";/);
    }
  });

  it("잠금이면 편집이 dirty 를 만들지 않고 자동저장이 돌지 않는다", () => {
    for (const src of [COVER, PAGE]) {
      const mark = section(src, "const markDirty = useCallback(", "}, []);");
      expect(mark).toContain("if (lockGateRef.current.locked) return;");
      expect(src).toContain("if (!dirty || !autosave || readOnly) return;");
    }
  });

  it("읽기 전용 전환은 dirty 를 내리고(이탈 경고 해제) 안내 토스트는 처음 잠길 때만", () => {
    for (const src of [COVER, PAGE]) {
      const enter = section(src, "const enterReadOnly = useCallback(", "}, []);");
      expect(enter).toContain("lockGateRef.current.lock(message)");
      expect(enter).toContain("setDirty(false);");
      expect(enter).toMatch(/if \(firstLock && shown\) \{\s*toast\(/);
    }
  });

  it("FabricStage 에 readOnly 를 넘긴다", () => {
    for (const src of [COVER, PAGE]) {
      expect(src).toContain("readOnly={readOnly}");
    }
  });

  it("FabricStage: 문서를 바꾸는 명령은 읽기 전용이면 무시한다(loadDoc 은 예외)", () => {
    for (const name of [
      "addPhoto",
      "addClipart",
      "pasteLayoutObject",
      "replacePhoto",
      "duplicateSelected",
      "setBackground",
      "remove",
      "bringForward",
      "sendBackward",
    ]) {
      const start = STAGE.indexOf(`const ${name} = useCallback(`);
      expect(start, name).toBeGreaterThanOrEqual(0);
      const head = STAGE.slice(start, start + 160);
      expect(head, name).toContain("if (readOnlyRef.current) return;");
    }
    const loadDoc = section(STAGE, "const loadDoc = useCallback(", "loadDocRef.current = loadDoc;");
    expect(loadDoc).not.toContain("readOnlyRef");
  });
});

describe("저장 막힘·실패 시 이동 — 화면에 가두지 않는다 (A 리뷰 should_fix)", () => {
  it("표지·내지 이동은 decideNavigationAfterSave + '저장하지 않고 이동' 확인을 쓴다", () => {
    const cover = section(COVER, "const flushAndNavigate = useCallback(", "router.push(href);");
    const page = section(PAGE, "const navigateTo = useCallback(", "router.push(href);");
    for (const nav of [cover, page]) {
      expect(nav).toContain("decideNavigationAfterSave(outcome)");
      expect(nav).toContain("window.confirm(LEAVE_WITHOUT_SAVING_CONFIRM)");
      // 예전 CoverEditor: blocked 면 이동 없이 return → 새로고침 전까지 갇혔다.
      expect(nav).not.toMatch(/outcome === "blocked"\) return/);
    }
  });
});

describe("CoverEditor 진입 로드 — 첫 렌더 props 고정 금지 (A 리뷰 should_fix)", () => {
  it("handleStageReady 는 같은 props 에서 문서·기준 버전·메타를 맞추고 props 를 의존한다", () => {
    const ready = section(COVER, "const handleStageReady = useCallback(", "const autosaveTimerRef");
    expect(ready).toContain("baseVersionRef.current = initialVersion;");
    expect(ready).toContain("commitCurrentDoc(initialDoc);");
    expect(indexOrFail(ready, "baseVersionRef.current = initialVersion;")).toBeLessThan(
      indexOrFail(ready, "await loadIntoStage("),
    );
    expect(ready).not.toMatch(/\}, \[\]\);/);
    expect(ready).toMatch(/initialVersion,\s*loadIntoStage,/);
  });
});

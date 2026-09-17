import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  connectCanvasHistory,
  HISTORY_MAX,
  HistoryRecorder,
  HistoryStack,
  isChromeHistoryEvent,
  makeHistoryDebouncer,
  type HistoryCanvasEvent,
  type HistoryCanvasEventPayload,
  type HistoryEventSource,
} from "./history";

describe("HistoryStack", () => {
  it("초기 상태는 undo/redo 모두 불가", () => {
    const h = new HistoryStack();
    expect(h.canUndo).toBe(false);
    expect(h.canRedo).toBe(false);
    expect(h.currentSnapshot).toBeNull();
  });

  it("reset 으로 초기 스냅샷 설정", () => {
    const h = new HistoryStack();
    h.reset("a");
    expect(h.currentSnapshot).toBe("a");
    expect(h.canUndo).toBe(false);
    expect(h.canRedo).toBe(false);
  });

  it("push → undo → redo", () => {
    const h = new HistoryStack();
    h.reset("a");
    h.push("b");
    h.push("c");
    expect(h.currentSnapshot).toBe("c");
    expect(h.canUndo).toBe(true);
    expect(h.canRedo).toBe(false);

    expect(h.undo()).toBe("b");
    expect(h.currentSnapshot).toBe("b");
    expect(h.canRedo).toBe(true);

    expect(h.undo()).toBe("a");
    expect(h.currentSnapshot).toBe("a");
    expect(h.canUndo).toBe(false);

    expect(h.redo()).toBe("b");
    expect(h.redo()).toBe("c");
    expect(h.canRedo).toBe(false);
  });

  it("동일 스냅샷 연속 push 는 무시", () => {
    const h = new HistoryStack();
    h.reset("a");
    h.push("a");
    h.push("a");
    expect(h.size().past).toBe(0);
    expect(h.canUndo).toBe(false);
  });

  it("새 push 시 future 폐기", () => {
    const h = new HistoryStack();
    h.reset("a");
    h.push("b");
    h.push("c");
    h.undo(); // c → b, future=[c]
    h.push("d"); // future 폐기
    expect(h.canRedo).toBe(false);
    expect(h.currentSnapshot).toBe("d");
  });

  it(`최대 ${HISTORY_MAX} 스텝 보존 (FIFO drop)`, () => {
    const h = new HistoryStack();
    h.reset("0");
    for (let i = 1; i <= HISTORY_MAX + 10; i++) {
      h.push(`s${i}`);
    }
    // past 는 HISTORY_MAX 이하로 유지
    expect(h.size().past).toBeLessThanOrEqual(HISTORY_MAX);
  });

  it("undo 가 더 이상 없으면 null 반환", () => {
    const h = new HistoryStack();
    expect(h.undo()).toBeNull();
    h.reset("a");
    expect(h.undo()).toBeNull();
  });

  it("push 는 실제로 바뀌었을 때만 true — no-op 은 false", () => {
    const h = new HistoryStack();
    h.reset("a");
    expect(h.push("a")).toBe(false);
    expect(h.push("b")).toBe(true);
    expect(h.push("b")).toBe(false);
  });
});

describe("makeHistoryDebouncer", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("cancel 은 대기 호출을 버리고, flush 는 즉시 실행한다", () => {
    const fn = vi.fn();
    const d = makeHistoryDebouncer(fn, 200);
    d();
    expect(d.pending).toBe(true);
    d.cancel();
    expect(d.pending).toBe(false);
    vi.advanceTimersByTime(500);
    expect(fn).not.toHaveBeenCalled();

    d();
    d.flush();
    expect(fn).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(500);
    expect(fn).toHaveBeenCalledTimes(1);
    d.flush(); // 대기 없음 → no-op
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

/**
 * HistoryRecorder — "로드·복원·내용이 같은 push 는 dirty 를 만들지 않는다" (QA-4, QA-2 원인 b).
 * 캔버스 대신 문자열 상태를 스냅샷으로 쓰는 가짜 캔버스로 검증한다.
 */
describe("HistoryRecorder", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function setup(initial = "doc-v1") {
    let state = initial;
    const stack = new HistoryStack();
    const onModified = vi.fn();
    const onHistoryChange = vi.fn();
    const recorder = new HistoryRecorder({
      stack,
      takeSnapshot: () => state,
      debounceMs: 200,
      onModified,
      onHistoryChange,
    });
    return {
      stack,
      recorder,
      onModified,
      onHistoryChange,
      setState: (s: string) => {
        state = s;
      },
    };
  }

  it("로드 흐름: suspend 중 이벤트는 예약조차 안 되고, 로드 후 no-op push 는 modified 없음", () => {
    const { recorder, stack, onModified, setState } = setup("empty");

    // loadDoc: suspend → 객체 add 이벤트 → 기준 스냅샷 → resume
    recorder.suspend();
    setState("doc-v1");
    recorder.notifyChange();
    recorder.notifyChange();
    recorder.resetToCurrent();
    recorder.resume();
    expect(recorder.hasPendingPush).toBe(false);

    // 예전 버그: 200ms 뒤 가드가 풀린 상태로 push → onModified → dirty → 자동저장.
    vi.advanceTimersByTime(1000);
    expect(onModified).not.toHaveBeenCalled();

    // 늦게 도착한 이벤트(내용 변화 없음)도 dirty 를 만들지 않는다.
    recorder.notifyChange();
    vi.advanceTimersByTime(200);
    expect(onModified).not.toHaveBeenCalled();
    expect(stack.canUndo).toBe(false);
  });

  it("실제 편집은 debounce 후 한 번만 modified", () => {
    const { recorder, stack, onModified, setState } = setup();
    recorder.resetToCurrent();

    setState("doc-v2");
    recorder.notifyChange();
    recorder.notifyChange();
    vi.advanceTimersByTime(199);
    expect(onModified).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onModified).toHaveBeenCalledTimes(1);
    expect(stack.canUndo).toBe(true);
  });

  it("suspend 진입 시 대기 중인 push 를 취소한다 — 복원 결과가 새 항목으로 쌓이지 않게", () => {
    const { recorder, stack, onModified, setState } = setup();
    recorder.resetToCurrent();
    setState("doc-v2");
    recorder.notifyChange();
    recorder.suspend();
    vi.advanceTimersByTime(1000);
    expect(onModified).not.toHaveBeenCalled();
    expect(recorder.commit()).toBe(false); // suspend 중 commit 도 무시
    recorder.resume();
    expect(stack.canUndo).toBe(false);
  });

  it("undo 는 대기 중 편집을 먼저 반영하고, 복원 중 이벤트로 redo 스택이 날아가지 않는다", () => {
    const { recorder, stack, onModified, setState } = setup();
    recorder.resetToCurrent();

    // 텍스트 추가 직후(200ms 전) 되돌리기
    setState("doc-v1+text");
    recorder.notifyChange();
    const snap = recorder.undo();
    expect(onModified).toHaveBeenCalledTimes(1); // flush 된 편집
    expect(snap).toBe("doc-v1");
    expect(stack.canRedo).toBe(true);

    // 복원: suspend 중 remove/add 이벤트 → 무시
    recorder.suspend();
    setState("doc-v1");
    recorder.notifyChange();
    recorder.notifyChange();
    recorder.resume();
    vi.advanceTimersByTime(1000);

    expect(stack.canRedo).toBe(true);
    expect(recorder.redo()).toBe("doc-v1+text");
    expect(onModified).toHaveBeenCalledTimes(1);
  });

  it("기준점(ensureBaseline)이 있으면 로드 전 이벤트가 debounce 를 넘겨도 modified 없음 (QA-4 회귀)", () => {
    // 리뷰 재현: 이벤트 → 200ms 초과 대기(사진 로드) → suspend/reset/resume.
    // 기준점이 null 이면 첫 push 가 무조건 "변경" 이라 onModified 가 1회 났다.
    const { recorder, stack, onModified, setState } = setup("chrome-only");
    recorder.ensureBaseline();
    recorder.notifyChange();
    vi.advanceTimersByTime(350);
    expect(onModified).not.toHaveBeenCalled();

    recorder.suspend();
    setState("doc-v1");
    recorder.notifyChange();
    recorder.resetToCurrent();
    recorder.resume();
    vi.advanceTimersByTime(1000);
    expect(onModified).not.toHaveBeenCalled();
    expect(stack.canUndo).toBe(false);
  });

  it("ensureBaseline 은 이미 기준점이 있으면 건드리지 않고, 문서 없이 시작해도 첫 편집은 modified", () => {
    const { recorder, stack, onModified, setState } = setup("empty");
    recorder.ensureBaseline();
    setState("empty+text");
    recorder.notifyChange();
    vi.advanceTimersByTime(200);
    expect(onModified).toHaveBeenCalledTimes(1);

    // 캔버스 재생성 시 다시 호출돼도 히스토리를 지우지 않는다.
    setState("other");
    recorder.ensureBaseline();
    expect(stack.currentSnapshot).toBe("empty+text");
    expect(stack.canUndo).toBe(true);
  });

  it("revertUnapplied: 연속 undo 중 마지막 복원이 실패하면 캔버스에 보이는 상태까지 포인터를 되돌린다", () => {
    const { recorder, stack, setState } = setup("a");
    recorder.resetToCurrent();
    setState("b");
    recorder.commit();
    setState("c");
    recorder.commit();

    // undo 2회 연속 — 첫 복원은 순번에 밀려 반영되지 않았고, 두 번째 복원이 실패.
    expect(recorder.undo()).toBe("b");
    expect(recorder.undo()).toBe("a");
    recorder.revertUnapplied();
    expect(stack.currentSnapshot).toBe("c");
    expect(stack.canRedo).toBe(false);
    expect(stack.size()).toEqual({ past: 2, future: 0 });
  });

  it("revertUnapplied: 반영된 복원 이후 단계만 되돌린다", () => {
    const { recorder, stack, setState } = setup("a");
    recorder.resetToCurrent();
    setState("b");
    recorder.commit();
    setState("c");
    recorder.commit();

    expect(recorder.undo()).toBe("b");
    recorder.markRestored("b"); // 캔버스 반영
    expect(recorder.undo()).toBe("a");
    recorder.revertUnapplied(); // 두 번째 복원 실패
    expect(stack.currentSnapshot).toBe("b");
    expect(recorder.redo()).toBe("c");
  });

  it("revertUnapplied: redo 실패도 되돌린다", () => {
    const { recorder, stack, setState } = setup("a");
    recorder.resetToCurrent();
    setState("b");
    recorder.commit();
    expect(recorder.undo()).toBe("a");
    recorder.markRestored("a");
    expect(recorder.redo()).toBe("b");
    recorder.revertUnapplied();
    expect(stack.currentSnapshot).toBe("a");
    expect(stack.canRedo).toBe(true);
  });

  it("markRestored: 복원 캔버스 스냅샷이 저장본과 달라도(src 치환) 다음 무해한 이벤트는 no-op", () => {
    const { recorder, stack, onModified, setState } = setup("a@old-url");
    recorder.resetToCurrent();
    setState("b@old-url");
    recorder.commit();
    expect(onModified).toHaveBeenCalledTimes(1);

    expect(recorder.undo()).toBe("a@old-url");
    // 복원 시 사진 src 를 최신 URL 로 바꿔 올렸다.
    setState("a@new-url");
    recorder.markRestored("a@new-url");

    recorder.notifyChange(); // 예: 선택 해제·값 변화 없는 object:modified
    vi.advanceTimersByTime(200);
    expect(onModified).toHaveBeenCalledTimes(1);
    expect(stack.canRedo).toBe(true);
    expect(recorder.redo()).toBe("b@old-url");
  });

  it("rebaseCurrent: URL 갱신으로 src 만 바뀌면 dirty 없음, 대기 중 실제 편집은 먼저 push", () => {
    const { recorder, stack, onModified, setState } = setup("a@old");
    recorder.resetToCurrent();

    setState("a@new");
    recorder.rebaseCurrent();
    recorder.notifyChange();
    vi.advanceTimersByTime(200);
    expect(onModified).not.toHaveBeenCalled();
    expect(stack.canUndo).toBe(false);

    setState("a+text@new");
    recorder.notifyChange(); // 200ms 안에 URL 갱신
    recorder.rebaseCurrent();
    expect(onModified).toHaveBeenCalledTimes(1);
    expect(stack.canUndo).toBe(true);

    // suspend 중(로드·복원)에는 건너뛴다.
    recorder.suspend();
    setState("loading");
    recorder.rebaseCurrent();
    recorder.resume();
    expect(stack.currentSnapshot).toBe("a+text@new");
  });
});

describe("connectCanvasHistory (이벤트 필터)", () => {
  function fakeSource() {
    const handlers = new Map<
      HistoryCanvasEvent,
      Set<(e: HistoryCanvasEventPayload) => void>
    >();
    const source: HistoryEventSource & {
      emit: (name: HistoryCanvasEvent, e: HistoryCanvasEventPayload) => void;
      count: () => number;
    } = {
      on(name, handler) {
        const set = handlers.get(name) ?? new Set();
        set.add(handler);
        handlers.set(name, set);
        return () => {
          set.delete(handler);
        };
      },
      emit(name, e) {
        for (const h of handlers.get(name) ?? []) h(e);
      },
      count() {
        let n = 0;
        for (const set of handlers.values()) n += set.size;
        return n;
      },
    };
    return source;
  }

  it("isChromeHistoryEvent 는 excludeFromExport 대상만 true", () => {
    expect(isChromeHistoryEvent({ target: { excludeFromExport: true } })).toBe(true);
    expect(isChromeHistoryEvent({ target: { excludeFromExport: false } })).toBe(false);
    expect(isChromeHistoryEvent({ target: {} })).toBe(false);
    expect(isChromeHistoryEvent({})).toBe(false);
    expect(isChromeHistoryEvent(undefined)).toBe(false);
  });

  it("chrome 대상 이벤트는 notifyChange 로 이어지지 않고, 해제 함수가 세 이벤트를 모두 뗀다", () => {
    const source = fakeSource();
    const notifyChange = vi.fn();
    const disconnect = connectCanvasHistory(source, { notifyChange });
    expect(source.count()).toBe(3);

    source.emit("object:added", { target: { excludeFromExport: true } });
    source.emit("object:removed", { target: { excludeFromExport: true } });
    expect(notifyChange).not.toHaveBeenCalled();

    source.emit("object:added", { target: {} });
    source.emit("object:modified", { target: {} });
    source.emit("object:removed", { target: {} });
    expect(notifyChange).toHaveBeenCalledTimes(3);

    disconnect();
    expect(source.count()).toBe(0);
  });
});

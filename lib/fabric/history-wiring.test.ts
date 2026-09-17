/**
 * FabricStage 히스토리 연결 순서 회귀 테스트 (QA-4 — 편집 없이 dirty).
 *
 * 리뷰 재현 경로: 캔버스 생성 → 히스토리 연결 → 안전선(chrome) 2개 add(object:added) →
 * onReady → loadDoc 이 사진 로드를 200ms 넘게 기다림 → 예약된 push 가 가드 없이 실행 →
 * 기준점 null 이라 "변경" → onModified → dirty → 자동저장 PATCH·이탈 경고.
 *
 * 실제 fabric StaticCanvas 이벤트(object:added/removed)와 createSnapshot 을 써서
 * FabricStage 와 같은 순서(chrome → recorder → ensureBaseline → connect → loadDoc)를 흉내 낸다.
 * jsdom 에 2D 컨텍스트가 없어 렌더 없이(renderOnAddRemove:false) 이벤트·직렬화 경로만 탄다.
 */

import * as fabric from "fabric";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { connectCanvasHistory, HistoryRecorder, HistoryStack } from "./history";
import type { TaggedFabricObject } from "./serialize";
import { createSnapshot } from "./snapshot";

beforeAll(() => {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
});
afterAll(() => {
  vi.restoreAllMocks();
});
beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

function makeCanvas(): fabric.StaticCanvas {
  return new fabric.StaticCanvas(document.createElement("canvas"), {
    width: 420,
    height: 420,
    renderOnAddRemove: false,
  });
}

function chromeRect(): fabric.Rect {
  return new fabric.Rect({
    left: 210,
    top: 210,
    width: 400,
    height: 400,
    fill: "transparent",
    selectable: false,
    evented: false,
    excludeFromExport: true,
  });
}

function taggedRect(id: string): TaggedFabricObject {
  const r = new fabric.Rect({ left: 50, top: 50, width: 40, height: 20 });
  const t = r as TaggedFabricObject;
  t.objectId = id;
  t.oType = "rect";
  return t;
}

function mountStage(opts: { chromeAfterConnect?: boolean } = {}) {
  const canvas = makeCanvas();
  const stack = new HistoryStack();
  const onModified = vi.fn();
  if (!opts.chromeAfterConnect) {
    canvas.add(chromeRect());
    canvas.add(chromeRect());
  }
  const recorder = new HistoryRecorder({
    stack,
    takeSnapshot: () => createSnapshot(canvas),
    debounceMs: 200,
    onModified,
  });
  recorder.ensureBaseline();
  const disconnect = connectCanvasHistory(canvas, recorder);
  if (opts.chromeAfterConnect) {
    // 연결 뒤에 chrome 이 추가돼도(순서가 바뀌어도) 필터가 막는다.
    canvas.add(chromeRect());
    canvas.add(chromeRect());
  }
  return { canvas, stack, recorder, onModified, disconnect };
}

/** FabricStage.loadDoc 과 같은 순서: await 전 suspend → 교체 → 기준점 → resume. */
async function loadDoc(
  stage: ReturnType<typeof mountStage>,
  objects: TaggedFabricObject[],
  loadMs: number,
) {
  stage.recorder.suspend();
  try {
    await vi.advanceTimersByTimeAsync(loadMs); // 사진 로드 대기
    stage.canvas.remove(
      ...stage.canvas.getObjects().filter((o) => !o.excludeFromExport),
    );
    for (const o of objects) stage.canvas.add(o);
    stage.recorder.resetToCurrent();
  } finally {
    stage.recorder.resume();
  }
}

describe("FabricStage 히스토리 연결 — 편집 없는 진입은 dirty 가 아니다", () => {
  it.each([50, 350, 6000])(
    "문서 로드가 %ims 걸려도 onModified 0회",
    async (loadMs) => {
      const stage = mountStage();
      expect(stage.recorder.hasPendingPush).toBe(false);
      await loadDoc(stage, [taggedRect("r1"), taggedRect("r2")], loadMs);
      await vi.advanceTimersByTimeAsync(1000);
      expect(stage.onModified).not.toHaveBeenCalled();
      expect(stage.stack.canUndo).toBe(false);
      stage.disconnect();
    },
  );

  it("chrome 이 히스토리 연결 뒤에 추가돼도 push 가 예약되지 않는다", async () => {
    const stage = mountStage({ chromeAfterConnect: true });
    expect(stage.recorder.hasPendingPush).toBe(false);
    await vi.advanceTimersByTimeAsync(1000);
    expect(stage.onModified).not.toHaveBeenCalled();
    stage.disconnect();
  });

  it("기준점이 없던 예전 순서(연결 → chrome add → 느린 로드)는 dirty 가 됐다 — 대조군", async () => {
    const canvas = makeCanvas();
    const stack = new HistoryStack();
    const onModified = vi.fn();
    const recorder = new HistoryRecorder({
      stack,
      takeSnapshot: () => createSnapshot(canvas),
      debounceMs: 200,
      onModified,
    });
    // 필터 없는 연결 + ensureBaseline 없음 + chrome add 뒤 로드 대기 중 suspend 없음.
    canvas.on("object:added", () => recorder.notifyChange());
    canvas.add(chromeRect());
    await vi.advanceTimersByTimeAsync(350);
    expect(onModified).toHaveBeenCalledTimes(1);
  });

  it("로드 후 실제 사용자 편집은 한 번만 modified, 다시 chrome 변경은 무시", async () => {
    const stage = mountStage();
    await loadDoc(stage, [taggedRect("r1")], 350);

    stage.canvas.add(taggedRect("r-new"));
    await vi.advanceTimersByTimeAsync(200);
    expect(stage.onModified).toHaveBeenCalledTimes(1);
    expect(stage.stack.canUndo).toBe(true);

    const guide = chromeRect();
    stage.canvas.add(guide);
    stage.canvas.remove(guide);
    await vi.advanceTimersByTimeAsync(1000);
    expect(stage.onModified).toHaveBeenCalledTimes(1);
    stage.disconnect();
  });

  it("문서 없이 시작한 캔버스(로드 없음)에서도 첫 사용자 객체 추가는 dirty", async () => {
    const stage = mountStage();
    await vi.advanceTimersByTimeAsync(500);
    expect(stage.onModified).not.toHaveBeenCalled();
    stage.canvas.add(taggedRect("first"));
    await vi.advanceTimersByTimeAsync(200);
    expect(stage.onModified).toHaveBeenCalledTimes(1);
    stage.disconnect();
  });
});

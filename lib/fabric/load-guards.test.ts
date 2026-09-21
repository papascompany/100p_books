/**
 * 문서 교체·복원 대기 중 경합 회귀 테스트.
 *
 * 1. 객체: FabricStage.loadDoc 이 사진 로드를 기다리는 동안 툴바로 추가한 텍스트·사진이
 *    교체 시점의 "chrome 아닌 객체 전부 제거" 로 조용히 사라졌다.
 * 2. 배경: 교체가 끝날 때 문서 배경을 덮어, 기다리는 동안 사용자가 고른 배경(저장 메타에는
 *    반영됨)이 화면에서만 되돌아갔다.
 *
 * 실제 fabric StaticCanvas(렌더 없음)·HistoryRecorder·createSnapshot 으로 FabricStage 와
 * 같은 순서(호출 시점 캡처 → suspend → 대기 → 교체 → 기준점 → resume → commit)를 흉내 낸다.
 */

import * as fabric from "fabric";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { createIdleTracker } from "@/lib/editor/async-gates";

import { connectCanvasHistory, HistoryRecorder, HistoryStack } from "./history";
import {
  captureUserObjects,
  createBackgroundGate,
  createLoadFailureLatch,
  replaceUserObjects,
  type LoadDocResult,
} from "./load-guards";
import type { TaggedFabricObject } from "./serialize";
import {
  createSnapshot,
  createSnapshotWithout,
  parseSnapshot,
} from "./snapshot";

beforeAll(() => {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
});
afterAll(() => {
  vi.restoreAllMocks();
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

function tagged(id: string): TaggedFabricObject {
  const r = new fabric.Rect({ left: 40, top: 40, width: 30, height: 20 });
  const t = r as TaggedFabricObject;
  t.objectId = id;
  t.oType = "rect";
  return t;
}

function ids(canvas: fabric.StaticCanvas): string[] {
  return canvas
    .getObjects()
    .map((o) =>
      o.excludeFromExport ? "chrome" : String((o as TaggedFabricObject).objectId),
    );
}

function snapshotIds(json: string | null): string[] {
  const parsed = json ? parseSnapshot(json) : null;
  return parsed ? parsed.objects.map((o) => String(o.objectId)) : [];
}

describe("replaceUserObjects", () => {
  it("호출 시점 객체만 지우고, 대기 중 추가된 객체는 새 문서 위에 보존한다", () => {
    const canvas = makeCanvas();
    canvas.add(chromeRect(), chromeRect(), tagged("old-1"), tagged("old-2"));
    const previous = captureUserObjects(canvas.getObjects());

    // 대기 중 사용자가 추가
    const added = tagged("added-text");
    canvas.add(added);

    const { removed, preserved } = replaceUserObjects(canvas, previous, [
      tagged("new-1"),
      tagged("new-2"),
    ]);

    expect(ids(canvas)).toEqual([
      "chrome",
      "chrome",
      "new-1",
      "new-2",
      "added-text",
    ]);
    expect(removed.map((o) => (o as TaggedFabricObject).objectId)).toEqual([
      "old-1",
      "old-2",
    ]);
    expect(preserved).toEqual([added]);
  });

  it("대기 중 추가가 없으면 예전과 같다(chrome 뒤에 새 객체)", () => {
    const canvas = makeCanvas();
    canvas.add(chromeRect(), tagged("old"));
    const previous = captureUserObjects(canvas.getObjects());
    const { preserved } = replaceUserObjects(canvas, previous, [tagged("new")]);
    expect(preserved).toEqual([]);
    expect(ids(canvas)).toEqual(["chrome", "new"]);
  });

  it("태그가 깨진 기존 객체도 교체 대상이다(저장 불변식 위반 객체를 남기지 않는다)", () => {
    const canvas = makeCanvas();
    canvas.add(chromeRect(), new fabric.Rect({ width: 5, height: 5 }));
    const previous = captureUserObjects(canvas.getObjects());
    replaceUserObjects(canvas, previous, [tagged("new")]);
    expect(ids(canvas)).toEqual(["chrome", "new"]);
  });

  it("대조군: 예전 방식(교체 시점에 chrome 아닌 객체 전부 제거)은 대기 중 추가한 객체를 잃는다", () => {
    const canvas = makeCanvas();
    canvas.add(chromeRect(), tagged("old"));
    canvas.add(tagged("added-text")); // 대기 중 추가
    canvas.remove(...canvas.getObjects().filter((o) => !o.excludeFromExport));
    canvas.add(tagged("new"));
    expect(ids(canvas)).toEqual(["chrome", "new"]);
  });
});

describe("createSnapshotWithout", () => {
  it("캔버스에서 그 객체를 뺀 상태의 스냅샷과 글자 단위로 같다", () => {
    const canvas = makeCanvas();
    const keep = tagged("keep");
    const drop = tagged("drop");
    canvas.add(chromeRect(), keep, drop);
    const without = createSnapshotWithout(canvas, new Set([drop]));
    canvas.remove(drop);
    expect(without).toBe(createSnapshot(canvas));
    expect(snapshotIds(without)).toEqual(["keep"]);
  });
});

describe("loadDoc 흐름 — 대기 중 추가한 객체는 저장 대상 편집이 된다", () => {
  function mount() {
    const canvas = makeCanvas();
    canvas.add(chromeRect(), chromeRect());
    const stack = new HistoryStack();
    const onModified = vi.fn();
    const recorder = new HistoryRecorder({
      stack,
      takeSnapshot: () => createSnapshot(canvas),
      debounceMs: 200,
      onModified,
    });
    recorder.ensureBaseline();
    const disconnect = connectCanvasHistory(canvas, recorder);
    canvas.add(tagged("old")); // 이전 문서
    recorder.resetToCurrent();
    onModified.mockClear();
    return { canvas, stack, recorder, onModified, disconnect };
  }

  it("보존 객체는 기준점(로드한 문서) 위 한 단계로 push 되고 onModified 1회", () => {
    const { canvas, stack, recorder, onModified, disconnect } = mount();

    // FabricStage.loadDoc: await 전에 캡처 + suspend
    const previous = captureUserObjects(canvas.getObjects());
    recorder.suspend();
    // --- 사진 로드 대기 중: 툴바로 텍스트 추가(히스토리 이벤트는 suspend 로 무시) ---
    canvas.add(tagged("added-text"));
    // --- 대기 끝: 교체 ---
    const { preserved } = replaceUserObjects(canvas, previous, [tagged("loaded")]);
    recorder.resetTo(createSnapshotWithout(canvas, new Set(preserved)));
    recorder.resume();
    const pushed = recorder.commit();

    expect(ids(canvas)).toEqual(["chrome", "chrome", "loaded", "added-text"]);
    expect(pushed).toBe(true);
    expect(onModified).toHaveBeenCalledTimes(1);
    expect(snapshotIds(stack.currentSnapshot)).toEqual(["loaded", "added-text"]);
    // undo 하면 로드한 문서로 돌아간다(보존 객체만 되돌리는 대상).
    expect(snapshotIds(stack.undo())).toEqual(["loaded"]);
    disconnect();
  });

  it("대기 중 추가가 없으면 기준점만 바뀌고 onModified 없음(편집 없는 로드는 dirty 아님)", () => {
    const { canvas, stack, recorder, onModified, disconnect } = mount();
    const previous = captureUserObjects(canvas.getObjects());
    recorder.suspend();
    const { preserved } = replaceUserObjects(canvas, previous, [tagged("loaded")]);
    expect(preserved).toEqual([]);
    recorder.resetToCurrent();
    recorder.resume();
    expect(recorder.commit()).toBe(false);
    expect(onModified).not.toHaveBeenCalled();
    expect(stack.canUndo).toBe(false);
    disconnect();
  });
});

describe("createBackgroundGate — 배경은 호출 순서로 판정한다", () => {
  it("로드 대기 중 사용자가 이미지를 고르면: 로드는 이미지를 덮지 않고 색만 적용", () => {
    const gate = createBackgroundGate();
    const load = gate.claim(["color", "image"]); // loadDoc 호출
    const pick = gate.claim(["image"]); // 대기 중 배경 선택
    // 교체 시점
    expect(load.isCurrent("color")).toBe(true);
    expect(load.isCurrent("image")).toBe(false);
    // 선택한 이미지의 비동기 적용
    expect(pick.isCurrent("image")).toBe(true);
  });

  it("선택 이미지가 로드 호출 뒤에 도착하면 버린다(로드가 더 나중 요청)", () => {
    const gate = createBackgroundGate();
    const pick = gate.claim(["image"]);
    const load = gate.claim(["color", "image"]);
    expect(pick.isCurrent("image")).toBe(false);
    expect(load.isCurrent("image")).toBe(true);
  });

  it("색 선택은 이미지도 비운다 — 앞선 이미지 요청을 무효화", () => {
    const gate = createBackgroundGate();
    const pick = gate.claim(["image"]);
    const color = gate.claim(["color", "image"]);
    expect(pick.isCurrent("image")).toBe(false);
    expect(color.isCurrent("color")).toBe(true);
  });

  it("요청하지 않은 레이어는 current 가 아니다", () => {
    const gate = createBackgroundGate();
    const pick = gate.claim(["image"]);
    expect(pick.isCurrent("color")).toBe(false);
  });
});

describe("createLoadFailureLatch — 로드 실패 시 저장 차단 (A 리뷰: load_failed 틈)", () => {
  /**
   * FabricStage.loadDoc 과 같은 구조(순번 · idle begin → try/await → catch(래치) → finally(idle end))와
   * 에디터 저장(whenIdle 대기 → 직렬화 판정), 호출자 catch(에디터 saveBlockRef)를 흉내 낸다.
   * 예전에는 차단을 호출자 catch 에서만 걸어, finally 의 idle end 로 먼저 재개된 저장이 빈 캔버스를 보냈다.
   * FabricStage 배선 자체는 components/editor/editor-source-guards.test.ts 가 고정한다.
   */
  function makeStage() {
    const idle = createIdleTracker();
    const latch = createLoadFailureLatch();
    let seq = 0;
    const log: string[] = [];
    async function loadDoc(work: Promise<void>): Promise<LoadDocResult> {
      const mine = ++seq;
      const endIdle = idle.begin();
      try {
        await work;
        if (mine !== seq) return "superseded";
        latch.markApplied();
        return "applied";
      } catch (err) {
        latch.markFailed(mine === seq);
        throw err;
      } finally {
        endIdle();
      }
    }
    async function save(): Promise<"saved" | "blocked"> {
      await idle.whenIdle();
      log.push("save:check");
      return latch.failed ? "blocked" : "saved";
    }
    return { latch, loadDoc, save, log };
  }

  function deferred() {
    let resolve!: () => void;
    let reject!: (e: Error) => void;
    const promise = new Promise<void>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  }

  it("로드 실패 — 대기 중이던 저장이 호출자 catch 보다 먼저 재개돼도 막힌다", async () => {
    const stage = makeStage();
    const work = deferred();
    const loading = stage
      .loadDoc(work.promise)
      .catch(() => stage.log.push("caller:catch"));
    const saving = stage.save();
    work.reject(new Error("image load failed"));
    await expect(saving).resolves.toBe("blocked");
    await loading;
    // 저장 판정이 호출자 catch 보다 먼저 돈다 — 호출자 쪽 차단만으로는 늦다는 것을 고정한다.
    expect(stage.log).toEqual(["save:check", "caller:catch"]);
  });

  it("다음 로드가 반영(applied)되면 차단이 풀린다", async () => {
    const stage = makeStage();
    await expect(stage.loadDoc(Promise.reject(new Error("x")))).rejects.toThrow("x");
    expect(stage.latch.failed).toBe(true);
    await expect(stage.loadDoc(Promise.resolve())).resolves.toBe("applied");
    expect(stage.latch.failed).toBe(false);
    await expect(stage.save()).resolves.toBe("saved");
  });

  it("밀린(superseded) 옛 로드의 완료가 더 새 로드의 실패를 지우지 않는다", async () => {
    const stage = makeStage();
    const older = deferred();
    const newer = deferred();
    const olderLoad = stage.loadDoc(older.promise);
    const newerLoad = stage.loadDoc(newer.promise).catch(() => "failed" as const);
    newer.reject(new Error("newer failed"));
    await expect(newerLoad).resolves.toBe("failed");
    older.resolve();
    await expect(olderLoad).resolves.toBe("superseded");
    expect(stage.latch.failed).toBe(true);
    await expect(stage.save()).resolves.toBe("blocked");
  });

  it("밀린 옛 로드의 실패는 무시한다 — 더 새 로드가 반영했으면 저장 가능", async () => {
    const stage = makeStage();
    const older = deferred();
    const olderLoad = stage.loadDoc(older.promise).catch(() => "failed" as const);
    await expect(stage.loadDoc(Promise.resolve())).resolves.toBe("applied");
    older.reject(new Error("older failed"));
    await expect(olderLoad).resolves.toBe("failed");
    expect(stage.latch.failed).toBe(false);
    await expect(stage.save()).resolves.toBe("saved");
  });
});

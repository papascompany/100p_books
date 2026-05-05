import { describe, expect, it } from "vitest";

import { HISTORY_MAX, HistoryStack } from "./history";

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
});

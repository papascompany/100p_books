import { describe, expect, it, vi } from "vitest";

import {
  applyVerticalTextControls,
  onPlaceholderEditingEntered,
  onPlaceholderEditingExited,
  onPlaceholderTextChanged,
  readPlaceholderAwareText,
  writePlaceholderAwareText,
} from "./text-placeholder-behavior";

const PH = "여기에 글을 입력하세요";
const GRAY = "rgba(0,0,0,0.35)";

function fakeText(over: Record<string, unknown> = {}) {
  const t: Record<string, unknown> = {
    oType: "text",
    text: PH,
    fill: GRAY,
    placeholderText: PH,
    placeholderActive: true,
    realFill: "#2b2b2b",
    selectAll: vi.fn(),
    ...over,
  };
  t.set = (p: Record<string, unknown>) => Object.assign(t, p);
  return t;
}

describe("텍스트 안내 문구 편집 동작", () => {
  it("편집 시작 — 안내 문구면 전체 선택", () => {
    const t = fakeText();
    onPlaceholderEditingEntered(t);
    expect(t.selectAll).toHaveBeenCalledTimes(1);
  });

  it("편집 시작 — 사용자 글이면 선택하지 않음", () => {
    const t = fakeText({ text: "제주", placeholderActive: false, fill: "#2b2b2b" });
    onPlaceholderEditingEntered(t);
    expect(t.selectAll).not.toHaveBeenCalled();
  });

  it("입력 — 문구와 달라지면 안내 상태 해제 + 실제 색", () => {
    const t = fakeText({ text: "제" });
    expect(onPlaceholderTextChanged(t)).toBe(true);
    expect(t.placeholderActive).toBe(false);
    expect(t.fill).toBe("#2b2b2b");
  });

  it("편집 종료 — 모두 지우면 안내 문구 복귀(흐린 색), 실제 색 보관", () => {
    const t = fakeText({ text: "", placeholderActive: false, fill: "#ff0000" });
    expect(onPlaceholderEditingExited(t)).toBe(true);
    expect(t.text).toBe(PH);
    expect(t.fill).toBe(GRAY);
    expect(t.placeholderActive).toBe(true);
    expect(t.realFill).toBe("#ff0000");
  });

  it("편집 종료 — 글이 있으면 그대로", () => {
    const t = fakeText({ text: "제주", placeholderActive: false, fill: "#2b2b2b" });
    expect(onPlaceholderEditingExited(t)).toBe(false);
    expect(t.text).toBe("제주");
  });

  it("placeholder 없는 텍스트·다른 객체는 무시", () => {
    const t = fakeText({ placeholderText: undefined, text: "" });
    expect(onPlaceholderEditingExited(t)).toBe(false);
    expect(onPlaceholderTextChanged({ oType: "photo" })).toBe(false);
  });
});

describe("책등 제목 입력칸 — 텍스트 읽기·쓰기", () => {
  const SPINE = "우리 가족 여행";

  it("안내 문구만 떠 있으면 빈 값으로 읽는다", () => {
    const t = fakeText({ text: SPINE, placeholderText: SPINE });
    expect(readPlaceholderAwareText(t)).toBe("");
  });

  it("입력하면 실제 글자색으로 바뀌고 안내 상태가 끝난다", () => {
    const t = fakeText({ text: SPINE, placeholderText: SPINE });
    writePlaceholderAwareText(t, "제주 여행");
    expect(t.text).toBe("제주 여행");
    expect(t.fill).toBe("#2b2b2b");
    expect(t.placeholderActive).toBe(false);
    expect(readPlaceholderAwareText(t)).toBe("제주 여행");
  });

  it("비우면 안내 문구(흐린 색)로 돌아가고 빈 값으로 읽힌다", () => {
    const t = fakeText({ text: "제주", placeholderText: SPINE, placeholderActive: false, fill: "#111111" });
    writePlaceholderAwareText(t, "  ");
    expect(t.text).toBe(SPINE);
    expect(t.fill).toBe(GRAY);
    expect(t.placeholderActive).toBe(true);
    expect(t.realFill).toBe("#111111");
    expect(readPlaceholderAwareText(t)).toBe("");
  });

  it("세로쓰기 박스만 좌우 크기 핸들을 숨긴다", () => {
    const vis = vi.fn();
    applyVerticalTextControls({ oType: "text", verticalText: true, setControlsVisibility: vis });
    expect(vis).toHaveBeenCalledWith({ ml: false, mr: false });
    const other = vi.fn();
    applyVerticalTextControls({ oType: "text", setControlsVisibility: other });
    expect(other).not.toHaveBeenCalled();
  });
});

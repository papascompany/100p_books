import { describe, expect, it } from "vitest";

import {
  AUTOGEN_DEFAULTS,
  editorEntryHref,
  isAutogenRequested,
  shouldAutoGenerate,
} from "./autogen";

const ID = "11111111-2222-3333-4444-555555555555";

describe("editorEntryHref", () => {
  it("기본은 쿼리 없는 내지 목록 경로", () => {
    expect(editorEntryHref(ID)).toBe(`/editor/${ID}`);
    expect(editorEntryHref(ID, { autogen: false })).toBe(`/editor/${ID}`);
  });

  it("autogen 이면 ?autogen=1 을 붙인다", () => {
    expect(editorEntryHref(ID, { autogen: true })).toBe(
      `/editor/${ID}?autogen=1`,
    );
  });
});

describe("isAutogenRequested", () => {
  it('정확히 "1" 일 때만 요청으로 본다', () => {
    expect(isAutogenRequested("1")).toBe(true);
    expect(isAutogenRequested(undefined)).toBe(false);
    expect(isAutogenRequested("")).toBe(false);
    expect(isAutogenRequested("0")).toBe(false);
    expect(isAutogenRequested("true")).toBe(false);
  });

  it("배열이면 첫 값만 본다", () => {
    expect(isAutogenRequested(["1", "0"])).toBe(true);
    expect(isAutogenRequested(["0", "1"])).toBe(false);
    expect(isAutogenRequested([])).toBe(false);
  });
});

describe("shouldAutoGenerate", () => {
  const base = { requested: true, pageCount: 0, photoCount: 3, locked: false };

  it("요청 + 0페이지 + 사진 있음 + 잠기지 않음이면 생성", () => {
    expect(shouldAutoGenerate(base)).toBe(true);
  });

  it("쿼리 없이 들어오면 생성하지 않는다", () => {
    expect(shouldAutoGenerate({ ...base, requested: false })).toBe(false);
  });

  it("이미 페이지가 있으면 덮어쓰지 않는다", () => {
    expect(shouldAutoGenerate({ ...base, pageCount: 1 })).toBe(false);
    expect(shouldAutoGenerate({ ...base, pageCount: 40 })).toBe(false);
  });

  it("사진이 없으면 시도하지 않는다", () => {
    expect(shouldAutoGenerate({ ...base, photoCount: 0 })).toBe(false);
  });

  it("잠긴 포토북은 생성하지 않는다", () => {
    expect(shouldAutoGenerate({ ...base, locked: true })).toBe(false);
  });
});

describe("AUTOGEN_DEFAULTS", () => {
  it("촬영시각 순 · 폴라로이드", () => {
    expect(AUTOGEN_DEFAULTS).toEqual({ sortMode: "exif", layoutMode: "polaroid" });
  });
});

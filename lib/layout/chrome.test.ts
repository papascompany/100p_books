import { describe, expect, it } from "vitest";

import { isEditorOnlyPath } from "./chrome";

describe("isEditorOnlyPath", () => {
  it.each([
    "/cover/abc",
    "/cover/7b0c1e2a-0000-4000-8000-000000000000",
    "/editor/abc/pages/p1",
    "/editor/7b0c1e2a-0000-4000-8000-000000000000/pages/9f9f9f9f-0000-4000-8000-000000000000",
  ])("에디터 전용 경로: %s", (path) => {
    expect(isEditorOnlyPath(path)).toBe(true);
  });

  it.each([
    "/",
    "/cover",
    "/cover/",
    "/cover/abc/extra",
    "/editor",
    "/editor/abc",
    "/editor/abc/",
    "/editor/abc/pages",
    "/editor/abc/pages/",
    "/editor/abc/pages/p1/extra",
    "/upload",
    "/order/abc",
    "/projects",
    "/x/cover/abc",
  ])("사이트 크롬 유지: %s", (path) => {
    expect(isEditorOnlyPath(path)).toBe(false);
  });

  it("pathname 이 없으면 크롬을 유지한다", () => {
    expect(isEditorOnlyPath(null)).toBe(false);
    expect(isEditorOnlyPath(undefined)).toBe(false);
    expect(isEditorOnlyPath("")).toBe(false);
  });
});

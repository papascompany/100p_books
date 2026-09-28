import { describe, expect, it } from "vitest";

import { reorderById } from "./reorder-pages";

const pages = ["a", "b", "c", "d"].map((id) => ({ id }));
const ids = (xs: { id: string }[] | null) => xs?.map((p) => p.id) ?? null;

describe("reorderById", () => {
  it("앞 → 뒤로 이동", () => {
    expect(ids(reorderById(pages, "a", 2))).toEqual(["b", "c", "a", "d"]);
  });

  it("뒤 → 앞으로 이동", () => {
    expect(ids(reorderById(pages, "d", 0))).toEqual(["d", "a", "b", "c"]);
  });

  it("마지막 자리로 이동", () => {
    expect(ids(reorderById(pages, "b", 3))).toEqual(["a", "c", "d", "b"]);
  });

  it("같은 자리면 null(재정렬·onReorder 생략)", () => {
    expect(reorderById(pages, "c", 2)).toBeNull();
  });

  it("드래그 id 또는 타깃 index 가 없으면 null", () => {
    expect(reorderById(pages, null, 1)).toBeNull();
    expect(reorderById(pages, "a", null)).toBeNull();
  });

  it("목록에 없는 id(refresh 로 사라진 페이지)면 null", () => {
    expect(reorderById(pages, "zz", 1)).toBeNull();
  });

  it("원본 배열을 바꾸지 않는다(롤백 스냅샷 보존)", () => {
    const snapshot = pages.map((p) => p.id);
    const next = reorderById(pages, "a", 3);
    expect(next).not.toBe(pages);
    expect(pages.map((p) => p.id)).toEqual(snapshot);
  });

  it("index 0 은 유효한 타깃이다(falsy 취급 금지)", () => {
    expect(ids(reorderById(pages, "b", 0))).toEqual(["b", "a", "c", "d"]);
  });
});

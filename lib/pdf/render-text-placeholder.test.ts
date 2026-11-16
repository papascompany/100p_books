/**
 * 인쇄 렌더에서 텍스트 안내 문구를 그리지 않는지 — 2026-11-16 운영 결함 회귀 테스트.
 * 예전 편집기는 "여기에 글을 입력하세요"를 실제 텍스트(흐린 색)로 저장했다.
 */
import { describe, expect, it } from "vitest";

import { PAGEDOC_VERSION, type PageDoc, type TextObject } from "@/lib/layout/types";

import { renderPageToPng } from "./render-page";

function page(objects: TextObject[]): PageDoc {
  return {
    version: PAGEDOC_VERSION,
    bookSizeId: "b",
    pageNo: 1,
    layoutMode: "polaroid",
    widthMm: 60,
    heightMm: 40,
    bleedMm: 2,
    backgroundColor: "#ffffff",
    objects,
  } as PageDoc;
}

function caption(text: string, fill: string): TextObject {
  return {
    type: "text",
    objectId: "cap",
    leftMm: 5,
    topMm: 10,
    widthMm: 50,
    heightMm: 20,
    text,
    fontFamily: "Pretendard",
    fontSizePt: 28,
    fill,
    align: "center",
    lineHeight: 1.2,
  };
}

const ctx = {
  dpi: 72,
  resolveImageUrl: async () => Buffer.alloc(0),
};

describe("renderPage — 텍스트 안내 문구 비인쇄", () => {
  it("흐린 색으로 저장된 안내 문구는 빈 페이지와 같은 픽셀", async () => {
    const blank = await renderPageToPng(page([]), ctx);
    const legacy = await renderPageToPng(
      page([caption("여기에 글을 입력하세요", "rgba(0,0,0,0.35)")]),
      ctx,
    );
    expect(legacy.equals(blank)).toBe(true);
  });

  it("빈 텍스트 + placeholder 는 그리지 않고, 사용자 글은 그린다", async () => {
    const blank = await renderPageToPng(page([]), ctx);
    const empty = await renderPageToPng(
      page([{ ...caption("", "#2b2b2b"), placeholder: "여기에 글을 입력하세요" }]),
      ctx,
    );
    expect(empty.equals(blank)).toBe(true);
    const real = await renderPageToPng(page([caption("제주", "#2b2b2b")]), ctx);
    expect(real.equals(blank)).toBe(false);
  });
});

import { describe, expect, it } from "vitest";

import { calcCoverDimensions } from "./cover";
import {
  buildCoverObjects,
  COVER_TEMPLATE_META,
  COVER_TEMPLATES,
  type CoverTemplateId,
} from "./cover-templates";

const BOOK_SIZE = {
  cover_width_mm: 150,
  cover_height_mm: 212,
  spine_formula_per_page: 0.09,
};

const DIMS = calcCoverDimensions({
  bookSize: BOOK_SIZE,
  pageCount: 100,
});

describe("COVER_TEMPLATES registry", () => {
  it("정확히 5개", () => {
    expect(Object.keys(COVER_TEMPLATES).length).toBe(5);
  });
  it("META 5개 (id/label/previewSvg)", () => {
    expect(COVER_TEMPLATE_META.length).toBe(5);
    for (const meta of COVER_TEMPLATE_META) {
      expect(meta.id).toBeTruthy();
      expect(meta.label).toBeTruthy();
      expect(meta.previewSvg.startsWith("<svg")).toBe(true);
    }
  });
});

describe("buildCoverObjects: 5종 모두", () => {
  const ids = Object.keys(COVER_TEMPLATES) as CoverTemplateId[];

  it.each(ids)("%s 템플릿이 객체를 만들고 표지 영역 안에 있다", (id) => {
    const objs = buildCoverObjects({
      templateId: id,
      dims: DIMS,
      title: "테스트",
      photoId: "p-1",
    });
    expect(objs.length).toBeGreaterThan(0);

    // 모든 객체가 [0, totalWidthMm] x [0, totalHeightMm] 안에 있는지
    for (const o of objs) {
      // text 회전된 책등 박스 등은 회전 박스 자체의 leftMm/topMm 만 검증
      expect(o.leftMm).toBeGreaterThanOrEqual(-0.001);
      expect(o.topMm).toBeGreaterThanOrEqual(-0.001);
      expect(o.leftMm + o.widthMm).toBeLessThanOrEqual(
        DIMS.totalWidthMm + 0.5, // 일부 라운딩 허용
      );
      expect(o.topMm + o.heightMm).toBeLessThanOrEqual(
        DIMS.totalHeightMm + 0.5,
      );
    }
  });

  it.each(ids)("%s photoId 미지정 시 placeholderSlot 으로 대체", (id) => {
    const objs = buildCoverObjects({
      templateId: id,
      dims: DIMS,
      title: "테스트",
    });
    const photos = objs.filter((o) => o.type === "photo");
    expect(photos.length).toBe(0);
    const placeholders = objs.filter(
      (o) => o.type === "rect" && o.placeholderSlot === true,
    );
    expect(placeholders.length).toBeGreaterThanOrEqual(1);
  });
});

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

  it.each(ids)(
    "%s 책등 두께 9mm(>=8mm) → rotation:90 책등 텍스트 1개 포함",
    (id) => {
      const objs = buildCoverObjects({
        templateId: id,
        dims: DIMS,
        title: "스파인 테스트",
        photoId: "p-1",
      });
      const spineTexts = objs.filter(
        (o) => o.type === "text" && o.rotation === 90,
      );
      expect(spineTexts.length).toBe(1);
      const t = spineTexts[0];
      if (t && t.type === "text") {
        expect(t.placeholder).toBe("스파인 테스트");
      }
    },
  );

  it.each(ids)(
    "%s 책등 두께 < 8mm → 책등 텍스트 미포함",
    (id) => {
      const narrowDims = calcCoverDimensions({
        bookSize: BOOK_SIZE,
        pageCount: 50, // 50 × 0.09 = 4.5mm < 8mm
      });
      const objs = buildCoverObjects({
        templateId: id,
        dims: narrowDims,
        title: "얇은 책",
        photoId: "p-1",
      });
      const spineTexts = objs.filter(
        (o) => o.type === "text" && o.rotation === 90,
      );
      expect(spineTexts.length).toBe(0);
    },
  );
});

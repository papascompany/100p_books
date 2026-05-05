import { describe, expect, it } from "vitest";

import type { BookSize } from "@/lib/db/types";
import {
  buildDefaultCoverDoc,
  calcCoverDimensions,
  SPINE_TEXT_MIN_MM,
} from "./cover";
import { PAGEDOC_VERSION } from "./types";

const A5: BookSize = {
  id: "bs-a5",
  name: "A5",
  width_mm: 148,
  height_mm: 210,
  cover_width_mm: 150,
  cover_height_mm: 212,
  spine_formula_per_page: 0.09,
  active: true,
  display_order: 1,
  created_at: "2026-01-01T00:00:00Z",
};

const SQUARE_145: BookSize = {
  ...A5,
  id: "bs-s145",
  name: "14.5²",
  width_mm: 145,
  height_mm: 145,
  cover_width_mm: 147,
  cover_height_mm: 147,
};

const SQUARE_200: BookSize = {
  ...A5,
  id: "bs-s200",
  name: "20²",
  width_mm: 200,
  height_mm: 200,
  cover_width_mm: 202,
  cover_height_mm: 202,
};

describe("calcCoverDimensions", () => {
  it("A5 100p: spine = 100 × 0.09 = 9mm", () => {
    const d = calcCoverDimensions({ bookSize: A5, pageCount: 100 });
    expect(d.spineMm).toBeCloseTo(9, 5);
    expect(d.bookWidthMm).toBe(150);
    expect(d.bookHeightMm).toBe(212);
    expect(d.totalWidthMm).toBeCloseTo(150 * 2 + 9, 5);
    expect(d.totalHeightMm).toBe(212);
  });

  it("14.5² 50p: spine = 4.5mm", () => {
    const d = calcCoverDimensions({ bookSize: SQUARE_145, pageCount: 50 });
    expect(d.spineMm).toBeCloseTo(4.5, 5);
    expect(d.totalWidthMm).toBeCloseTo(147 * 2 + 4.5, 5);
  });

  it("20² 1p: spine = 0.09mm (양수, 매우 얇음)", () => {
    const d = calcCoverDimensions({ bookSize: SQUARE_200, pageCount: 1 });
    expect(d.spineMm).toBeCloseTo(0.09, 5);
    expect(d.totalWidthMm).toBeCloseTo(202 * 2 + 0.09, 5);
  });

  it("0p 도 음수 없이 0 반환", () => {
    const d = calcCoverDimensions({ bookSize: A5, pageCount: 0 });
    expect(d.spineMm).toBe(0);
    expect(d.totalWidthMm).toBe(150 * 2);
  });

  it("커스텀 spine_formula 반영", () => {
    const custom = { ...A5, spine_formula_per_page: 0.05 };
    const d = calcCoverDimensions({ bookSize: custom, pageCount: 100 });
    expect(d.spineMm).toBeCloseTo(5, 5);
  });
});

describe("buildDefaultCoverDoc", () => {
  it("layoutMode='cover' + 차원 일치", () => {
    const doc = buildDefaultCoverDoc({
      bookSize: A5,
      pageCount: 100,
      title: "테스트 책",
    });
    expect(doc.version).toBe(PAGEDOC_VERSION);
    expect(doc.layoutMode).toBe("cover");
    expect(doc.bookSizeId).toBe(A5.id);
    expect(doc.pageNo).toBe(0);
    expect(doc.bleedMm).toBe(2);
    const dims = calcCoverDimensions({ bookSize: A5, pageCount: 100 });
    expect(doc.widthMm).toBeCloseTo(dims.totalWidthMm, 5);
    expect(doc.heightMm).toBe(dims.totalHeightMm);
  });

  it("기본 템플릿(cover-minimal) 객체 생성", () => {
    const doc = buildDefaultCoverDoc({
      bookSize: A5,
      pageCount: 100,
      title: "기본",
    });
    expect(doc.objects.length).toBeGreaterThan(0);
    // 책등 두께 9mm > SPINE_TEXT_MIN_MM(8mm) → 책등 텍스트 포함
    const spineTexts = doc.objects.filter(
      (o) =>
        o.type === "text" &&
        o.fontSizePt === 9 &&
        o.placeholder &&
        o.placeholder.length > 0,
    );
    expect(spineTexts.length).toBeGreaterThanOrEqual(1);
    // 9mm > 8mm threshold sanity
    expect(SPINE_TEXT_MIN_MM).toBeLessThanOrEqual(9);
  });

  it("얇은 책등(<8mm)은 책등 텍스트 미포함", () => {
    // 50p × 0.09 = 4.5mm < 8 → 미포함
    const doc = buildDefaultCoverDoc({
      bookSize: SQUARE_145,
      pageCount: 50,
      title: "얇은 책",
    });
    // 9pt 폰트가 책등 텍스트 — minimal 템플릿엔 다른 9pt 가 없으므로 0이어야 함
    const spineTextLike = doc.objects.filter(
      (o) => o.type === "text" && o.fontSizePt === 9,
    );
    expect(spineTextLike.length).toBe(0);
  });

  it("photoId 지정 시 photo 객체 1개 이상", () => {
    const doc = buildDefaultCoverDoc({
      bookSize: A5,
      pageCount: 100,
      title: "사진 표지",
      photoId: "photo-1",
    });
    const photos = doc.objects.filter((o) => o.type === "photo");
    expect(photos.length).toBeGreaterThanOrEqual(1);
    const first = photos[0];
    if (first && first.type === "photo") {
      expect(first.photoId).toBe("photo-1");
    }
  });

  it("알 수 없는 templateId 는 throw", () => {
    expect(() =>
      buildDefaultCoverDoc({
        bookSize: A5,
        pageCount: 100,
        title: "x",
        // @ts-expect-error 의도적 잘못된 값
        templateId: "cover-nonexistent",
      }),
    ).toThrow();
  });
});

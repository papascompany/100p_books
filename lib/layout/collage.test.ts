import { describe, expect, it } from "vitest";

import type { BookSize, Photo } from "@/lib/db/types";
import {
  buildCollagePage,
  COLLAGE_TEMPLATES,
  slotCountOf,
  type CollageTemplateId,
} from "./collage";
import { generatePages } from "./generate";

const A5: BookSize = {
  id: "bs-a5",
  name: "A5",
  width_mm: 148,
  height_mm: 210,
  cover_width_mm: 300,
  cover_height_mm: 210,
  spine_formula_per_page: 0.05,
  active: true,
  display_order: 1,
  created_at: "2026-01-01T00:00:00Z",
};

function mkPhoto(id: string, order = 0, filename = `${id}.jpg`): Photo {
  return {
    id,
    project_id: "proj",
    storage_key: filename,
    thumb_key: null,
    filename,
    mime: "image/jpeg",
    size_bytes: 0,
    width: null,
    height: null,
    exif_taken_at: null,
    exif_camera: null,
    order_idx: order,
    created_at: "2026-01-01T00:00:00Z",
    deleted_at: null,
  };
}

describe("buildCollagePage", () => {
  it("모든 템플릿은 슬롯 수와 일치하는 photo 객체(사진 충분 시) + 캡션 1개를 가진다", () => {
    const ids = Object.keys(COLLAGE_TEMPLATES) as CollageTemplateId[];
    for (const id of ids) {
      const count = slotCountOf(id);
      const photos = Array.from({ length: count }, (_, i) => mkPhoto(String(i)));
      const doc = buildCollagePage({
        bookSize: A5,
        pageNo: 1,
        template: id,
        photos,
      });
      const photoObjs = doc.objects.filter((o) => o.type === "photo");
      const textObjs = doc.objects.filter((o) => o.type === "text");
      expect(photoObjs.length).toBe(count);
      expect(textObjs.length).toBe(1);
    }
  });

  it("사진 부족 시 부족한 슬롯은 placeholderSlot rect 로 채운다", () => {
    const photos = [mkPhoto("a"), mkPhoto("b")]; // 2장만
    const doc = buildCollagePage({
      bookSize: A5,
      pageNo: 1,
      template: "collage-4",
      photos,
    });
    const photoObjs = doc.objects.filter((o) => o.type === "photo");
    const placeholderRects = doc.objects.filter(
      (o) => o.type === "rect" && (o as { placeholderSlot?: boolean }).placeholderSlot,
    );
    expect(photoObjs.length).toBe(2);
    expect(placeholderRects.length).toBe(2);
  });

  it("페이지 번호와 책 사이즈가 반영된다", () => {
    const doc = buildCollagePage({
      bookSize: A5,
      pageNo: 5,
      template: "collage-2v",
      photos: [mkPhoto("a"), mkPhoto("b")],
    });
    expect(doc.pageNo).toBe(5);
    expect(doc.widthMm).toBe(A5.width_mm);
    expect(doc.heightMm).toBe(A5.height_mm);
    expect(doc.layoutMode).toBe("collage");
  });

  it("모든 슬롯 오브젝트가 trim 안에 있다", () => {
    const photos = Array.from({ length: 6 }, (_, i) => mkPhoto(String(i)));
    const doc = buildCollagePage({
      bookSize: A5,
      pageNo: 1,
      template: "collage-6",
      photos,
    });
    for (const obj of doc.objects) {
      expect(obj.leftMm).toBeGreaterThanOrEqual(0);
      expect(obj.topMm).toBeGreaterThanOrEqual(0);
      expect(obj.leftMm + obj.widthMm).toBeLessThanOrEqual(A5.width_mm + 0.001);
      expect(obj.topMm + obj.heightMm).toBeLessThanOrEqual(A5.height_mm + 0.001);
    }
  });
});

describe("generatePages", () => {
  it("폴라로이드: 사진 수 = 페이지 수", () => {
    const photos = Array.from({ length: 25 }, (_, i) =>
      mkPhoto(String(i), i, `img_${i}.jpg`),
    );
    const pages = generatePages({
      bookSize: A5,
      photos,
      sortMode: "upload",
      layoutMode: "polaroid",
    });
    expect(pages.length).toBe(25);
    expect(pages[0]!.pageNo).toBe(1);
    expect(pages.at(-1)!.pageNo).toBe(25);
  });

  it("콜라주: 슬롯 수로 chunk → 필요한 페이지 수 생성 (마지막 부족분 포함)", () => {
    const photos = Array.from({ length: 10 }, (_, i) => mkPhoto(String(i), i));
    const pages = generatePages({
      bookSize: A5,
      photos,
      sortMode: "upload",
      layoutMode: "collage",
      templateId: "collage-4", // slotCount 4 → ceil(10/4) = 3
    });
    expect(pages.length).toBe(3);
    expect(pages[0]!.pageNo).toBe(1);
    expect(pages[2]!.pageNo).toBe(3);
    // 마지막 페이지: 사진 2장 + 자리표시자 2개
    const lastPhotos = pages[2]!.objects.filter((o) => o.type === "photo");
    expect(lastPhotos.length).toBe(2);
  });

  it("성능: 100장 폴라로이드 생성 < 500ms (서버)", () => {
    const photos = Array.from({ length: 100 }, (_, i) =>
      mkPhoto(String(i), i, `p_${i}.jpg`),
    );
    const t0 = Date.now();
    const pages = generatePages({
      bookSize: A5,
      photos,
      sortMode: "upload",
      layoutMode: "polaroid",
    });
    const elapsed = Date.now() - t0;
    expect(pages.length).toBe(100);
    expect(elapsed).toBeLessThan(500);
  });
});

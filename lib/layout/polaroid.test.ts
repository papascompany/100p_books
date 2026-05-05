import { describe, expect, it } from "vitest";

import type { BookSize, Photo } from "@/lib/db/types";
import { buildPolaroidPage, DEFAULT_CAPTION_PLACEHOLDER } from "./polaroid";
import { PAGEDOC_VERSION } from "./types";

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

const SQUARE_145: BookSize = { ...A5, id: "bs-s145", name: "14.5²", width_mm: 145, height_mm: 145 };
const SQUARE_200: BookSize = { ...A5, id: "bs-s200", name: "20²", width_mm: 200, height_mm: 200 };

const photo: Photo = {
  id: "photo-1",
  project_id: "proj",
  storage_key: "s.jpg",
  thumb_key: null,
  filename: "s.jpg",
  mime: "image/jpeg",
  size_bytes: 0,
  width: 1000,
  height: 1000,
  exif_taken_at: null,
  exif_camera: null,
  order_idx: 0,
  created_at: "2026-01-01T00:00:00Z",
};

describe("buildPolaroidPage", () => {
  it("버전·책사이즈·페이지번호를 정확히 반영", () => {
    const doc = buildPolaroidPage({ bookSize: A5, pageNo: 7, photo });
    expect(doc.version).toBe(PAGEDOC_VERSION);
    expect(doc.bookSizeId).toBe(A5.id);
    expect(doc.pageNo).toBe(7);
    expect(doc.widthMm).toBe(A5.width_mm);
    expect(doc.heightMm).toBe(A5.height_mm);
    expect(doc.bleedMm).toBe(2);
    expect(doc.layoutMode).toBe("polaroid");
  });

  it("카드·사진·캡션 세 객체를 포함하고 photoId 매핑이 맞다", () => {
    const doc = buildPolaroidPage({ bookSize: A5, pageNo: 1, photo });
    const types = doc.objects.map((o) => o.type).sort();
    expect(types).toEqual(["photo", "rect", "text"]);

    const photoObj = doc.objects.find((o) => o.type === "photo")!;
    expect(photoObj.type === "photo" && photoObj.photoId).toBe(photo.id);
  });

  it("사진 객체가 trim 영역 안에 있다", () => {
    for (const size of [A5, SQUARE_145, SQUARE_200]) {
      const doc = buildPolaroidPage({ bookSize: size, pageNo: 1, photo });
      const p = doc.objects.find((o) => o.type === "photo")!;
      if (p.type !== "photo") throw new Error("unreachable");
      expect(p.leftMm).toBeGreaterThanOrEqual(0);
      expect(p.topMm).toBeGreaterThanOrEqual(0);
      expect(p.leftMm + p.widthMm).toBeLessThanOrEqual(size.width_mm + 0.001);
      expect(p.topMm + p.heightMm).toBeLessThanOrEqual(size.height_mm + 0.001);
      // 정사각 비례
      expect(Math.abs(p.widthMm - p.heightMm)).toBeLessThan(0.001);
    }
  });

  it("캡션은 기본 placeholder 를 가진다", () => {
    const doc = buildPolaroidPage({ bookSize: A5, pageNo: 1, photo });
    const t = doc.objects.find((o) => o.type === "text");
    expect(t && t.type === "text" && t.placeholder).toBe(DEFAULT_CAPTION_PLACEHOLDER);
    expect(t && t.type === "text" && t.fontFamily).toBe("Pretendard");
    expect(t && t.type === "text" && t.fontSizePt).toBe(12);
  });

  it("커스텀 placeholder 반영", () => {
    const doc = buildPolaroidPage({
      bookSize: A5,
      pageNo: 1,
      photo,
      captionPlaceholder: "추억 한 줄",
    });
    const t = doc.objects.find((o) => o.type === "text");
    expect(t && t.type === "text" && t.placeholder).toBe("추억 한 줄");
  });
});

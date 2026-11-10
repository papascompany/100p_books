import { describe, expect, it } from "vitest";

import {
  collectPreviewPhotoIds,
  thumbWidthPx,
  toOrderPreviewPages,
  type OrderPreviewPageRow,
} from "./order-preview";
import { PAGEDOC_VERSION, type LayoutObject, type PageDoc } from "@/lib/layout/types";

function photo(objectId: string, photoId: string): LayoutObject {
  return {
    type: "photo",
    objectId,
    photoId,
    leftMm: 0,
    topMm: 0,
    widthMm: 10,
    heightMm: 10,
    rotation: 0,
    cropMode: "cover",
  };
}

function doc(pageNo: number, objects: LayoutObject[] = []): PageDoc {
  return {
    version: PAGEDOC_VERSION,
    bookSizeId: "a5",
    pageNo,
    layoutMode: "polaroid",
    widthMm: 152,
    heightMm: 216,
    bleedMm: 2,
    backgroundColor: "#ffffff",
    objects,
  };
}

describe("toOrderPreviewPages", () => {
  it("PageDoc 가드를 통과한 행만 page_no 오름차순으로 돌려준다", () => {
    const rows: OrderPreviewPageRow[] = [
      { id: "p3", page_no: 3, fabric_json: doc(3) },
      { id: "p1", page_no: 1, fabric_json: doc(1) },
      { id: "bad", page_no: 2, fabric_json: { version: "0", objects: [] } },
      { id: "null", page_no: 4, fabric_json: null },
    ];
    const out = toOrderPreviewPages(rows);
    expect(out.map((p) => p.id)).toEqual(["p1", "p3"]);
    expect(out[0]?.doc.pageNo).toBe(1);
  });

  it("빈 입력은 빈 배열", () => {
    expect(toOrderPreviewPages([])).toEqual([]);
  });
});

describe("collectPreviewPhotoIds", () => {
  it("사진 객체의 photoId 만 중복 없이 첫 등장 순으로 모은다", () => {
    const pages = toOrderPreviewPages([
      {
        id: "p1",
        page_no: 1,
        fabric_json: doc(1, [
          photo("o1", "ph-a"),
          {
            type: "rect",
            objectId: "r1",
            leftMm: 0,
            topMm: 0,
            widthMm: 5,
            heightMm: 5,
            fill: "#000",
          },
          photo("o2", "ph-b"),
        ]),
      },
      { id: "p2", page_no: 2, fabric_json: doc(2, [photo("o3", "ph-a"), photo("o4", "ph-c")]) },
    ]);
    expect(collectPreviewPhotoIds(pages)).toEqual(["ph-a", "ph-b", "ph-c"]);
  });
});

describe("thumbWidthPx", () => {
  it("고정 높이에서 문서 비율을 유지한 정수 폭", () => {
    // 156 × 220 (bleed 포함 A5 근사) → 104px 높이에서 74px
    expect(thumbWidthPx(156, 220, 104)).toBe(74);
    // 펼친 표지처럼 가로가 긴 문서
    expect(thumbWidthPx(320, 220, 104)).toBe(151);
  });

  it("비정상 치수는 정사각형으로 폴백", () => {
    expect(thumbWidthPx(0, 220, 104)).toBe(104);
    expect(thumbWidthPx(156, 0, 104)).toBe(104);
    expect(thumbWidthPx(Number.NaN, 220, 104)).toBe(104);
    expect(thumbWidthPx(-5, 220, 104)).toBe(104);
  });
});

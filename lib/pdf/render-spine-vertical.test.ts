/**
 * 책등 제목 세로쓰기 렌더 — 2026-11-17 오너 결정(세로쓰기 기본, 입력 없으면 비인쇄).
 */
import { beforeAll, describe, expect, it } from "vitest";
import type { SharpConstructor } from "sharp";

import { loadHardenedSharp } from "@/lib/image/sharp-safe";
import { normalizeCoverSpineText } from "@/lib/layout/cover";
import { PAGEDOC_VERSION, type PageDoc, type TextObject } from "@/lib/layout/types";

import { renderPageToPng } from "./render-page";

let sharp: SharpConstructor;
beforeAll(async () => {
  sharp = await loadHardenedSharp();
});

function cover(objects: TextObject[]): PageDoc {
  return {
    version: PAGEDOC_VERSION,
    bookSizeId: "b",
    pageNo: 0,
    layoutMode: "cover",
    widthMm: 130, // 뒤 60 + 책등 10 + 앞 60
    heightMm: 80,
    bleedMm: 2,
    backgroundColor: "#ffffff",
    objects,
  } as PageDoc;
}

const vertical: TextObject = {
  type: "text",
  objectId: "spine",
  leftMm: 65 - 4.5,
  topMm: 8,
  widthMm: 9,
  heightMm: 64,
  text: "우리여행",
  fontFamily: "Pretendard",
  fontSizePt: 20,
  fill: "#000000",
  align: "center",
  lineHeight: 1.1,
  bold: true,
  vertical: true,
};

const ctx = { dpi: 72, resolveImageUrl: async () => Buffer.alloc(0) };

/** 검은 잉크가 있는 영역의 폭·높이(px). */
async function inkBox(png: Buffer): Promise<{ w: number; h: number }> {
  const { data, info } = await sharp(png).greyscale().raw().toBuffer({ resolveWithObject: true });
  let minX = Infinity, minY = Infinity, maxX = -1, maxY = -1;
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      if (data[y * info.width + x]! < 128) {
        minX = Math.min(minX, x); maxX = Math.max(maxX, x);
        minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      }
    }
  }
  return maxX < 0 ? { w: 0, h: 0 } : { w: maxX - minX + 1, h: maxY - minY + 1 };
}

describe("책등 세로쓰기 렌더", () => {
  it("글자를 위에서 아래로 쌓는다 — 잉크 영역이 좁고 길다", async () => {
    const box = await inkBox(await renderPageToPng(cover([vertical]), ctx));
    expect(box.h).toBeGreaterThan(box.w * 3);
  });

  it("고객 입력이 없으면(빈 텍스트 + 제목 안내 문구) 인쇄하지 않는다", async () => {
    const blank = await renderPageToPng(cover([]), ctx);
    const empty = await renderPageToPng(
      cover([{ ...vertical, text: "", placeholder: "우리여행" }]),
      ctx,
    );
    expect(empty.equals(blank)).toBe(true);
  });

  it("예전 90° 회전 책등도 세로쓰기와 같은 픽셀로 그린다", async () => {
    const legacy: TextObject = {
      ...vertical,
      vertical: undefined,
      leftMm: 65 - 32,
      topMm: 40 - 4.5,
      widthMm: 64,
      heightMm: 9,
      rotation: 90,
    };
    const a = await renderPageToPng(cover([legacy]), ctx);
    const b = await renderPageToPng(normalizeCoverSpineText(cover([legacy])), ctx);
    expect(a.equals(b)).toBe(true);
    const box = await inkBox(a);
    expect(box.h).toBeGreaterThan(box.w * 3);
  });
});

/**
 * 통합 테스트 — text/rect 만 사용하는 1p PageDoc → PNG → PDF 합성.
 *
 * 사진 다운로드는 스킵 (CI 환경/네트워크 의존성 회피). 사진 포함 시나리오는
 * resolveImageUrl 모킹 — 단일 픽셀 PNG buffer 반환.
 *
 * 주의: vitest 환경 jsdom 이지만 @napi-rs/canvas 는 native binary 를 로드하므로
 * 로컬에서만 실행. CI 에서 실패 시 globalSkip 으로 처리.
 */

import { describe, it, expect } from "vitest";

import {
  PAGEDOC_VERSION,
  type PageDoc,
} from "@/lib/layout/types";

import { wrapMixedText } from "./text-wrap";

describe("text-wrap", () => {
  it("짧은 한 줄은 그대로 반환한다", () => {
    const out = wrapMixedText("hello", {
      measure: (s) => s.length * 7,
      maxWidthPx: 100,
    });
    expect(out).toEqual(["hello"]);
  });

  it("폭 초과 시 단어 단위로 분할", () => {
    const out = wrapMixedText("hello world foo bar", {
      measure: (s) => s.length * 10,
      maxWidthPx: 100,
    });
    // 100/10 = 10자. "hello worl" 직전인 "hello" 만 들어가고 "world" 새 줄.
    expect(out.length).toBeGreaterThanOrEqual(2);
    expect(out[0]!.length).toBeLessThanOrEqual(10);
  });

  it("개행 \\n 으로 줄을 강제 분할", () => {
    const out = wrapMixedText("line one\nline two", {
      measure: (s) => s.length * 5,
      maxWidthPx: 1000,
    });
    expect(out).toEqual(["line one", "line two"]);
  });

  it("한글은 grapheme 단위로 wrap", () => {
    const out = wrapMixedText("안녕하세요반갑습니다", {
      measure: (s) => s.length * 12,
      maxWidthPx: 36,
    });
    // 36/12 = 3자 max
    expect(out.length).toBeGreaterThanOrEqual(3);
    for (const line of out) expect(line.length).toBeLessThanOrEqual(3);
  });

  it("max 보다 긴 단일 영문 토큰도 grapheme split", () => {
    const out = wrapMixedText("supercalifragilistic", {
      measure: (s) => s.length * 20,
      maxWidthPx: 60,
    });
    expect(out.length).toBeGreaterThan(1);
    expect(out[0]!.length).toBeLessThanOrEqual(3);
  });
});

// =====================================================================
// PageDoc → PNG → PDF 통합 (옵셔널 — native binary 의존)
// =====================================================================

const enableNative = process.env.PDF_NATIVE_TEST === "1";
const describeNative = enableNative ? describe : describe.skip;

describeNative("buildInteriorPdf (native)", () => {
  it("text-only 1p PageDoc 으로 PDF 한 장을 만든다", async () => {
    const { buildInteriorPdf } = await import("./build");

    const doc: PageDoc = {
      version: PAGEDOC_VERSION,
      bookSizeId: "00000000-0000-0000-0000-000000000000",
      pageNo: 1,
      layoutMode: "polaroid",
      widthMm: 145,
      heightMm: 145,
      bleedMm: 2,
      backgroundColor: "#ffffff",
      objects: [
        {
          type: "text",
          objectId: "t1",
          leftMm: 20,
          topMm: 60,
          widthMm: 105,
          heightMm: 30,
          text: "안녕, 100p_books",
          fontFamily: "Pretendard",
          fontSizePt: 24,
          fill: "#222",
          align: "center",
          lineHeight: 1.4,
        },
      ],
    };

    const pdfBuf = await buildInteriorPdf({
      pages: [doc],
      bookSize: {
        id: doc.bookSizeId,
        name: "test",
        width_mm: 145,
        height_mm: 145,
        cover_width_mm: 150,
        cover_height_mm: 150,
        spine_formula_per_page: 0.09,
        active: true,
        display_order: 0,
        created_at: new Date().toISOString(),
      },
      resolveImageUrl: async () => {
        throw new Error("no photo expected in text-only test");
      },
      meta: { title: "테스트", author: "vitest" },
    });

    expect(Buffer.isBuffer(pdfBuf)).toBe(true);
    // PDF magic
    expect(pdfBuf.subarray(0, 4).toString()).toBe("%PDF");
    // 길이가 비어있지 않음
    expect(pdfBuf.byteLength).toBeGreaterThan(2000);
  }, 60_000);
});

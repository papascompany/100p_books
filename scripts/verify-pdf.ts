/**
 * PDF 파이프라인 런타임 검증 스크립트.
 *
 *   pnpm exec tsx scripts/verify-pdf.ts
 *
 * 목적:
 *   - vitest jsdom 환경에서 @napi-rs/canvas 가 NaN 을 반환하는 환경 의존 버그가
 *     있으므로 (build.test.ts 의 native 케이스는 환경 제약), 실제 Node 런타임에서
 *     PDF 가 한 장 정상 생성되는지 증명한다.
 *
 *   - 사진/배경/클립아트는 외부 의존이라 검증에서 제외 (resolveImageUrl 에서 throw).
 *     text + rect 객체만으로 1페이지 PDF 가 만들어지는지 확인.
 *
 * 산출:
 *   - tmp/verify-pdf-out.pdf 로 저장.
 *   - stdout 에 페이지 수 / 바이트 수 / PDF 매직 체크 결과 출력.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

import { PAGEDOC_VERSION, type PageDoc } from "@/lib/layout/types";
import { buildInteriorPdf } from "@/lib/pdf/build";

// 32×32 단색(연한 회색) PNG — photo 객체 검증용 더미. base64 디코드 후 Buffer 반환.
// 실제 사진 다운로드 의존성 없이 borderRadius + shadow 패스를 검증한다.
const DUMMY_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAJklEQVR4nO3OMQEAAAjDMMC/56" +
  "EBznSgvW0lQghtEELYIYSwQwhhh17/AmHsErl/AAAAAElFTkSuQmCC";
const DUMMY_PNG = Buffer.from(DUMMY_PNG_BASE64, "base64");

// Page 1 — text + rect (회귀 확인용 — 기존 케이스 그대로)
const textOnlyDoc: PageDoc = {
  version: PAGEDOC_VERSION,
  bookSizeId: "00000000-0000-0000-0000-000000000000",
  pageNo: 1,
  layoutMode: "polaroid",
  widthMm: 145,
  heightMm: 145,
  bleedMm: 2,
  backgroundColor: "#fafafa",
  objects: [
    {
      type: "rect",
      objectId: "r1",
      leftMm: 10,
      topMm: 10,
      widthMm: 125,
      heightMm: 125,
      fill: "#ffffff",
      borderRadiusMm: 2,
    },
    {
      type: "text",
      objectId: "t1",
      leftMm: 20,
      topMm: 50,
      widthMm: 105,
      heightMm: 20,
      text: "100p Books PDF 검증",
      fontFamily: "Pretendard",
      fontSizePt: 20,
      fill: "#111111",
      align: "center",
      lineHeight: 1.4,
    },
    {
      type: "text",
      objectId: "t2",
      leftMm: 20,
      topMm: 80,
      widthMm: 105,
      heightMm: 30,
      text: "Hello, World!\n안녕, 세계.",
      fontFamily: "Pretendard",
      fontSizePt: 14,
      fill: "#444444",
      align: "center",
      lineHeight: 1.6,
    },
  ],
};

// Page 2 — photo + borderRadius + shadow.
//   render-page.ts 의 shadow/clip 2-pass 패스 검증용.
//   shadow 가 borderRadius 모서리 바깥까지 정상 출력되어야 한다.
const photoShadowDoc: PageDoc = {
  version: PAGEDOC_VERSION,
  bookSizeId: "00000000-0000-0000-0000-000000000000",
  pageNo: 2,
  layoutMode: "polaroid",
  widthMm: 145,
  heightMm: 145,
  bleedMm: 2,
  backgroundColor: "#fafafa",
  objects: [
    {
      type: "photo",
      objectId: "p1",
      photoId: "dummy-photo-1",
      leftMm: 30,
      topMm: 30,
      widthMm: 85,
      heightMm: 85,
      rotation: 0,
      cropMode: "cover",
      borderRadiusMm: 8,
      shadow: {
        blurMm: 3,
        offsetYMm: 1.5,
        color: "rgba(0,0,0,0.35)",
      },
    },
    {
      type: "text",
      objectId: "t3",
      leftMm: 20,
      topMm: 125,
      widthMm: 105,
      heightMm: 12,
      text: "shadow + borderRadius",
      fontFamily: "Pretendard",
      fontSizePt: 10,
      fill: "#666",
      align: "center",
      lineHeight: 1.4,
    },
  ],
};

async function main() {
  const t0 = Date.now();
  const pdfBuf = await buildInteriorPdf({
    pages: [textOnlyDoc, photoShadowDoc],
    bookSize: {
      id: textOnlyDoc.bookSizeId,
      name: "verify-145sq",
      width_mm: 145,
      height_mm: 145,
      cover_width_mm: 150,
      cover_height_mm: 150,
      spine_formula_per_page: 0.09,
      active: true,
      display_order: 0,
      created_at: new Date().toISOString(),
    },
    resolveImageUrl: async (photoId: string) => {
      if (photoId === "dummy-photo-1") return DUMMY_PNG;
      throw new Error(`unexpected photoId in verify: ${photoId}`);
    },
    meta: { title: "100p_books 검증", author: "scripts/verify-pdf.ts" },
  });
  const elapsed = Date.now() - t0;

  const magic = pdfBuf.subarray(0, 4).toString();
  if (magic !== "%PDF") {
    throw new Error(`PDF 매직 헤더 불일치: ${magic}`);
  }
  if (pdfBuf.byteLength < 2000) {
    throw new Error(`PDF 크기 비정상: ${pdfBuf.byteLength} bytes`);
  }

  mkdirSync(resolve(process.cwd(), "tmp"), { recursive: true });
  const outPath = resolve(process.cwd(), "tmp", "verify-pdf-out.pdf");
  writeFileSync(outPath, pdfBuf);

  console.log("[verify-pdf] OK");
  console.log("  pages:        2 (text+rect / photo+borderRadius+shadow)");
  console.log("  magic:        %PDF");
  console.log("  bytes:       ", pdfBuf.byteLength.toLocaleString());
  console.log("  elapsed_ms:  ", elapsed);
  console.log("  output:      ", outPath);
}

main().catch((err) => {
  console.error("[verify-pdf] FAIL:", err);
  process.exit(1);
});

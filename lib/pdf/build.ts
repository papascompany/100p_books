import "server-only";

import fontkit from "@pdf-lib/fontkit";
import { PDFDocument } from "pdf-lib";

import type { BookSize } from "@/lib/db/types";
import { calcCoverDimensions } from "@/lib/layout/cover";
import type { PageDoc } from "@/lib/layout/types";

import { mmToPt, RENDER_CONCURRENCY } from "./constants";
import { drawCropMarks } from "./crop-mark";
import { renderPageToPng, type RenderContext } from "./render-page";

export interface BuildProgress {
  /** 완료된 페이지 수. */
  done: number;
  /** 전체 페이지 수. */
  total: number;
  /** 단계 — "render" (PNG) or "compose" (PDF 합성). */
  phase: "render" | "compose";
}

export interface BuildArgsBase {
  resolveImageUrl: RenderContext["resolveImageUrl"];
  resolveBackgroundUrl?: RenderContext["resolveBackgroundUrl"];
  onProgress?: (p: BuildProgress) => void;
  /** PDF 메타데이터. */
  meta?: { title?: string; author?: string };
}

export interface BuildInteriorArgs extends BuildArgsBase {
  /** page_no 오름차순 정렬된 PageDoc 배열. */
  pages: PageDoc[];
  bookSize: BookSize;
}

export interface BuildCoverArgs extends BuildArgsBase {
  coverDoc: PageDoc;
  bookSize: BookSize;
  /** 책등 두께 검증/마크용 — interior pageCount. */
  pageCount: number;
}

/**
 * 내지 PDF — 페이지별 PNG → pdf-lib embed → addPage.
 */
export async function buildInteriorPdf(args: BuildInteriorArgs): Promise<Buffer> {
  const total = args.pages.length;
  const renderCtx: RenderContext = {
    resolveImageUrl: args.resolveImageUrl,
    resolveBackgroundUrl: args.resolveBackgroundUrl,
  };

  // 병렬 PNG 렌더 — 동시성 RENDER_CONCURRENCY
  const pngs: Buffer[] = new Array(total);
  let doneCount = 0;
  await runWithConcurrency(args.pages, RENDER_CONCURRENCY, async (doc, idx) => {
    pngs[idx] = await renderPageToPng(doc, renderCtx);
    doneCount += 1;
    args.onProgress?.({ done: doneCount, total, phase: "render" });
  });

  // pdf-lib 합성
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  if (args.meta?.title) pdf.setTitle(args.meta.title);
  if (args.meta?.author) pdf.setAuthor(args.meta.author);
  pdf.setProducer("100p_books");
  pdf.setCreator("100p_books PDF pipeline");
  pdf.setCreationDate(new Date());

  for (let i = 0; i < total; i++) {
    const doc = args.pages[i]!;
    const pngBuf = pngs[i]!;
    const totalWmm = doc.widthMm + doc.bleedMm * 2;
    const totalHmm = doc.heightMm + doc.bleedMm * 2;
    const widthPt = mmToPt(totalWmm);
    const heightPt = mmToPt(totalHmm);

    const png = await pdf.embedPng(pngBuf);
    // 배열 자리 비워서 GC 유도
    (pngs as unknown as Array<Buffer | undefined>)[i] = undefined;

    const page = pdf.addPage([widthPt, heightPt]);
    page.drawImage(png, { x: 0, y: 0, width: widthPt, height: heightPt });
    drawCropMarks(page, { bleedMm: doc.bleedMm });
    args.onProgress?.({ done: i + 1, total, phase: "compose" });
  }

  const bytes = await pdf.save({ useObjectStreams: true });
  return Buffer.from(bytes);
}

/**
 * 표지 PDF — 단일 페이지(펼친 사이즈).
 *
 *   - 책등 두께 = pageCount × spine_formula_per_page → coverDoc.widthMm 와 매칭 검증.
 *   - mismatch 시 경고만 찍고 계속 진행 (coverDoc 가 정본).
 */
export async function buildCoverPdf(args: BuildCoverArgs): Promise<Buffer> {
  const dims = calcCoverDimensions({
    bookSize: args.bookSize,
    pageCount: args.pageCount,
  });
  if (Math.abs(dims.totalWidthMm - args.coverDoc.widthMm) > 0.5) {
    console.warn(
      `[pdf/build] cover width mismatch: doc=${args.coverDoc.widthMm}mm calc=${dims.totalWidthMm}mm (pageCount=${args.pageCount})`,
    );
  }

  args.onProgress?.({ done: 0, total: 1, phase: "render" });
  const png = await renderPageToPng(args.coverDoc, {
    resolveImageUrl: args.resolveImageUrl,
    resolveBackgroundUrl: args.resolveBackgroundUrl,
  });
  args.onProgress?.({ done: 1, total: 1, phase: "render" });

  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  if (args.meta?.title) pdf.setTitle(args.meta.title);
  if (args.meta?.author) pdf.setAuthor(args.meta.author);
  pdf.setProducer("100p_books");
  pdf.setCreator("100p_books PDF pipeline");
  pdf.setCreationDate(new Date());

  const totalWmm = args.coverDoc.widthMm + args.coverDoc.bleedMm * 2;
  const totalHmm = args.coverDoc.heightMm + args.coverDoc.bleedMm * 2;
  const widthPt = mmToPt(totalWmm);
  const heightPt = mmToPt(totalHmm);

  const embedded = await pdf.embedPng(png);
  const page = pdf.addPage([widthPt, heightPt]);
  page.drawImage(embedded, { x: 0, y: 0, width: widthPt, height: heightPt });

  // 책등 양쪽 경계의 mark x 좌표 (trim 좌측에서 mm)
  const spineXs = [dims.bookWidthMm, dims.bookWidthMm + dims.spineMm];
  drawCropMarks(page, {
    bleedMm: args.coverDoc.bleedMm,
    spineXsMm: spineXs,
  });

  args.onProgress?.({ done: 1, total: 1, phase: "compose" });

  const bytes = await pdf.save({ useObjectStreams: true });
  return Buffer.from(bytes);
}

// =====================================================================
// concurrency helper
// =====================================================================

async function runWithConcurrency<T>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<void>,
): Promise<void> {
  const queue = items.map((it, idx) => ({ it, idx }));
  const inFlight: Promise<void>[] = [];

  while (queue.length > 0) {
    while (inFlight.length < limit && queue.length > 0) {
      const job = queue.shift()!;
      const p = worker(job.it, job.idx).then(() => {
        const i = inFlight.indexOf(p);
        if (i >= 0) inFlight.splice(i, 1);
      });
      inFlight.push(p);
    }
    if (inFlight.length > 0) {
      await Promise.race(inFlight);
    }
  }
  await Promise.all(inFlight);
}

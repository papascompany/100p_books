import "server-only";

import fontkit from "@pdf-lib/fontkit";
import { PDFDocument } from "pdf-lib";

import type { BookSize } from "@/lib/db/types";
import { calcCoverDimensions } from "@/lib/layout/cover";
import type { PageDoc } from "@/lib/layout/types";

import { mmToPt, RENDER_CONCURRENCY } from "./constants";
import { drawCropMarks } from "./crop-mark";
import { renderPageToJpeg, type RenderContext } from "./render-page";

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
  resolveClipart?: RenderContext["resolveClipart"];
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
 * 내지 PDF — 페이지별 JPEG → pdf-lib embed → addPage (스트리밍 합성).
 *
 * 메모리 설계 (100p × 6~8MB 사진 실측 기반):
 *   - 이전: 전체 페이지 PNG(~580MB)를 배열에 모은 뒤 합성 → 피크 RSS 1.65GB
 *     (Vercel 1769MB 한도의 94%) + embedPng 무손실 임베드로 PDF 578MB.
 *   - 현재: 렌더 완료 즉시 page_no 순서를 보존하며 embedJpg → 버퍼 해제.
 *     동시에 들고 있는 페이지 이미지는 최대 RENDER_CONCURRENCY 개 안팎.
 *     JPEG(q90) 직접 임베드(DCTDecode, 재인코딩 없음)로 PDF ~1/5 크기.
 */
export async function buildInteriorPdf(args: BuildInteriorArgs): Promise<Buffer> {
  const total = args.pages.length;
  const renderCtx: RenderContext = {
    resolveImageUrl: args.resolveImageUrl,
    resolveBackgroundUrl: args.resolveBackgroundUrl,
    resolveClipart: args.resolveClipart,
  };

  // pdf-lib 문서를 먼저 만들고, 렌더가 끝난 페이지부터 순서대로 합성한다.
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  if (args.meta?.title) pdf.setTitle(args.meta.title);
  if (args.meta?.author) pdf.setAuthor(args.meta.author);
  pdf.setProducer("100p_books");
  pdf.setCreator("100p_books PDF pipeline");
  pdf.setCreationDate(new Date());

  // 완료된(아직 임베드 전) 페이지 JPEG — 순서 어긋난 페이지만 잠시 보관.
  const ready: Array<Buffer | undefined> = new Array(total);
  let nextEmbed = 0; // 다음에 임베드해야 할 페이지 index (addPage 순서 보장)
  let embedChain: Promise<void> = Promise.resolve();
  let embedError: unknown = null;

  // ready 에 쌓인 페이지를 index 순서대로 임베드. 호출이 겹쳐도 chain 으로 직렬화.
  const drainReady = (): Promise<void> => {
    embedChain = embedChain.then(async () => {
      if (embedError) return;
      try {
        while (nextEmbed < total && ready[nextEmbed]) {
          const i = nextEmbed;
          const jpegBuf = ready[i]!;
          ready[i] = undefined; // 즉시 해제 → GC
          const doc = args.pages[i]!;
          const totalWmm = doc.widthMm + doc.bleedMm * 2;
          const totalHmm = doc.heightMm + doc.bleedMm * 2;
          const widthPt = mmToPt(totalWmm);
          const heightPt = mmToPt(totalHmm);

          const jpg = await pdf.embedJpg(jpegBuf);
          const page = pdf.addPage([widthPt, heightPt]);
          page.drawImage(jpg, { x: 0, y: 0, width: widthPt, height: heightPt });
          drawCropMarks(page, { bleedMm: doc.bleedMm });
          nextEmbed += 1;
          args.onProgress?.({ done: nextEmbed, total, phase: "compose" });
        }
      } catch (e) {
        embedError = e;
      }
    });
    return embedChain;
  };

  // 병렬 렌더 — 동시성 RENDER_CONCURRENCY, 완료 즉시 drain.
  let doneCount = 0;
  await runWithConcurrency(args.pages, RENDER_CONCURRENCY, async (doc, idx) => {
    const jpeg = await renderPageToJpeg(doc, renderCtx);
    ready[idx] = jpeg;
    doneCount += 1;
    args.onProgress?.({ done: doneCount, total, phase: "render" });
    void drainReady();
  });

  // 잔여 페이지 임베드 완료 대기 + 에러 표면화
  await drainReady();
  if (embedError) throw embedError;

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
  const jpeg = await renderPageToJpeg(args.coverDoc, {
    resolveImageUrl: args.resolveImageUrl,
    resolveBackgroundUrl: args.resolveBackgroundUrl,
    resolveClipart: args.resolveClipart,
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

  const embedded = await pdf.embedJpg(jpeg);
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

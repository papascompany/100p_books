import { rgb, type PDFPage } from "pdf-lib";

import {
  BLEED_MM,
  CROP_MARK_LEN_MM,
  CROP_MARK_WIDTH_PT,
  mmToPt,
} from "./constants";

/**
 * PDF 페이지(전체 = trim + bleed) 의 4 모서리에 crop mark 를 그린다.
 *
 *   - 좌표계 원점: pdf-lib 는 좌하단 (0,0) → "위/아래" 가 화면 기준과 다름.
 *   - mark 는 trim 박스의 corner 에서 페이지 외곽으로 향하는 두 짧은 선.
 *   - bleed 영역(2mm) 을 침범하지 않도록 trim 코너에서 bleed 외곽 방향으로만 그린다.
 *
 * 인자:
 *   bleedMm — 페이지 가장자리까지의 여유. 기본 BLEED_MM(2mm).
 *   markLenMm — 한 선의 길이. 기본 CROP_MARK_LEN_MM(4mm).
 */
export function drawCropMarks(
  page: PDFPage,
  opts: {
    bleedMm?: number;
    markLenMm?: number;
    /** spine 위치(mm, 페이지 좌측에서) — 표지 PDF 에서 책등 양 끝에 추가 마크. */
    spineXsMm?: number[];
  } = {},
): void {
  const bleedMm = opts.bleedMm ?? BLEED_MM;
  const markLenMm = opts.markLenMm ?? CROP_MARK_LEN_MM;

  const widthPt = page.getWidth();
  const heightPt = page.getHeight();
  const bleedPt = mmToPt(bleedMm);
  const lenPt = mmToPt(markLenMm);

  // trim box (PDF 좌표: 좌하단 원점)
  const trimL = bleedPt;
  const trimR = widthPt - bleedPt;
  const trimB = bleedPt;
  const trimT = heightPt - bleedPt;

  const lineOpts = {
    thickness: CROP_MARK_WIDTH_PT,
    color: rgb(0, 0, 0),
  } as const;

  // 4 코너 — trim 코너에서 bleed 외곽으로 향하는 두 선 (수평 + 수직).
  // gap 0.5mm 를 두면 인쇄 시 trim 라인과 겹치지 않아 보기 좋지만
  // 우선 단순하게 trim 코너에 정확히 붙인다.

  // 좌상 (trimL, trimT)
  page.drawLine({
    start: { x: trimL - lenPt, y: trimT },
    end: { x: trimL, y: trimT },
    ...lineOpts,
  });
  page.drawLine({
    start: { x: trimL, y: trimT },
    end: { x: trimL, y: trimT + lenPt },
    ...lineOpts,
  });

  // 우상 (trimR, trimT)
  page.drawLine({
    start: { x: trimR, y: trimT },
    end: { x: trimR + lenPt, y: trimT },
    ...lineOpts,
  });
  page.drawLine({
    start: { x: trimR, y: trimT },
    end: { x: trimR, y: trimT + lenPt },
    ...lineOpts,
  });

  // 좌하 (trimL, trimB)
  page.drawLine({
    start: { x: trimL - lenPt, y: trimB },
    end: { x: trimL, y: trimB },
    ...lineOpts,
  });
  page.drawLine({
    start: { x: trimL, y: trimB - lenPt },
    end: { x: trimL, y: trimB },
    ...lineOpts,
  });

  // 우하 (trimR, trimB)
  page.drawLine({
    start: { x: trimR, y: trimB },
    end: { x: trimR + lenPt, y: trimB },
    ...lineOpts,
  });
  page.drawLine({
    start: { x: trimR, y: trimB - lenPt },
    end: { x: trimR, y: trimB },
    ...lineOpts,
  });

  // 책등 마크(표지) — 책등 양쪽 경계에 짧은 라인 (위/아래 외곽).
  if (opts.spineXsMm && opts.spineXsMm.length > 0) {
    for (const xMm of opts.spineXsMm) {
      const x = bleedPt + mmToPt(xMm);
      // 위쪽 외곽
      page.drawLine({
        start: { x, y: trimT },
        end: { x, y: trimT + lenPt },
        ...lineOpts,
      });
      // 아래쪽 외곽
      page.drawLine({
        start: { x, y: trimB - lenPt },
        end: { x, y: trimB },
        ...lineOpts,
      });
    }
  }
}

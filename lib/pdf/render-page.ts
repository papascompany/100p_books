import "server-only";

import {
  createCanvas,
  loadImage,
  type Canvas,
  type SKRSContext2D,
  type Image,
} from "@napi-rs/canvas";

type LoadedImage = Image;

import type {
  ClipartObject,
  LayoutObject,
  PageDoc,
  PhotoObject,
  RectObject,
  TextObject,
} from "@/lib/layout/types";

import { mmToPx, ptToPx, PAGE_JPEG_QUALITY, PRINT_DPI } from "./constants";
import { wrapMixedText } from "./text-wrap";

/**
 * PageDoc → 300dpi PNG 버퍼.
 *
 * 좌표계:
 *   - PageDoc 좌표는 trim 좌상단 원점 mm.
 *   - 캔버스는 (widthMm + 2*bleedMm) × (heightMm + 2*bleedMm) mm.
 *   - 따라서 객체 그리기 전에 ctx.translate(bleedPx, bleedPx) 로 trim 원점 정렬.
 *
 * 객체 회전:
 *   - PageDoc 의 rotation 은 객체 중심 기준 deg, 양수=시계방향.
 *   - 캔버스에서는 ctx.translate(centerX, centerY); ctx.rotate(rad) 로 처리.
 *
 * 사진 cropMode:
 *   - cover: 슬롯을 가득 채우도록 비율 유지 + 슬롯 박스로 클리핑.
 *   - contain: 슬롯 안에 비율 유지하여 들어가도록.
 */

export interface RenderContext {
  /** 출력 DPI. 기본 300. */
  dpi?: number;
  /** sub-pixel anti-alias 품질. true 면 imageSmoothingQuality="high". */
  highQuality?: boolean;
  /** photoId → 원본 buffer (jpeg/png/webp). */
  resolveImageUrl: (photoIdOrUrl: string) => Promise<Buffer>;
  /** 배경 이미지 URL/photoId 처리 (선택). */
  resolveBackgroundUrl?: (input: {
    photoId?: string;
    url?: string;
  }) => Promise<Buffer | null>;
  /** 클립아트(외부 리소스) 다운로드. resourceId 우선, 없으면 src URL. */
  resolveClipart?: (input: {
    resourceId?: string;
    src: string;
  }) => Promise<Buffer | null>;
}

export async function renderPageToPng(
  doc: PageDoc,
  ctx: RenderContext,
): Promise<Buffer> {
  const canvas = await renderPageToCanvas(doc, ctx);
  return canvas.toBuffer("image/png");
}

/**
 * PageDoc → 300dpi JPEG 버퍼 (인쇄 PDF 임베드용).
 *
 *   - 페이지는 항상 backgroundColor 로 전면 도색되므로 알파 손실 없음.
 *   - PNG(무손실) 대비 ~1/5 크기 — 100p 사진북 PDF 578MB → ~106MB (실측).
 *   - pdf-lib embedJpg 는 바이트를 그대로 DCTDecode 로 임베드 (재인코딩 없음).
 */
export async function renderPageToJpeg(
  doc: PageDoc,
  ctx: RenderContext,
  quality: number = PAGE_JPEG_QUALITY,
): Promise<Buffer> {
  const canvas = await renderPageToCanvas(doc, ctx);
  return canvas.toBuffer("image/jpeg", quality);
}

async function renderPageToCanvas(
  doc: PageDoc,
  ctx: RenderContext,
): Promise<Canvas> {
  const dpi = ctx.dpi ?? PRINT_DPI;
  const bleedMm = doc.bleedMm; // 항상 2 (PageDoc 규약)

  const totalWmm = doc.widthMm + bleedMm * 2;
  const totalHmm = doc.heightMm + bleedMm * 2;
  const wPx = Math.round(mmToPx(totalWmm, dpi));
  const hPx = Math.round(mmToPx(totalHmm, dpi));

  const canvas = createCanvas(wPx, hPx);
  const cx = canvas.getContext("2d");

  // 부동소수 정밀: integer translate 권장 — 우리 좌표는 모두 mm 단위라 충돌 적음.
  cx.imageSmoothingEnabled = true;
  if (ctx.highQuality !== false) {
    cx.imageSmoothingQuality = "high";
  }

  // 1) backgroundColor
  cx.save();
  cx.fillStyle = doc.backgroundColor || "#ffffff";
  cx.fillRect(0, 0, wPx, hPx);
  cx.restore();

  // bleed offset → 이후 모든 좌표는 trim 원점 기준.
  const bleedPx = mmToPx(bleedMm, dpi);
  cx.save();
  cx.translate(bleedPx, bleedPx);

  // trim 영역 사이즈
  const trimWPx = mmToPx(doc.widthMm, dpi);
  const trimHPx = mmToPx(doc.heightMm, dpi);

  // 2) backgroundImage (trim 박스에 cover/contain)
  if (doc.backgroundImage) {
    try {
      const buf = await (ctx.resolveBackgroundUrl?.(doc.backgroundImage) ??
        Promise.resolve(null));
      // photoId 가 있으면 일반 photo resolver fallback
      const buffer =
        buf ??
        (doc.backgroundImage.photoId
          ? await ctx.resolveImageUrl(doc.backgroundImage.photoId)
          : null);
      if (buffer) {
        const img = await loadImage(buffer);
        await drawCoverContain(
          cx,
          img,
          0,
          0,
          trimWPx,
          trimHPx,
          doc.backgroundImage.cropMode,
          doc.backgroundImage.opacity,
        );
      }
    } catch (e) {
      console.warn(
        "[pdf/render] background image load failed:",
        e instanceof Error ? e.message : String(e),
      );
    }
  }

  // 3) objects (배열 순서 = z-order, 뒤에 있을수록 위에 그려짐)
  for (const obj of doc.objects) {
    await drawObject(cx, obj, dpi, ctx);
  }

  cx.restore();

  return canvas;
}

// =====================================================================
// drawing helpers
// =====================================================================

async function drawObject(
  cx: SKRSContext2D,
  obj: LayoutObject,
  dpi: number,
  ctx: RenderContext,
): Promise<void> {
  if (obj.type === "photo") return drawPhoto(cx, obj, dpi, ctx);
  if (obj.type === "text") return drawText(cx, obj, dpi);
  if (obj.type === "rect") return drawRect(cx, obj, dpi);
  if (obj.type === "clipart") return drawClipart(cx, obj, dpi, ctx);
}

async function drawPhoto(
  cx: SKRSContext2D,
  obj: PhotoObject,
  dpi: number,
  ctx: RenderContext,
): Promise<void> {
  const xPx = mmToPx(obj.leftMm, dpi);
  const yPx = mmToPx(obj.topMm, dpi);
  const wPx = mmToPx(obj.widthMm, dpi);
  const hPx = mmToPx(obj.heightMm, dpi);
  const radiusPx = mmToPx(obj.borderRadiusMm ?? 0, dpi);

  let img: LoadedImage;
  try {
    const buf = await ctx.resolveImageUrl(obj.photoId);
    img = await loadImage(buf);
  } catch (e) {
    // 이미지 로드 실패 → placeholder
    drawPhotoPlaceholder(cx, xPx, yPx, wPx, hPx, radiusPx, obj.rotation);
    console.warn(
      `[pdf/render] photo ${obj.photoId} load failed: ${e instanceof Error ? e.message : String(e)}`,
    );
    return;
  }

  cx.save();

  // 회전: 중심점 이동 → rotate
  const cxx = xPx + wPx / 2;
  const cyy = yPx + hPx / 2;
  cx.translate(cxx, cyy);
  if (obj.rotation) {
    cx.rotate((obj.rotation * Math.PI) / 180);
  }

  // Pass 1 — shadow only.
  //   clip() 을 호출하면 이후의 drawImage 그림자가 clip 영역 안으로 갇혀 보이지 않는다.
  //   따라서 clip 전에 슬롯 모양을 흰색으로 fill 해서 그림자만 캔버스에 미리 새긴다.
  //   - cover 모드: 이미지가 슬롯을 가득 채우므로 흰 fill 은 위에서 덮여 보이지 않음.
  //   - contain 모드: 슬롯 내부 빈 공간이 흰색으로 채워져 자연스러움.
  //   shadow 색/오프셋/블러는 PageDoc 의 PhotoObject.shadow 그대로 사용.
  if (obj.shadow) {
    cx.save();
    cx.shadowColor = obj.shadow.color;
    cx.shadowBlur = mmToPx(obj.shadow.blurMm, dpi);
    cx.shadowOffsetX = 0;
    cx.shadowOffsetY = mmToPx(obj.shadow.offsetYMm, dpi);
    cx.fillStyle = "#ffffff";
    cx.beginPath();
    if (radiusPx > 0) {
      pathRoundRect(cx, -wPx / 2, -hPx / 2, wPx, hPx, radiusPx);
    } else {
      cx.rect(-wPx / 2, -hPx / 2, wPx, hPx);
    }
    cx.fill();
    cx.restore();
  }

  // Pass 2 — clipping path (slot box, 회전된 좌표계에서 -w/2, -h/2 박스).
  //   여기부터는 shadow 가 비활성 상태 (Pass 1 save/restore 로 격리됨).
  cx.beginPath();
  if (radiusPx > 0) {
    pathRoundRect(cx, -wPx / 2, -hPx / 2, wPx, hPx, radiusPx);
  } else {
    cx.rect(-wPx / 2, -hPx / 2, wPx, hPx);
  }
  cx.clip();

  // crop fit
  const iw = img.width;
  const ih = img.height;
  const scaleCover = Math.max(wPx / iw, hPx / ih);
  const scaleContain = Math.min(wPx / iw, hPx / ih);
  const s = obj.cropMode === "contain" ? scaleContain : scaleCover;
  const drawW = iw * s;
  const drawH = ih * s;
  cx.drawImage(img, -drawW / 2, -drawH / 2, drawW, drawH);

  cx.restore();
}

function drawPhotoPlaceholder(
  cx: SKRSContext2D,
  xPx: number,
  yPx: number,
  wPx: number,
  hPx: number,
  radiusPx: number,
  rotation: number,
): void {
  cx.save();
  const cxx = xPx + wPx / 2;
  const cyy = yPx + hPx / 2;
  cx.translate(cxx, cyy);
  if (rotation) cx.rotate((rotation * Math.PI) / 180);
  cx.fillStyle = "#e6e2db";
  cx.beginPath();
  if (radiusPx > 0) pathRoundRect(cx, -wPx / 2, -hPx / 2, wPx, hPx, radiusPx);
  else cx.rect(-wPx / 2, -hPx / 2, wPx, hPx);
  cx.fill();
  cx.strokeStyle = "rgba(0,0,0,0.2)";
  cx.lineWidth = 1;
  cx.setLineDash([4, 4]);
  cx.stroke();
  cx.restore();
}

/**
 * 클립아트(외부 리소스 이미지) 그리기.
 *  - resolveClipart 가 우선 — resourceId 가 있으면 admin 으로 새 signedUrl 발급/다운로드.
 *  - 없으면 src 를 fetch (외부 public URL 또는 만료되지 않은 signedUrl).
 *  - cropMode 는 contain 고정 (클라 buildClipart 와 동일 결과).
 *  - opacity 적용. 회전은 PhotoObject 와 동일하게 중심 기준.
 */
async function drawClipart(
  cx: SKRSContext2D,
  obj: ClipartObject,
  dpi: number,
  ctx: RenderContext,
): Promise<void> {
  const xPx = mmToPx(obj.leftMm, dpi);
  const yPx = mmToPx(obj.topMm, dpi);
  const wPx = mmToPx(obj.widthMm, dpi);
  const hPx = mmToPx(obj.heightMm, dpi);

  let buf: Buffer | null = null;
  try {
    if (ctx.resolveClipart) {
      buf = await ctx.resolveClipart({
        resourceId: obj.resourceId,
        src: obj.src,
      });
    }
    if (!buf) {
      // fallback: 직접 fetch
      const r = await fetch(obj.src);
      if (r.ok) {
        const ab = await r.arrayBuffer();
        buf = Buffer.from(ab);
      }
    }
  } catch (e) {
    console.warn(
      `[pdf/render] clipart load failed (${obj.resourceId ?? obj.src}): ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  if (!buf) {
    // placeholder 회색 박스
    cx.save();
    cx.translate(xPx + wPx / 2, yPx + hPx / 2);
    if (obj.rotation) cx.rotate((obj.rotation * Math.PI) / 180);
    cx.globalAlpha = obj.opacity ?? 1;
    cx.fillStyle = "#eef0f4";
    cx.fillRect(-wPx / 2, -hPx / 2, wPx, hPx);
    cx.restore();
    return;
  }

  let img;
  try {
    img = await loadImage(buf);
  } catch (e) {
    console.warn(
      `[pdf/render] clipart decode failed: ${e instanceof Error ? e.message : String(e)}`,
    );
    return;
  }

  cx.save();
  const cxx = xPx + wPx / 2;
  const cyy = yPx + hPx / 2;
  cx.translate(cxx, cyy);
  if (obj.rotation) cx.rotate((obj.rotation * Math.PI) / 180);
  cx.globalAlpha = Math.max(0, Math.min(1, obj.opacity ?? 1));

  // contain — 슬롯 안에 비율 유지
  const iw = img.width;
  const ih = img.height;
  const s = Math.min(wPx / iw, hPx / ih);
  const drawW = iw * s;
  const drawH = ih * s;
  cx.drawImage(img, -drawW / 2, -drawH / 2, drawW, drawH);
  cx.restore();
}

function drawRect(cx: SKRSContext2D, obj: RectObject, dpi: number): void {
  const xPx = mmToPx(obj.leftMm, dpi);
  const yPx = mmToPx(obj.topMm, dpi);
  const wPx = mmToPx(obj.widthMm, dpi);
  const hPx = mmToPx(obj.heightMm, dpi);
  const radiusPx = mmToPx(obj.borderRadiusMm ?? 0, dpi);

  cx.save();
  const cxx = xPx + wPx / 2;
  const cyy = yPx + hPx / 2;
  cx.translate(cxx, cyy);
  if (obj.rotation) cx.rotate((obj.rotation * Math.PI) / 180);

  cx.beginPath();
  if (radiusPx > 0) pathRoundRect(cx, -wPx / 2, -hPx / 2, wPx, hPx, radiusPx);
  else cx.rect(-wPx / 2, -hPx / 2, wPx, hPx);

  if (obj.placeholderSlot) {
    // 빈 슬롯: 채우지 않고 점선 테두리만
    cx.strokeStyle = "rgba(0,0,0,0.25)";
    cx.lineWidth = mmToPx(0.3, dpi);
    cx.setLineDash([mmToPx(2, dpi), mmToPx(1.4, dpi)]);
    cx.stroke();
  } else {
    cx.fillStyle = obj.fill || "#ffffff";
    cx.fill();
  }

  cx.restore();
}

function drawText(cx: SKRSContext2D, obj: TextObject, dpi: number): void {
  const xPx = mmToPx(obj.leftMm, dpi);
  const yPx = mmToPx(obj.topMm, dpi);
  const wPx = mmToPx(obj.widthMm, dpi);
  const hPx = mmToPx(obj.heightMm, dpi);
  const fontSizePx = ptToPx(obj.fontSizePt, dpi);

  cx.save();

  // 회전: 박스 중심
  const cxx = xPx + wPx / 2;
  const cyy = yPx + hPx / 2;
  cx.translate(cxx, cyy);
  // 책등 텍스트 등 세로 회전 지원 — 회전 전 박스의 중심 기준 deg.
  if (obj.rotation) {
    cx.rotate((obj.rotation * Math.PI) / 180);
  }

  // 폰트 문자열 — 등록되지 않은 family 는 시스템 폴백에 의존
  const style = obj.italic ? "italic" : "normal";
  const weight = obj.bold ? "700" : "400";
  cx.font = `${style} ${weight} ${fontSizePx}px "${escapeFamily(obj.fontFamily)}", "Pretendard", sans-serif`;
  cx.fillStyle = obj.fill || "#2b2b2b";
  cx.textBaseline = "alphabetic";

  // 줄바꿈
  const lines = wrapMixedText(obj.text || "", {
    measure: (s) => cx.measureText(s).width,
    maxWidthPx: wPx,
  });
  const lineHeightPx = fontSizePx * (obj.lineHeight ?? 1.4);
  const totalHPx = lineHeightPx * lines.length;

  // align (가로)
  let tx = -wPx / 2;
  if (obj.align === "center") {
    cx.textAlign = "center";
    tx = 0;
  } else if (obj.align === "right") {
    cx.textAlign = "right";
    tx = wPx / 2;
  } else {
    cx.textAlign = "left";
    tx = -wPx / 2;
  }

  // 세로 중앙 정렬 (슬롯 박스 기준). 첫 줄 baseline 위치.
  // 캔버스 textBaseline=alphabetic 기준, 첫 줄의 baseline ≈ -totalH/2 + 폰트 ascent.
  // ascent 추정: lineHeight 의 80% (한글/라틴 평균).
  const firstBaseline = -totalHPx / 2 + lineHeightPx * 0.8;

  for (let i = 0; i < lines.length; i++) {
    const ty = firstBaseline + i * lineHeightPx;
    cx.fillText(lines[i]!, tx, ty);
  }

  cx.restore();
  // 박스 폭/높이를 명시적으로 사용하지 않더라도 미래 디버그/박스 시각화용.
  void hPx;
}

/** rounded rect path. canvas 표준 roundRect 가 있으면 사용. */
function pathRoundRect(
  cx: SKRSContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const radius = Math.min(r, w / 2, h / 2);
  const c = cx as unknown as { roundRect?: (x: number, y: number, w: number, h: number, r: number) => void };
  if (typeof c.roundRect === "function") {
    c.roundRect(x, y, w, h, radius);
    return;
  }
  cx.moveTo(x + radius, y);
  cx.lineTo(x + w - radius, y);
  cx.quadraticCurveTo(x + w, y, x + w, y + radius);
  cx.lineTo(x + w, y + h - radius);
  cx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  cx.lineTo(x + radius, y + h);
  cx.quadraticCurveTo(x, y + h, x, y + h - radius);
  cx.lineTo(x, y + radius);
  cx.quadraticCurveTo(x, y, x + radius, y);
  cx.closePath();
}

async function drawCoverContain(
  cx: SKRSContext2D,
  img: LoadedImage,
  x: number,
  y: number,
  w: number,
  h: number,
  cropMode: "cover" | "contain",
  opacity: number,
): Promise<void> {
  const iw = img.width;
  const ih = img.height;
  const scaleCover = Math.max(w / iw, h / ih);
  const scaleContain = Math.min(w / iw, h / ih);
  const s = cropMode === "contain" ? scaleContain : scaleCover;
  const drawW = iw * s;
  const drawH = ih * s;
  const dx = x + (w - drawW) / 2;
  const dy = y + (h - drawH) / 2;

  cx.save();
  // cover 시 trim 박스 밖으로 새지 않게 clip
  cx.beginPath();
  cx.rect(x, y, w, h);
  cx.clip();
  cx.globalAlpha = Math.max(0, Math.min(1, opacity ?? 1));
  cx.drawImage(img, dx, dy, drawW, drawH);
  cx.restore();
}

/** font-family 이름에 들어간 따옴표/이스케이프 위험 문자 제거. */
function escapeFamily(family: string): string {
  return family.replace(/["\\\n\r]/g, "");
}

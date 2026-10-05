import "server-only";

import { createCanvas, loadImage, type Canvas, type Image } from "@napi-rs/canvas";

import { loadHardenedSharp, UNTRUSTED_INPUT_OPTIONS } from "@/lib/image/sharp-safe";

/**
 * PDF 사진 슬롯용 디코드 — 원본을 **슬롯에 실제로 그려지는 픽셀 크기까지 먼저 줄여** 캔버스에 올린다.
 *
 * 왜 필요한가 (2026-10-05 100페이지 부하 측정, STATUS §0-19):
 *   예전에는 원본(최대 20MB·200MP)을 `loadImage` 로 전체 해상도 디코드한 뒤 캔버스가 축소해 그렸다.
 *   12MP 한 장이 약 48MB 비트맵이고, 페이지 4장 동시 렌더 × collage-6(페이지당 6장)이면 RSS 가
 *   1,648~1,749MB 로 함수 한도(1769MB)의 93~99% 였다. 48MP 원본이면 OOM 이 확실하다.
 *   슬롯은 20×20 판형에서도 2,000px 안팎이라 원본 해상도의 대부분은 버려지는 픽셀이었다.
 *
 * 방식:
 *   - 헤더만 읽어(`metadata`) 원본 크기를 알고, 기존 그리기와 같은 수식(cover = max, contain = min)으로
 *     축소 배율을 계산한다. 배율 < 1 일 때만 sharp `resize` 로 줄인다 — JPEG 는 libvips 가 축소 디코드
 *     (shrink-on-load)를 써서 전체 해상도 비트맵을 만들지 않는다.
 *     · cover   : `fit: "cover"`(가운데 기준 잘라내기) — 기존 drawImage 가 가운데 정렬 후 슬롯으로 clip 하는 것과 같다.
 *     · contain : `fit: "inside"` — 비율 유지 전체.
 *   - 결과 RGBA 픽셀을 캔버스(ImageData)에 그대로 올린다(재인코딩 없음 = 추가 손실 없음).
 *   - 호출 측은 돌려받은 이미지의 width/height 로 **기존 crop-fit 수식을 그대로** 쓴다. 축소 결과가 슬롯
 *     비율과 같으므로 같은 위치·크기로 그려진다(반올림 ≤ 1px 차이).
 *
 * 기존 경로(원본 그대로 `loadImage`)를 쓰는 경우 — 렌더 결과를 바꾸지 않는다:
 *   - 축소가 필요 없음(배율 ≥ 1, 즉 업스케일) · 크기 정보 없음.
 *   - EXIF orientation 이 1 이 아닌 원본 — 업로드가 `rotate()` 로 정규화하지만 그 이전 원본이 남아 있을 수 있고,
 *     방향 처리(sharp 는 명시해야 회전, 캔버스 디코더의 처리는 다를 수 있음)를 바꾸지 않기 위해 건드리지 않는다.
 *   - sharp 실패 — 로더 차단·손상 등. 기존 경로가 실패하면 호출 측이 placeholder 로 처리한다.
 *
 * 입력 바이트는 `validatePdfOriginal`(매직 바이트·하드닝 sharp·픽셀 한도) 을 이미 통과한 원본이다.
 * 여기서도 하드닝된 sharp(`loadHardenedSharp` + 픽셀 한도)만 쓴다(함정 17).
 */

export type SlotImage = Image | Canvas;

export interface SlotDecodeResult {
  image: SlotImage;
  /** 슬롯 크기로 줄였는가 (false 면 원본 해상도 그대로). */
  downscaled: boolean;
}

/** 기존 drawPhoto 와 같은 배율 수식. */
export function slotScale(
  img: { width: number; height: number },
  slot: { wPx: number; hPx: number },
  cropMode: "cover" | "contain" | undefined,
): number {
  const cover = Math.max(slot.wPx / img.width, slot.hPx / img.height);
  const contain = Math.min(slot.wPx / img.width, slot.hPx / img.height);
  return cropMode === "contain" ? contain : cover;
}

/** 축소 목표 크기(정수 px). cover 는 슬롯 크기, contain 은 비율 유지 크기. */
export function downscaleTarget(
  img: { width: number; height: number },
  slot: { wPx: number; hPx: number },
  cropMode: "cover" | "contain" | undefined,
): { width: number; height: number } {
  if (cropMode === "contain") {
    const s = slotScale(img, slot, cropMode);
    return {
      width: Math.max(1, Math.round(img.width * s)),
      height: Math.max(1, Math.round(img.height * s)),
    };
  }
  return { width: Math.max(1, Math.round(slot.wPx)), height: Math.max(1, Math.round(slot.hPx)) };
}

export async function decodePhotoForSlot(
  buf: Buffer,
  slot: { wPx: number; hPx: number },
  cropMode: "cover" | "contain" | undefined,
): Promise<SlotDecodeResult> {
  try {
    const sharp = await loadHardenedSharp();
    const meta = await sharp(buf, UNTRUSTED_INPUT_OPTIONS).metadata();
    const width = meta.width ?? 0;
    const height = meta.height ?? 0;
    const orientation = meta.orientation ?? 1;
    if (width > 0 && height > 0 && orientation === 1) {
      const s = slotScale({ width, height }, slot, cropMode);
      if (s < 1) {
        const target = downscaleTarget({ width, height }, slot, cropMode);
        const { data, info } = await sharp(buf, UNTRUSTED_INPUT_OPTIONS)
          .resize(target.width, target.height, {
            fit: cropMode === "contain" ? "inside" : "cover",
            position: "centre",
            kernel: "lanczos3",
          })
          .ensureAlpha()
          .raw()
          .toBuffer({ resolveWithObject: true });
        const canvas = createCanvas(info.width, info.height);
        const cx = canvas.getContext("2d");
        const imageData = cx.createImageData(info.width, info.height);
        imageData.data.set(data);
        cx.putImageData(imageData, 0, 0);
        return { image: canvas, downscaled: true };
      }
    }
  } catch (e) {
    console.warn(
      `[pdf/render] 사진 슬롯 축소 실패 — 원본 디코드로 진행: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  return { image: await loadImage(buf), downscaled: false };
}

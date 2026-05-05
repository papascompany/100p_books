/**
 * 서버 리소스 폰트 동적 로더.
 *
 * 흐름:
 *   1. ResourcePalette / SelectionPanel 가 폰트를 선택.
 *   2. ensureFontLoaded(name, src) 호출 → 이미 로드된 폰트면 즉시 resolve.
 *   3. FontFace API 로 외부 폰트 다운로드 → document.fonts.add → 캐시.
 *   4. Fabric Textbox 객체 dirty=true + canvas.requestRenderAll() 로 재렌더 트리거.
 */

import * as fabric from "fabric";

const loaded = new Map<string, Promise<FontFace>>();

export interface ResourceFontMeta {
  /** Fabric / CSS 에서 사용할 family 이름. */
  family: string;
  /** 폰트 파일 URL (woff2/woff/ttf/otf). */
  src: string;
}

/**
 * 같은 family 의 두 번째 호출은 캐시된 Promise 반환.
 */
export function ensureFontLoaded(meta: ResourceFontMeta): Promise<FontFace> {
  const key = meta.family;
  const cached = loaded.get(key);
  if (cached) return cached;

  if (typeof window === "undefined" || typeof FontFace === "undefined") {
    return Promise.reject(new Error("FontFace API 미지원 환경"));
  }

  const face = new FontFace(meta.family, `url(${meta.src})`);
  const p = face.load().then((f) => {
    document.fonts.add(f);
    return f;
  });
  loaded.set(key, p);
  return p;
}

/**
 * 캔버스에서 해당 family 를 사용하는 텍스트 객체들의 dirty=true 처리 후 재렌더.
 * 폰트 로드 완료 직후 호출하면 폰트 메트릭이 다시 계산된다.
 */
export function refreshCanvasForFont(
  canvas: fabric.Canvas,
  family: string,
): void {
  for (const obj of canvas.getObjects()) {
    if (obj instanceof fabric.Textbox || obj instanceof fabric.IText) {
      if ((obj.fontFamily as string) === family) {
        (obj as fabric.Textbox).set({ dirty: true });
      }
    }
  }
  canvas.requestRenderAll();
}

/**
 * 편의 헬퍼 — 로드 + 캔버스 갱신을 한 번에.
 */
export async function loadAndApplyFont(
  canvas: fabric.Canvas,
  meta: ResourceFontMeta,
): Promise<void> {
  await ensureFontLoaded(meta);
  refreshCanvasForFont(canvas, meta.family);
}

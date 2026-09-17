import "server-only";

import type { SharpConstructor, SharpOptions } from "sharp";

import { MAX_INPUT_PIXELS } from "./constants";

/**
 * 사용자·관리자 업로드 바이트를 다루는 서버 코드용 sharp 진입점 (SEC-1 심층 방어).
 *
 * 1차 방어는 라우트의 매직 바이트 선판정(`sniff.ts`)이다. 여기서는 판정이 우회되거나
 * 빠진 경로가 생겨도 위험한 디코더까지 가지 않도록 libvips 로더 자체를 닫는다.
 *
 *   - GHSA-rgj7-g3m4-5g8c 의 공식 workaround 는 `VipsForeignLoadHeif` 차단 하나다.
 *     이 서비스가 서버에서 디코드하는 입력은 JPEG/PNG/WebP 버퍼뿐이므로, 그보다 넓게
 *     모든 로더(`VipsForeignLoad`)를 막고 아래 버퍼 로더만 다시 연다(sharp 문서의 allowlist 형태).
 *     HEIF/AVIF·GIF·TIFF·SVG·PDF·vips 등은 "unsupported image format" 으로 거부된다.
 *   - libvips 는 모르는 operation 이름을 **조용히 무시**한다. 이름 오타·libvips 개명은
 *     `sharp-safe.test.ts` 가 실제 디코드 결과로 잡는다(sharp 업그레이드 시 반드시 통과 확인).
 *   - 차단은 libvips 프로세스 전역 상태다. 같은 프로세스의 다른 sharp 호출(로컬 `next start` 의
 *     next/image 최적화 포함)에도 적용된다. Vercel 의 이미지 최적화는 함수 밖에서 돈다.
 */
export const SHARP_ALLOWED_LOADERS = [
  "VipsForeignLoadJpegBuffer",
  "VipsForeignLoadPngBuffer",
  "VipsForeignLoadWebpBuffer",
] as const;

/** 신뢰할 수 없는 입력에 붙이는 sharp 생성자 옵션. 픽셀 한도는 기본값에 기대지 않고 명시한다. */
export const UNTRUSTED_INPUT_OPTIONS = {
  limitInputPixels: MAX_INPUT_PIXELS,
} as const satisfies SharpOptions;

let hardened: Promise<SharpConstructor> | null = null;

/**
 * 로더 allowlist 를 한 번 적용한 sharp 를 돌려준다.
 * 업로드 바이트를 디코드하는 코드는 `import("sharp")` 대신 이 함수만 쓴다.
 */
export function loadHardenedSharp(): Promise<SharpConstructor> {
  if (!hardened) {
    hardened = import("sharp").then(
      ({ default: sharp }) => {
        sharp.block({ operation: ["VipsForeignLoad"] });
        sharp.unblock({ operation: [...SHARP_ALLOWED_LOADERS] });
        return sharp;
      },
      (err: unknown) => {
        // 모듈 로드 실패는 캐시하지 않는다 — 다음 호출에서 다시 시도.
        hardened = null;
        throw err;
      },
    );
  }
  return hardened;
}

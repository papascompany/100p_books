import type { Photo } from "@/lib/db/types";
import type { SortMode } from "./types";

/**
 * Fisher-Yates 용 결정론적 PRNG (mulberry32).
 * seed 를 넘기면 동일 배열 + 동일 seed → 동일 결과.
 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * 한글 포함 파일명 자연 정렬.
 *   - `Intl.Collator` 에 numeric: true 옵션을 써서 IMG_2 < IMG_10 순서 보장.
 *   - 대소문자 무시(sensitivity: base).
 */
const koreanNaturalCollator = new Intl.Collator("ko", {
  numeric: true,
  sensitivity: "base",
});

function cmpFilename(a: Photo, b: Photo): number {
  const an = a.filename ?? "";
  const bn = b.filename ?? "";
  const c = koreanNaturalCollator.compare(an, bn);
  if (c !== 0) return c;
  return a.order_idx - b.order_idx;
}

function cmpExif(a: Photo, b: Photo): number {
  const at = a.exif_taken_at;
  const bt = b.exif_taken_at;
  // null 은 뒤로
  if (at === null && bt === null) return cmpFilename(a, b);
  if (at === null) return 1;
  if (bt === null) return -1;
  // ISO 문자열 → Date 비교
  const ta = Date.parse(at);
  const tb = Date.parse(bt);
  if (Number.isNaN(ta) && Number.isNaN(tb)) return cmpFilename(a, b);
  if (Number.isNaN(ta)) return 1;
  if (Number.isNaN(tb)) return -1;
  if (ta !== tb) return ta - tb;
  // tiebreaker: filename natural → order_idx
  return cmpFilename(a, b);
}

function cmpUpload(a: Photo, b: Photo): number {
  if (a.order_idx !== b.order_idx) return a.order_idx - b.order_idx;
  return cmpFilename(a, b);
}

/**
 * 사진 배열을 지정한 모드로 정렬해 **새 배열**을 반환.
 * 입력 배열은 변형하지 않는다.
 *
 * - `exif`:     `exif_taken_at` 오름차순. null 은 뒤로. tiebreaker = filename natural → order_idx.
 * - `filename`: 자연 정렬 (IMG_2.jpg < IMG_10.jpg).
 * - `upload`:   `order_idx` 오름차순.
 * - `random`:   Fisher-Yates. seed 지정 시 결정론적, 미지정 시 `Date.now()`.
 */
export function sortPhotos(
  photos: Photo[],
  mode: SortMode,
  seed?: number,
): Photo[] {
  const arr = photos.slice();

  switch (mode) {
    case "exif":
      arr.sort(cmpExif);
      return arr;
    case "filename":
      arr.sort(cmpFilename);
      return arr;
    case "upload":
      arr.sort(cmpUpload);
      return arr;
    case "random": {
      const rand = mulberry32(seed ?? Date.now());
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        const tmp = arr[i]!;
        arr[i] = arr[j]!;
        arr[j] = tmp;
      }
      return arr;
    }
    default: {
      // exhaustive check
      const _n: never = mode;
      void _n;
      return arr;
    }
  }
}

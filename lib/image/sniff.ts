/**
 * 업로드 바이트의 실제 이미지 형식을 매직 바이트로 판정한다.
 *
 * 클라이언트가 선언한 MIME·확장자는 위조할 수 있다(예: AVIF 를 image/jpeg 로 올림).
 * 서버는 바이트를 sharp(libvips) 같은 네이티브 디코더에 넘기기 **전에** 이 판정으로
 * 허용 목록을 강제한다(SEC-1). 순수 함수 — I/O 없음, 클라/서버 공용.
 */

/** 판정한 형식. 허용 목록 밖 형식도 오류 메시지용으로 이름을 돌려준다. */
export type SniffedFormat =
  | "jpeg"
  | "png"
  | "webp"
  | "heic"
  | "heif"
  | "avif"
  | "gif"
  | "tiff"
  | "unknown";

const MIME_BY_FORMAT: Record<Exclude<SniffedFormat, "unknown">, string> = {
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  heic: "image/heic",
  heif: "image/heif",
  avif: "image/avif",
  gif: "image/gif",
  tiff: "image/tiff",
};

/** ISO-BMFF ftyp brand — AVIF. 다른 brand 와 함께 있어도 AVIF 로 본다(허용 쪽으로 기울지 않는다). */
const AVIF_BRANDS = new Set(["avif", "avis"]);
/** HEVC 로 부호화된 HEIC 계열 brand. */
const HEIC_BRANDS = new Set(["heic", "heix", "hevc", "hevx", "heim", "heis", "hevm", "hevs"]);
/** 코덱을 특정하지 않는 일반 HEIF brand. AVIF/HEIC brand 가 없을 때만 image/heif 로 본다. */
const HEIF_GENERIC_BRANDS = new Set(["mif1", "msf1"]);
/** ftyp 박스에서 brand 를 읽는 최대 바이트 — 비정상적으로 큰 size 선언에 끌려다니지 않는다. */
const FTYP_SCAN_LIMIT = 256;

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;
const WEBP_CHUNKS = new Set(["VP8 ", "VP8L", "VP8X"]);

function ascii(bytes: Uint8Array, start: number, length: number): string {
  if (start + length > bytes.length) return "";
  let s = "";
  for (let i = start; i < start + length; i++) {
    s += String.fromCharCode(bytes[i] ?? 0);
  }
  return s;
}

function uint32BE(bytes: Uint8Array, offset: number): number {
  return (
    (((bytes[offset] ?? 0) << 24) >>> 0) +
    ((bytes[offset + 1] ?? 0) << 16) +
    ((bytes[offset + 2] ?? 0) << 8) +
    (bytes[offset + 3] ?? 0)
  );
}

function startsWith(bytes: Uint8Array, prefix: readonly number[]): boolean {
  if (bytes.length < prefix.length) return false;
  return prefix.every((b, i) => bytes[i] === b);
}

/** ISO-BMFF(ftyp) 컨테이너면 brand 로 형식을 판정하고, 아니면 null. */
function sniffIsoBmff(bytes: Uint8Array): SniffedFormat | null {
  if (ascii(bytes, 4, 4) !== "ftyp") return null;
  if (bytes.length < 16) return "unknown";

  const declared = uint32BE(bytes, 0);
  // size 0 = 파일 끝까지. 1 = 64bit largesize(ftyp 에서는 비정상). 16 미만은 major+minor 도 못 담는다.
  if (declared === 1 || (declared !== 0 && declared < 16)) return "unknown";
  const end = Math.min(declared === 0 ? bytes.length : declared, bytes.length, FTYP_SCAN_LIMIT);

  const brands = [ascii(bytes, 8, 4)]; // major brand (12..16 은 minor version)
  for (let off = 16; off + 4 <= end; off += 4) {
    brands.push(ascii(bytes, off, 4));
  }

  if (brands.some((b) => AVIF_BRANDS.has(b))) return "avif";
  if (brands.some((b) => HEIC_BRANDS.has(b))) return "heic";
  if (brands.some((b) => HEIF_GENERIC_BRANDS.has(b))) return "heif";
  return "unknown"; // mp4/mov/3gp 등 이미지가 아닌 ISO-BMFF
}

/**
 * 매직 바이트로 형식을 판정한다.
 *
 * ftyp 검사를 가장 먼저 한다: JPEG 서명 뒤 4..8 바이트에 "ftyp" 를 끼운 polyglot 을
 * JPEG 로 통과시키지 않고 HEIF 계열(서버 비처리)로 분류하기 위해서다.
 */
export function sniffImageFormat(bytes: Uint8Array): SniffedFormat {
  const iso = sniffIsoBmff(bytes);
  if (iso) return iso;

  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "jpeg";
  if (startsWith(bytes, PNG_SIGNATURE)) return "png";
  if (
    ascii(bytes, 0, 4) === "RIFF" &&
    ascii(bytes, 8, 4) === "WEBP" &&
    WEBP_CHUNKS.has(ascii(bytes, 12, 4))
  ) {
    return "webp";
  }
  const gif = ascii(bytes, 0, 6);
  if (gif === "GIF87a" || gif === "GIF89a") return "gif";
  if (
    startsWith(bytes, [0x49, 0x49, 0x2a, 0x00]) ||
    startsWith(bytes, [0x4d, 0x4d, 0x00, 0x2a]) ||
    startsWith(bytes, [0x49, 0x49, 0x2b, 0x00]) || // BigTIFF
    startsWith(bytes, [0x4d, 0x4d, 0x00, 0x2b])
  ) {
    return "tiff";
  }
  return "unknown";
}

export interface SniffResult<M extends string> {
  /** 바이트로 판정한 형식. */
  format: SniffedFormat;
  /** 판정 형식의 MIME 이 `allowed` 에 있을 때만 그 MIME, 아니면 null. */
  mime: M | null;
}

/**
 * 형식을 판정하고 허용 목록과 대조한다. 클라이언트가 선언한 MIME 은 보지 않는다.
 *
 * @param allowed 허용 MIME 목록 (예: `ALLOWED_MIME_TYPES`, 리소스 종류별 `mimes`)
 */
export function sniffAllowedImage<M extends string>(
  bytes: Uint8Array,
  allowed: readonly M[],
): SniffResult<M> {
  const format = sniffImageFormat(bytes);
  if (format === "unknown") return { format, mime: null };
  const mime = MIME_BY_FORMAT[format];
  const match = allowed.find((a) => a.toLowerCase() === mime);
  return { format, mime: match ?? null };
}

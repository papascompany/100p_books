/**
 * PageDoc 중립 스키마 — M2 layout-engine 산출물 & M3 fabric-editor 입력.
 *
 * 좌표 규약:
 *   - 모든 위치/크기는 **mm** (책 trim 좌상단 원점).
 *   - bleed 2mm 는 trim 영역 바깥으로 확장되는 재단 여유분 (좌표는 trim 기준, 음수 가능).
 *   - 폰트 크기는 **pt** — PDF 생성기와 규약 통일.
 *   - rotation 은 degrees, 오브젝트 중심 기준(렌더러 관례).
 *
 * 버전:
 *   - PAGEDOC_VERSION 을 올릴 때는 M3 로더에 마이그레이션 로직을 추가해야 한다.
 */

export const PAGEDOC_VERSION = "1" as const;
export type PageDocVersion = typeof PAGEDOC_VERSION;

export type SortMode = "exif" | "filename" | "upload" | "random";
export type LayoutMode = "polaroid" | "collage";

/** PageDoc.layoutMode — 표지(cover)까지 포함하기 위해 별도 타입. */
export type PageLayoutMode = "polaroid" | "collage" | "cover";

export interface PhotoObject {
  type: "photo";
  objectId: string;
  /** photos.id (DB) 참조. 렌더러는 이 id 로 signed URL 매핑한다. */
  photoId: string;
  leftMm: number;
  topMm: number;
  widthMm: number;
  heightMm: number;
  /** degrees (중심 기준, 양수=시계방향). 기본 0. */
  rotation: number;
  /** 슬롯 비율에 맞춘 crop 전략. */
  cropMode: "cover" | "contain";
  borderRadiusMm?: number;
  shadow?: { blurMm: number; offsetYMm: number; color: string };
}

export interface TextObject {
  type: "text";
  objectId: string;
  leftMm: number;
  topMm: number;
  widthMm: number;
  heightMm: number;
  text: string;
  /** 비어있을 때 렌더러가 대체로 표시할 힌트(편집 시엔 보이지 않음). */
  placeholder?: string;
  /** "Pretendard" 기본. 리소스로 등록된 폰트명 외엔 시스템 폴백. */
  fontFamily: string;
  /** 포인트 단위 (PDF 규약과 일치). */
  fontSizePt: number;
  /** CSS-compatible color string. */
  fill: string;
  align: "left" | "center" | "right";
  /** multiplier (1 = 폰트 크기 그대로). 기본 1.4. */
  lineHeight: number;
  italic?: boolean;
  bold?: boolean;
  /**
   * degrees (중심 기준, 양수=시계방향). 기본 0.
   * 책등 텍스트(세로) 등에 사용. 회전 전 박스(leftMm/topMm/widthMm/heightMm) 의
   * 중심을 기준으로 시각적으로 회전한다. 미지정 시 0 으로 간주.
   */
  rotation?: number;
}

export interface RectObject {
  type: "rect";
  objectId: string;
  leftMm: number;
  topMm: number;
  widthMm: number;
  heightMm: number;
  fill: string;
  rotation?: number;
  borderRadiusMm?: number;
  /** 빈 슬롯 자리표시자용 — M3 에디터에서 사진 드래그 드롭 시 PhotoObject 로 승격. */
  placeholderSlot?: boolean;
}

/**
 * 서버 리소스(클립아트) 카탈로그에서 캔버스에 추가된 이미지.
 *  - photoId 기반이 아닌 외부 리소스 — `resources` 테이블의 id 와 url 보존.
 *  - signedUrl 발급 만료 가능 — 서버 PDF 렌더 시점에 resourceId 로 재발급.
 *  - cropMode 는 항상 cover (슬롯 박스에 가득 — 회전 후에도 박스로 클립).
 */
export interface ClipartObject {
  type: "clipart";
  objectId: string;
  leftMm: number;
  topMm: number;
  widthMm: number;
  heightMm: number;
  /** degrees (중심 기준, 양수=시계방향). 기본 0. */
  rotation: number;
  /** 서버 리소스 URL (signedUrl 또는 public). resources.id 보존을 위해 별도 필드. */
  src: string;
  /** resources.id — signedUrl 만료 시 재발급용. */
  resourceId?: string;
  /** 0..1. 미지정 시 1. */
  opacity?: number;
}

export type LayoutObject = PhotoObject | TextObject | RectObject | ClipartObject;

/**
 * 페이지/표지 배경 이미지(선택). backgroundColor 는 항상 유지하고,
 * backgroundImage 가 정의되면 그 위에 덮인다.
 *
 *   - photoId: 프로젝트 photos 의 id 참조 (signed URL 매핑은 런타임).
 *   - url    : 외부 / 서버 리소스(배경 카탈로그) URL — photoId 가 없을 때 사용.
 *   - cropMode: cover (캔버스 가득 / 비율 잘라냄) | contain (비율 유지 + 여백).
 *   - opacity : 0..1.
 */
export interface BackgroundImage {
  photoId?: string;
  url?: string;
  cropMode: "cover" | "contain";
  opacity: number;
}

export interface PageDoc {
  version: PageDocVersion;
  bookSizeId: string;
  pageNo: number;
  layoutMode: PageLayoutMode;
  /** trim width (mm). 표지에서는 totalWidthMm(앞+책등+뒤) 가 들어간다. */
  widthMm: number;
  /** trim height (mm). 표지에서는 totalHeightMm. */
  heightMm: number;
  /** 고정 2mm (M5 PDF 파이프라인 규약). */
  bleedMm: 2;
  backgroundColor: string;
  /** 선택 — 배경 이미지(풀블리드). 없으면 backgroundColor 만. */
  backgroundImage?: BackgroundImage;
  objects: LayoutObject[];
}

/** 알려진 LayoutObject.type 들. 신규 타입 추가 시 여기도 갱신. */
const KNOWN_OBJECT_TYPES = new Set<string>([
  "photo",
  "text",
  "rect",
  "clipart",
]);

/** 런타임 가드 — M3 에디터 로드 시 신뢰 경계 확인용. */
export function isPageDoc(v: unknown): v is PageDoc {
  if (!v || typeof v !== "object") return false;
  const d = v as Partial<PageDoc>;
  if (
    d.version !== PAGEDOC_VERSION ||
    typeof d.bookSizeId !== "string" ||
    typeof d.pageNo !== "number" ||
    typeof d.widthMm !== "number" ||
    typeof d.heightMm !== "number" ||
    d.bleedMm !== 2 ||
    !Array.isArray(d.objects)
  ) {
    return false;
  }
  // 알려지지 않은 type 만 reject — 기존 photo/text/rect/clipart 는 모두 통과.
  for (const obj of d.objects) {
    if (!obj || typeof obj !== "object") return false;
    const t = (obj as { type?: unknown }).type;
    if (typeof t !== "string" || !KNOWN_OBJECT_TYPES.has(t)) return false;
  }
  return true;
}

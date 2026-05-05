import { COLLAGE_TEMPLATES, type CollageTemplateId } from "./collage";

/**
 * UI 템플릿 선택기에 뿌릴 메타.
 *   - previewSvg 는 viewBox 0 0 100 100 기준 경량 SVG 마크업.
 *   - 실제 배치 로직은 collage.ts / polaroid.ts 가 담당.
 */
export interface CollageTemplateMeta {
  id: CollageTemplateId;
  label: string;
  slotCount: number;
  previewSvg: string;
}

/** SVG 썸네일 생성 — 슬롯 좌표를 0..100 viewBox 에 매핑 + gap 시각화. */
function buildPreviewSvg(id: CollageTemplateId): string {
  const tpl = COLLAGE_TEMPLATES[id];
  const PAD = 6;
  const GAP = 2;
  const inner = 100 - PAD * 2;
  const rects = tpl.slots
    .map((s) => {
      const x = PAD + s.x * inner + GAP / 2;
      const y = PAD + s.y * inner + GAP / 2;
      const w = s.w * inner - GAP;
      const h = s.h * inner - GAP;
      return `<rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${w.toFixed(2)}" height="${h.toFixed(2)}" rx="1.2" ry="1.2" fill="#c9c2b3" />`;
    })
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" aria-hidden="true"><rect width="100" height="100" fill="#f8f5f0"/>${rects}</svg>`;
}

export const COLLAGE_TEMPLATE_META: CollageTemplateMeta[] = [
  {
    id: "collage-2v",
    label: "좌우 2분할",
    slotCount: 2,
    previewSvg: buildPreviewSvg("collage-2v"),
  },
  {
    id: "collage-2h",
    label: "상하 2분할",
    slotCount: 2,
    previewSvg: buildPreviewSvg("collage-2h"),
  },
  {
    id: "collage-3a",
    label: "큰 1 + 작은 2",
    slotCount: 3,
    previewSvg: buildPreviewSvg("collage-3a"),
  },
  {
    id: "collage-3v",
    label: "세로 3분할",
    slotCount: 3,
    previewSvg: buildPreviewSvg("collage-3v"),
  },
  {
    id: "collage-4",
    label: "2×2 그리드",
    slotCount: 4,
    previewSvg: buildPreviewSvg("collage-4"),
  },
  {
    id: "collage-6",
    label: "3×2 그리드",
    slotCount: 6,
    previewSvg: buildPreviewSvg("collage-6"),
  },
];

export const DEFAULT_COLLAGE_TEMPLATE: CollageTemplateId = "collage-4";

/** 안전한 CollageTemplateId 파싱. */
export function asCollageTemplateId(v: string): CollageTemplateId | null {
  return (v in COLLAGE_TEMPLATES ? (v as CollageTemplateId) : null);
}

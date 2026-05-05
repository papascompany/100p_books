/**
 * 드래그 중 정렬 가이드 + 자석 효과.
 *
 * 객체의 좌/중앙/우, 상/중앙/하 가장자리가
 * 캔버스 중심선 또는 다른 객체의 동일 가장자리와 일치하면
 *  - threshold(기본 4px) 이내 위치를 강제로 스냅
 *  - 시각 가이드 라인을 캔버스 위 오버레이로 표시
 *
 * 회전된 객체는 bounding rect 의 X/Y 축 정렬만 고려.
 */

import type * as fabric from "fabric";

export interface SnapOpts {
  thresholdPx?: number;
  guideColor?: string;
}

export interface SnapDetacher {
  detach: () => void;
}

interface ObjectBounds {
  left: number;
  centerX: number;
  right: number;
  top: number;
  centerY: number;
  bottom: number;
}

export function attachSnapGuides(
  canvas: fabric.Canvas,
  opts: SnapOpts = {},
): SnapDetacher {
  const threshold = opts.thresholdPx ?? 4;
  const color = opts.guideColor ?? "#f43f5e"; // rose-500

  const verticals: number[] = []; // x 좌표
  const horizontals: number[] = []; // y 좌표

  function onMoving(e: { target?: fabric.FabricObject }) {
    verticals.length = 0;
    horizontals.length = 0;

    const target = e.target;
    if (!target) return;

    const tBounds = bounds(target);
    if (!tBounds) return;

    const cw = canvas.getWidth();
    const ch = canvas.getHeight();

    // 캔버스 중심선
    const targetsX = [cw / 2];
    const targetsY = [ch / 2];

    // 다른 객체 가장자리/중심
    for (const obj of canvas.getObjects()) {
      if (obj === target) continue;
      const b = bounds(obj);
      if (!b) continue;
      targetsX.push(b.left, b.centerX, b.right);
      targetsY.push(b.top, b.centerY, b.bottom);
    }

    // X 축 정렬
    const xCandidates = [tBounds.left, tBounds.centerX, tBounds.right];
    let bestDx: number | null = null;
    let bestXMatch: number | null = null;
    for (const tx of targetsX) {
      for (const cx of xCandidates) {
        const d = tx - cx;
        if (Math.abs(d) <= threshold) {
          if (bestDx === null || Math.abs(d) < Math.abs(bestDx)) {
            bestDx = d;
            bestXMatch = tx;
          }
        }
      }
    }
    if (bestDx !== null && bestXMatch !== null) {
      target.set({ left: (target.left ?? 0) + bestDx });
      verticals.push(bestXMatch);
    }

    // Y 축 정렬
    const yCandidates = [tBounds.top, tBounds.centerY, tBounds.bottom];
    let bestDy: number | null = null;
    let bestYMatch: number | null = null;
    for (const ty of targetsY) {
      for (const cy of yCandidates) {
        const d = ty - cy;
        if (Math.abs(d) <= threshold) {
          if (bestDy === null || Math.abs(d) < Math.abs(bestDy)) {
            bestDy = d;
            bestYMatch = ty;
          }
        }
      }
    }
    if (bestDy !== null && bestYMatch !== null) {
      target.set({ top: (target.top ?? 0) + bestDy });
      horizontals.push(bestYMatch);
    }

    target.setCoords();
    canvas.requestRenderAll();
  }

  function onMovedOrUp() {
    verticals.length = 0;
    horizontals.length = 0;
    canvas.requestRenderAll();
  }

  function onAfterRender() {
    if (verticals.length === 0 && horizontals.length === 0) return;
    const ctx = canvas.getSelectionContext?.() ?? canvas.contextTop;
    if (!ctx) return;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    const cw = canvas.getWidth();
    const ch = canvas.getHeight();
    for (const x of verticals) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, ch);
      ctx.stroke();
    }
    for (const y of horizontals) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(cw, y);
      ctx.stroke();
    }
    ctx.restore();
  }

  // Fabric v6 의 object:moving 페이로드는 BasicTransformEvent — 타입 우회.
  (canvas as unknown as { on: (ev: string, fn: (e: { target?: fabric.FabricObject }) => void) => void }).on("object:moving", onMoving);
  canvas.on("object:modified", onMovedOrUp);
  canvas.on("mouse:up", onMovedOrUp);
  canvas.on("after:render", onAfterRender);

  return {
    detach: () => {
      (canvas as unknown as { off: (ev: string, fn: (e: { target?: fabric.FabricObject }) => void) => void }).off("object:moving", onMoving);
      canvas.off("object:modified", onMovedOrUp);
      canvas.off("mouse:up", onMovedOrUp);
      canvas.off("after:render", onAfterRender);
      verticals.length = 0;
      horizontals.length = 0;
    },
  };
}

function bounds(obj: fabric.FabricObject): ObjectBounds | null {
  const w = (obj.width ?? 0) * (obj.scaleX ?? 1);
  const h = (obj.height ?? 0) * (obj.scaleY ?? 1);
  if (!w || !h) return null;
  // origin = center 가정 (FabricStage 가 모든 객체에 적용)
  const cx = obj.left ?? 0;
  const cy = obj.top ?? 0;
  return {
    left: cx - w / 2,
    centerX: cx,
    right: cx + w / 2,
    top: cy - h / 2,
    centerY: cy,
    bottom: cy + h / 2,
  };
}

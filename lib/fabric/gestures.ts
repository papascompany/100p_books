/**
 * 모바일/데스크톱 통합 제스처 레이어.
 *
 * 1손가락:    Fabric 기본 (객체 선택/드래그)
 * 2손가락:    핀치 줌 (0.5x ~ 4x), 회전(선택 객체)
 * 길게 누르기: 500ms — 컨텍스트 메뉴 (onLongPress 콜백)
 * 키보드:     Delete/Backspace, 화살표 1mm 이동(Shift=10mm), Cmd/Ctrl+Z, Cmd/Ctrl+Shift+Z
 *
 * 정리:
 *   const detach = attachGestures(canvas, opts);
 *   ... 컴포넌트 unmount 시
 *   detach();
 */

import * as fabric from "fabric";

import type { TaggedFabricObject } from "./serialize";

export interface GestureOpts {
  /** mm → px 헬퍼. mm 기준 키보드 이동 등에서 사용. */
  mmToPx: (mm: number) => number;
  /** 줌 한계 — 디폴트 0.5 ~ 4. */
  minZoom?: number;
  maxZoom?: number;
  /** 길게 누르기 콜백. (target 은 클릭된 객체 또는 null) */
  onLongPress?: (
    target: TaggedFabricObject | null,
    clientX: number,
    clientY: number,
  ) => void;
  /** 외부 Undo/Redo 트리거 — 키보드 단축키 라우팅. */
  onUndo?: () => void;
  onRedo?: () => void;
  /** 캔버스 컨테이너 — Pointer events 부착 대상 (캔버스 wrapper). */
  container: HTMLElement;
}

const LONG_PRESS_MS = 500;
const SNAP_MOVE_THRESHOLD_PX = 6; // 길게 누르기 도중 이 이상 움직이면 취소

interface ActivePointer {
  id: number;
  x: number;
  y: number;
}

/**
 * 캔버스에 제스처 + 키보드 핸들러 부착. 정리 함수 반환.
 */
export function attachGestures(
  canvas: fabric.Canvas,
  opts: GestureOpts,
): () => void {
  const minZoom = opts.minZoom ?? 0.5;
  const maxZoom = opts.maxZoom ?? 4;
  const el = opts.container;

  const pointers = new Map<number, ActivePointer>();
  let pinchStartDist = 0;
  let pinchStartZoom = 1;
  let pinchCenter = { x: 0, y: 0 };
  let pinchStartAngle = 0;
  let rotateStartAngle = 0;
  let rotateTarget: TaggedFabricObject | null = null;

  let longPressTimer: ReturnType<typeof setTimeout> | null = null;
  let longPressOrigin: { x: number; y: number } | null = null;

  function clearLongPress() {
    if (longPressTimer) {
      clearTimeout(longPressTimer);
      longPressTimer = null;
    }
    longPressOrigin = null;
  }

  function onPointerDown(e: PointerEvent) {
    pointers.set(e.pointerId, {
      id: e.pointerId,
      x: e.clientX,
      y: e.clientY,
    });

    if (pointers.size === 1) {
      // 길게 누르기 타이머 시작
      longPressOrigin = { x: e.clientX, y: e.clientY };
      longPressTimer = setTimeout(() => {
        longPressTimer = null;
        const target =
          (canvas.findTarget(e) as TaggedFabricObject | undefined) ?? null;
        opts.onLongPress?.(target, e.clientX, e.clientY);
      }, LONG_PRESS_MS);
    }

    if (pointers.size === 2) {
      clearLongPress();
      const arr = Array.from(pointers.values());
      const a = arr[0]!;
      const b = arr[1]!;
      pinchStartDist = dist(a, b);
      pinchStartZoom = canvas.getZoom();
      pinchCenter = midpoint(a, b);
      pinchStartAngle = angleDeg(a, b);
      // 활성 객체 회전 대상 캡처 (있을 때만)
      const active = canvas.getActiveObject() as TaggedFabricObject | null;
      rotateTarget = active ?? null;
      rotateStartAngle = active?.angle ?? 0;
      // 두 손가락 동안엔 객체 드래그 차단 — 캔버스 panning 방지
      canvas.discardActiveObject();
    }
  }

  function onPointerMove(e: PointerEvent) {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, {
      id: e.pointerId,
      x: e.clientX,
      y: e.clientY,
    });

    // 길게 누르기 이동 임계 초과 시 취소
    if (longPressTimer && longPressOrigin) {
      const dx = e.clientX - longPressOrigin.x;
      const dy = e.clientY - longPressOrigin.y;
      if (Math.hypot(dx, dy) > SNAP_MOVE_THRESHOLD_PX) {
        clearLongPress();
      }
    }

    if (pointers.size === 2) {
      const arr = Array.from(pointers.values());
      const a = arr[0]!;
      const b = arr[1]!;
      const d = dist(a, b);
      if (pinchStartDist > 0) {
        const ratio = d / pinchStartDist;
        const target = clamp(pinchStartZoom * ratio, minZoom, maxZoom);
        // 두 손가락 중점 기준 줌 — fabric.Point
        const center = midpoint(a, b);
        canvas.zoomToPoint(new fabric.Point(center.x, center.y), target);
      }
      // 회전: 활성 객체에 한해 — pinch 와 동시에 적용
      if (rotateTarget) {
        const ang = angleDeg(a, b);
        const delta = ang - pinchStartAngle;
        rotateTarget.set({ angle: rotateStartAngle + delta });
        rotateTarget.setCoords();
        canvas.requestRenderAll();
      }
      void pinchCenter;
    }
  }

  function onPointerUp(e: PointerEvent) {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) {
      pinchStartDist = 0;
      rotateTarget = null;
    }
    if (pointers.size === 0) {
      clearLongPress();
    }
  }

  function onPointerCancel(e: PointerEvent) {
    pointers.delete(e.pointerId);
    clearLongPress();
    pinchStartDist = 0;
    rotateTarget = null;
  }

  el.addEventListener("pointerdown", onPointerDown);
  el.addEventListener("pointermove", onPointerMove);
  el.addEventListener("pointerup", onPointerUp);
  el.addEventListener("pointercancel", onPointerCancel);
  el.addEventListener("pointerleave", onPointerUp);

  // ---------- 키보드 ----------
  function onKeyDown(e: KeyboardEvent) {
    // 텍스트 편집 중이면 키보드 단축키 적용 X (편집 우선)
    const tgt = e.target as HTMLElement | null;
    if (tgt && tgt.matches?.("input, textarea, [contenteditable=true]")) return;

    const active = canvas.getActiveObject() as TaggedFabricObject | null;

    // Undo / Redo
    const meta = e.metaKey || e.ctrlKey;
    if (meta && e.key.toLowerCase() === "z") {
      e.preventDefault();
      if (e.shiftKey) opts.onRedo?.();
      else opts.onUndo?.();
      return;
    }
    if (meta && e.key.toLowerCase() === "y") {
      e.preventDefault();
      opts.onRedo?.();
      return;
    }

    if (!active) return;

    // 텍스트박스 편집 모드면 화살표/Delete 는 텍스트 편집에 위임
    const tb = active as fabric.Textbox;
    if (
      typeof (tb as fabric.Textbox).isEditing === "boolean" &&
      (tb as fabric.Textbox).isEditing
    ) {
      return;
    }

    if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      canvas.remove(active);
      canvas.discardActiveObject();
      canvas.requestRenderAll();
      return;
    }

    const stepMm = e.shiftKey ? 10 : 1;
    const stepPx = opts.mmToPx(stepMm);
    let dx = 0;
    let dy = 0;
    if (e.key === "ArrowLeft") dx = -stepPx;
    else if (e.key === "ArrowRight") dx = stepPx;
    else if (e.key === "ArrowUp") dy = -stepPx;
    else if (e.key === "ArrowDown") dy = stepPx;
    if (dx !== 0 || dy !== 0) {
      e.preventDefault();
      active.set({
        left: (active.left ?? 0) + dx,
        top: (active.top ?? 0) + dy,
      });
      active.setCoords();
      canvas.requestRenderAll();
      // history 에 알리기 위해 modified 이벤트 발행
      canvas.fire("object:modified", { target: active });
    }
  }
  window.addEventListener("keydown", onKeyDown);

  return () => {
    el.removeEventListener("pointerdown", onPointerDown);
    el.removeEventListener("pointermove", onPointerMove);
    el.removeEventListener("pointerup", onPointerUp);
    el.removeEventListener("pointercancel", onPointerCancel);
    el.removeEventListener("pointerleave", onPointerUp);
    window.removeEventListener("keydown", onKeyDown);
    clearLongPress();
    pointers.clear();
  };
}

function dist(a: { x: number; y: number }, b: { x: number; y: number }) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function midpoint(a: { x: number; y: number }, b: { x: number; y: number }) {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function angleDeg(a: { x: number; y: number }, b: { x: number; y: number }) {
  return (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
}

function clamp(v: number, lo: number, hi: number) {
  return Math.min(Math.max(v, lo), hi);
}

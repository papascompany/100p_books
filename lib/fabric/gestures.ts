/**
 * 모바일/데스크톱 통합 제스처 레이어.
 *
 * 1손가락:    Fabric 기본 (객체 선택/드래그)
 * 2손가락:    핀치 줌 (0.5x ~ 4x), 팬(중점 이동), 회전(선택 객체)
 * 더블탭:     빈 영역 더블탭 — 줌/팬 리셋 (100% 맞춤)
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
const TAP_MAX_MS = 300; // 이 시간 안에 떼야 탭으로 인정
const DOUBLE_TAP_MS = 350; // 두 탭(release 기준) 사이 최대 간격
const DOUBLE_TAP_DIST_PX = 30; // 두 탭 사이 최대 거리

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
  let pinchCenter = { x: 0, y: 0 }; // 직전 midpoint (client 좌표) — 2-finger 팬 기준점
  let pinchStartAngle = 0;
  let rotateStartAngle = 0;
  let rotateTarget: TaggedFabricObject | null = null;
  let pinchRotated = false; // 이번 제스처에서 회전이 실제 적용됐는지

  let longPressTimer: ReturnType<typeof setTimeout> | null = null;
  let longPressOrigin: { x: number; y: number } | null = null;

  // 더블탭 감지 상태
  let wasPinch = false; // 이번 터치 시퀀스에 2-finger 가 개입했는지
  let tapCandidate: { x: number; y: number; t: number; moved: boolean } | null =
    null;
  let lastTap: { x: number; y: number; t: number } | null = null;

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
      wasPinch = false;
      tapCandidate = {
        x: e.clientX,
        y: e.clientY,
        t: performance.now(),
        moved: false,
      };
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
      wasPinch = true;
      tapCandidate = null;
      const arr = Array.from(pointers.values());
      const a = arr[0]!;
      const b = arr[1]!;
      pinchStartDist = dist(a, b);
      pinchStartZoom = canvas.getZoom();
      pinchCenter = midpoint(a, b);
      pinchStartAngle = angleDeg(a, b);
      pinchRotated = false;
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

    // 탭 후보 — 임계 초과 이동 시 더블탭 대상에서 제외
    if (tapCandidate && !tapCandidate.moved) {
      const dx = e.clientX - tapCandidate.x;
      const dy = e.clientY - tapCandidate.y;
      if (Math.hypot(dx, dy) > SNAP_MOVE_THRESHOLD_PX) {
        tapCandidate.moved = true;
      }
    }

    if (pointers.size === 2) {
      const arr = Array.from(pointers.values());
      const a = arr[0]!;
      const b = arr[1]!;
      const d = dist(a, b);
      const center = midpoint(a, b);
      if (pinchStartDist > 0) {
        // client 좌표 → 캔버스 상대 좌표 변환 배율 (CSS 축소 표시 보정 포함)
        const rect = canvas.upperCanvasEl.getBoundingClientRect();
        const sx = rect.width > 0 ? canvas.getWidth() / rect.width : 1;
        const sy = rect.height > 0 ? canvas.getHeight() / rect.height : 1;

        const ratio = d / pinchStartDist;
        const target = clamp(pinchStartZoom * ratio, minZoom, maxZoom);
        // 두 손가락 중점 기준 줌 — 캔버스 엘리먼트 상대 좌표로 변환해 앵커 고정
        canvas.zoomToPoint(
          new fabric.Point(
            (center.x - rect.left) * sx,
            (center.y - rect.top) * sy,
          ),
          target,
        );

        // 2-finger 팬 — 중점 이동분만큼 viewport 이동
        const panDx = (center.x - pinchCenter.x) * sx;
        const panDy = (center.y - pinchCenter.y) * sy;
        if (panDx !== 0 || panDy !== 0) {
          canvas.relativePan(new fabric.Point(panDx, panDy));
        }
      }
      pinchCenter = center;
      // 회전: 활성 객체에 한해 — pinch 와 동시에 적용
      if (rotateTarget) {
        const ang = angleDeg(a, b);
        const delta = ang - pinchStartAngle;
        if (delta !== 0) pinchRotated = true;
        rotateTarget.set({ angle: rotateStartAngle + delta });
        rotateTarget.setCoords();
        canvas.requestRenderAll();
      }
    }
  }

  /** 핀치 종료 — 회전이 실제 발생했으면 히스토리/dirty 반영 후 상태 정리. */
  function endPinch() {
    if (rotateTarget && pinchRotated) {
      // 키보드 이동과 동일 패턴 — history push + setDirty 트리거
      canvas.fire("object:modified", { target: rotateTarget });
    }
    pinchStartDist = 0;
    rotateTarget = null;
    pinchRotated = false;
  }

  /** 마지막 손가락 release — 더블탭(빈 영역) 시 줌/팬 리셋. */
  function handleTapEnd(e: PointerEvent) {
    const now = performance.now();
    const cand = tapCandidate;
    tapCandidate = null;
    if (wasPinch || !cand || cand.moved || now - cand.t > TAP_MAX_MS) return;

    if (
      lastTap &&
      now - lastTap.t < DOUBLE_TAP_MS &&
      Math.hypot(cand.x - lastTap.x, cand.y - lastTap.y) < DOUBLE_TAP_DIST_PX
    ) {
      lastTap = null;
      // 객체 위 더블탭(텍스트 편집 진입 등)은 Fabric 기본 동작에 위임
      const target = canvas.findTarget(e);
      if (!target) {
        canvas.setViewportTransform([1, 0, 0, 1, 0, 0]);
        canvas.requestRenderAll();
      }
    } else {
      lastTap = { x: cand.x, y: cand.y, t: now };
    }
  }

  function onPointerUp(e: PointerEvent) {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) {
      endPinch();
    }
    if (pointers.size === 0) {
      clearLongPress();
      handleTapEnd(e);
    }
  }

  function onPointerCancel(e: PointerEvent) {
    pointers.delete(e.pointerId);
    clearLongPress();
    // cancel 이어도 이미 적용된 회전은 객체에 남으므로 동일하게 기록
    endPinch();
    tapCandidate = null;
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

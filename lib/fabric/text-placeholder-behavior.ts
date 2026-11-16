/**
 * 텍스트 안내 문구(placeholder) 편집 동작 — 캔버스 단위로 연결한다.
 *
 * 객체마다 리스너를 달지 않는 이유: undo/redo 는 스냅샷에서 객체를 새로 만들기 때문에
 * 객체 리스너가 사라진다. 상태(placeholderText·placeholderActive·realFill)는
 * FABRIC_EXTRA_PROPS 로 스냅샷에 보존되고, 동작은 여기서 캔버스 이벤트로 처리한다.
 *
 *  - 편집 시작: 안내 문구가 떠 있으면 전체 선택 → 첫 입력이 문구를 덮어쓴다.
 *  - 입력: 문구와 달라지면 안내 상태를 끝내고 실제 글자색으로 바꾼다.
 *  - 편집 종료: 글을 모두 지웠으면 안내 문구를 다시 흐리게 보여 준다.
 * 저장 시 변환은 serialize.ts savedTextAndFill 이 맡는다.
 *
 * 서버 import 금지 — 클라이언트 전용(fabric).
 */

import type * as fabric from "fabric";

import {
  DEFAULT_TEXT_FILL,
  PLACEHOLDER_TEXT_FILL,
} from "@/lib/layout/text-placeholder";

import type { TaggedFabricObject } from "./serialize";

type PlaceholderTextbox = fabric.IText & TaggedFabricObject;

function asPlaceholderTextbox(target: unknown): PlaceholderTextbox | null {
  const t = target as PlaceholderTextbox | null | undefined;
  if (!t || t.oType !== "text" || typeof t.placeholderText !== "string") {
    return null;
  }
  return t;
}

/** 편집 시작 — 안내 문구를 전체 선택해 첫 입력이 덮어쓰게 한다. */
export function onPlaceholderEditingEntered(target: unknown): void {
  const t = asPlaceholderTextbox(target);
  if (!t || !t.placeholderActive || t.text !== t.placeholderText) return;
  t.selectAll();
}

/** 입력 — 안내 문구가 아닌 글이 되면 실제 글자색으로. 바뀌었으면 true. */
export function onPlaceholderTextChanged(target: unknown): boolean {
  const t = asPlaceholderTextbox(target);
  if (!t || !t.placeholderActive || t.text === t.placeholderText) return false;
  t.placeholderActive = false;
  t.set({ fill: t.realFill ?? DEFAULT_TEXT_FILL });
  return true;
}

/** 편집 종료 — 비었으면 안내 문구를 다시 보여 준다. 바뀌었으면 true. */
export function onPlaceholderEditingExited(target: unknown): boolean {
  const t = asPlaceholderTextbox(target);
  if (!t || (t.text ?? "").trim().length > 0) return false;
  if (typeof t.fill === "string" && t.fill !== PLACEHOLDER_TEXT_FILL) {
    t.realFill = t.fill;
  }
  t.set({ text: t.placeholderText, fill: PLACEHOLDER_TEXT_FILL });
  t.placeholderActive = true;
  return true;
}

/** 캔버스에 연결. 반환 함수로 해제. */
export function attachTextPlaceholderBehavior(canvas: fabric.Canvas): () => void {
  const entered = (e: { target: unknown }) => onPlaceholderEditingEntered(e.target);
  const changed = (e: { target: unknown }) => {
    if (onPlaceholderTextChanged(e.target)) canvas.requestRenderAll();
  };
  const exited = (e: { target: unknown }) => {
    if (onPlaceholderEditingExited(e.target)) canvas.requestRenderAll();
  };
  canvas.on("text:editing:entered", entered);
  canvas.on("text:changed", changed);
  canvas.on("text:editing:exited", exited);
  return () => {
    canvas.off("text:editing:entered", entered);
    canvas.off("text:changed", changed);
    canvas.off("text:editing:exited", exited);
  };
}

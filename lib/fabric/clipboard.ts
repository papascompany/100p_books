/**
 * Fabric 객체용 클립보드 매니저 (단일 페이지 + 페이지 간).
 *
 * - 모듈 레벨 싱글톤 → 페이지 라우트 사이를 이동해도 동일 메모리 보존
 *   (단, 풀 리로드 시 휘발 — 의도된 동작).
 * - PageDoc 의 LayoutObject 단위로 직렬화 (mm/pt 좌표) — fabric.toJSON 형식 X.
 * - paste 시 새 objectId 부여 + 위치 +5mm offset.
 *
 * 서버 전용 import 금지 — 클라 only.
 */

import type * as fabric from "fabric";
import { nanoid } from "nanoid";

import type {
  ClipartObject,
  LayoutObject,
  PhotoObject,
  RectObject,
  TextObject,
} from "@/lib/layout/types";

import {
  fabricToPageDoc,
  mmToPx,
  type PageDocMeta,
  type TaggedFabricObject,
} from "./serialize";

/** paste 시 적용되는 좌표 offset (mm). */
export const PASTE_OFFSET_MM = 5;

/**
 * 클립보드 보존용 — 각 LayoutObject 종류에서 objectId 만 제외한 분기형 유니온.
 * `Omit<Union, K>` 는 discriminated union narrowing 을 깨뜨리므로 분기별로 명시.
 */
export type ClipboardLayoutData =
  | Omit<PhotoObject, "objectId">
  | Omit<TextObject, "objectId">
  | Omit<RectObject, "objectId">
  | Omit<ClipartObject, "objectId">;

export interface ClipboardSnapshot {
  /** 복사된 LayoutObject (objectId 제외). 분기별 narrowing 보존. */
  data: ClipboardLayoutData;
  copiedAt: number;
}

class FabricClipboard {
  private snapshot: ClipboardSnapshot | null = null;
  /** 가장 최근 페이지에서 복사된 객체의 src 인지 단순 표지(디버깅용). */
  private lastSourcePage?: string;

  get hasContent(): boolean {
    return this.snapshot !== null;
  }

  /**
   * 현재 캔버스의 활성 객체를 PageDoc 객체로 직렬화해 클립보드에 보존.
   *  - 캔버스의 bleed 보정은 호출자가 보정한 좌표를 넘긴다는 가정.
   *  - 여기서는 단일 객체만 다룸 (fabricToPageDoc 의 단일 항목 직렬화 재사용).
   */
  copy(
    obj: TaggedFabricObject,
    dpi: number,
    bleedMm: number,
    sourcePageId?: string,
  ): ClipboardSnapshot | null {
    if (!obj || !obj.oType) return null;

    // bleed 보정 — fabricToPageDoc 는 페이지 좌표계(trim 기준) 가정.
    const bleedPx = mmToPx(bleedMm, dpi);
    const origLeft = obj.left ?? 0;
    const origTop = obj.top ?? 0;
    obj.set({ left: origLeft - bleedPx, top: origTop - bleedPx });

    // mock 단일 객체 캔버스로 직렬화
    const meta: PageDocMeta = {
      version: "1",
      bookSizeId: "clipboard",
      pageNo: 0,
      layoutMode: "polaroid",
      widthMm: 0,
      heightMm: 0,
      bleedMm: 2,
      backgroundColor: "#ffffff",
    };
    const fakeCanvas = {
      getObjects: () => [obj],
    } as unknown as fabric.Canvas;
    const doc = fabricToPageDoc(fakeCanvas, meta, dpi);

    // 좌표 복원
    obj.set({ left: origLeft, top: origTop });

    if (doc.objects.length === 0) return null;
    const layoutObj = doc.objects[0]!;
    // objectId 제외하고 보존 — paste 시 새로 부여.
    const { objectId: _omit, ...rest } = layoutObj;
    void _omit;
    const snapshot: ClipboardSnapshot = {
      data: rest as ClipboardLayoutData,
      copiedAt: Date.now(),
    };
    this.snapshot = snapshot;
    this.lastSourcePage = sourcePageId;
    return snapshot;
  }

  /**
   * 마지막으로 복사된 객체를 PageDoc 좌표계로 반환.
   *  - 새 objectId 자동 부여.
   *  - leftMm/topMm 에 PASTE_OFFSET_MM 추가.
   */
  read(): LayoutObject | null {
    if (!this.snapshot) return null;
    // ClipboardLayoutData 모든 분기는 leftMm/topMm 을 보유.
    const data = this.snapshot.data;
    const cloned: LayoutObject = {
      ...data,
      objectId: nanoid(12),
      leftMm: data.leftMm + PASTE_OFFSET_MM,
      topMm: data.topMm + PASTE_OFFSET_MM,
    } as LayoutObject;
    // 다음 paste 도 동일한 source 에서 누적되지 않도록 snapshot 자체의 좌표를
    // 갱신해 두면 사용자가 연속 paste 시 계단처럼 흩뿌릴 수 있다.
    this.snapshot.data = {
      ...data,
      leftMm: data.leftMm + PASTE_OFFSET_MM,
      topMm: data.topMm + PASTE_OFFSET_MM,
    } as ClipboardLayoutData;
    return cloned;
  }

  /** 디버그 — 현재 스냅샷 (테스트용). */
  peek(): ClipboardSnapshot | null {
    return this.snapshot;
  }

  clear(): void {
    this.snapshot = null;
    this.lastSourcePage = undefined;
  }

  /** 디버그 — 마지막 source 페이지 ID. */
  getSourcePage(): string | undefined {
    return this.lastSourcePage;
  }
}

/** 모듈 레벨 싱글톤. 페이지 간 복사를 위해 닫히지 않는 한 유지. */
export const fabricClipboard = new FabricClipboard();

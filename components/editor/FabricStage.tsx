"use client";

import * as fabric from "fabric";
import { nanoid } from "nanoid";
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";

import { attachGestures } from "@/lib/fabric/gestures";
import { HistoryStack, makeHistoryDebouncer } from "@/lib/fabric/history";
import {
  applyBackgroundImageToCanvas,
  FABRIC_EXTRA_PROPS,
  fabricToPageDoc,
  mmToPx,
  pageDocToFabric,
  ptToPx,
  type PageDocMeta,
  type TaggedFabricObject,
} from "@/lib/fabric/serialize";
import { attachSnapGuides } from "@/lib/fabric/snap";
import {
  applyPhotoUrlsToCanvas,
  startUrlRefresher,
} from "@/lib/fabric/url-refresher";
import type { LayoutObject, PageDoc } from "@/lib/layout/types";

/** 프리뷰 DPI 기본값. Architecture 합의: 미리보기 72, PDF 출력 300. */
export const PREVIEW_DPI = 72;

/**
 * setBackground 입력 타입.
 *  - 문자열은 후방 호환 (color shortcut, http(s)/data:/path 시 이미지로 시도).
 *  - 명시적 객체는 type 별 처리.
 *  - null 은 배경 제거 (단색은 #ffffff 로 리셋).
 */
export type SetBackgroundInput =
  | string
  | { type: "color"; color: string }
  | { type: "photo"; photoId: string; url: string }
  | { type: "resource"; url: string }
  | { type: "none" }
  | null;

export interface FabricStageHandle {
  loadDoc: (doc: PageDoc, photoUrls: Record<string, string>) => Promise<void>;
  serialize: (meta: PageDocMeta) => PageDoc;
  addPhoto: (photoId: string, url: string) => Promise<void>;
  addText: (opts?: {
    text?: string;
    fontFamily?: string;
    fontSizePt?: number;
    fill?: string;
  }) => void;
  addClipart: (url: string, resourceId?: string) => Promise<void>;
  /**
   * PageDoc.LayoutObject 를 캔버스에 붙여넣음.
   *  - photoUrls: photo 객체일 때 signed URL 매핑 (없으면 fallback rect).
   *  - 좌표는 PageDoc 의 trim 기준 → bleed 보정 자동 처리.
   *  - 새 활성 객체로 설정.
   */
  pasteLayoutObject: (
    obj: LayoutObject,
    photoUrls?: Record<string, string>,
  ) => Promise<void>;
  /** 현재 선택 객체 즉시 복제 (+5mm offset). */
  duplicateSelected: () => Promise<void>;
  /**
   * 현재 선택 객체가 PhotoObject 일 때 photoId/src 를 교체.
   * 위치/크기/회전/cropMode/borderRadius 는 유지.
   * 선택이 없거나 photo 가 아니면 no-op.
   */
  replacePhoto: (photoId: string, url: string) => Promise<void>;
  setBackground: (value: SetBackgroundInput) => void;
  undo: () => void;
  redo: () => void;
  remove: () => void;
  bringForward: () => void;
  sendBackward: () => void;
  getSelection: () => TaggedFabricObject | null;
  /** 외부 클립보드 등이 사용. */
  getDpi: () => number;
  getBleedMm: () => number;
  refreshPhotoUrls: (urls: Record<string, string>) => Promise<void>;
  canUndo: () => boolean;
  canRedo: () => boolean;
}

export interface FabricStageProps {
  /** 책 trim 폭/높이 (mm). */
  widthMm: number;
  heightMm: number;
  /** bleed (mm). 기본 2. */
  bleedMm?: number;
  /** 미리보기 DPI. */
  dpi?: number;
  /** 페이지 ID — url-refresher 용. */
  pageId?: string;
  /** 객체 선택/수정 콜백. */
  onSelectionChange?: (target: TaggedFabricObject | null) => void;
  onModified?: () => void;
  /** 길게 누르기 컨텍스트 메뉴 콜백. */
  onLongPress?: (
    target: TaggedFabricObject | null,
    x: number,
    y: number,
  ) => void;
  /** History 변동 알림 (UI 토글용). */
  onHistoryChange?: (canUndo: boolean, canRedo: boolean) => void;
  /** 캔버스 초기화 완료 — lazy load 시 doc 로딩 트리거용. 최초 1회만 발생. */
  onReady?: () => void;
  className?: string;
}

/**
 * 책 사이즈/DPI 인식 Fabric 캔버스 래퍼.
 *
 * - bleed 만큼 내부 캔버스를 크게 잡고, trim 영역 안쪽 2mm 에 안전선(점선) 표시.
 * - 캔버스 좌표 = (bleed + trim) * scale 기반 css px.
 * - 부모 박스 폭에 맞춰 viewport zoom 자동 fit (debounce 150ms).
 * - 모든 객체에 originX/Y = "center" 적용 (serialize 어댑터 규약).
 * - DPR 고려 (enableRetinaScaling).
 */
const FabricStage = forwardRef<FabricStageHandle, FabricStageProps>(
  function FabricStage(props, ref) {
    const {
      widthMm,
      heightMm,
      bleedMm = 2,
      dpi = PREVIEW_DPI,
      pageId,
      onSelectionChange,
      onModified,
      onLongPress,
      onHistoryChange,
      onReady,
      className,
    } = props;

    const wrapperRef = useRef<HTMLDivElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const canvasElRef = useRef<HTMLCanvasElement>(null);
    const canvasRef = useRef<fabric.Canvas | null>(null);
    const historyRef = useRef<HistoryStack>(new HistoryStack());
    const isRestoringRef = useRef(false);
    const [historyVersion, setHistoryVersion] = useState(0);

    // 콜백들을 ref 로 보관 — 캔버스 재초기화 빈도를 낮춘다.
    const onSelectionChangeRef = useRef(onSelectionChange);
    const onModifiedRef = useRef(onModified);
    const onLongPressRef = useRef(onLongPress);
    const onHistoryChangeRef = useRef(onHistoryChange);
    const onReadyRef = useRef(onReady);
    const readyCalledRef = useRef(false);
    useEffect(() => {
      onSelectionChangeRef.current = onSelectionChange;
    }, [onSelectionChange]);
    useEffect(() => {
      onModifiedRef.current = onModified;
    }, [onModified]);
    useEffect(() => {
      onLongPressRef.current = onLongPress;
    }, [onLongPress]);
    useEffect(() => {
      onHistoryChangeRef.current = onHistoryChange;
    }, [onHistoryChange]);
    useEffect(() => {
      onReadyRef.current = onReady;
    }, [onReady]);

    // 캔버스 논리 크기(px) — bleed 포함
    const stagePxSize = useMemo(() => {
      const w = mmToPx(widthMm + bleedMm * 2, dpi);
      const h = mmToPx(heightMm + bleedMm * 2, dpi);
      return { w, h };
    }, [widthMm, heightMm, bleedMm, dpi]);

    // ---------- Canvas 초기화 ----------
    useEffect(() => {
      const el = canvasElRef.current;
      const wrapper = wrapperRef.current;
      const container = containerRef.current;
      if (!el || !wrapper || !container) return;

      const canvas = new fabric.Canvas(el, {
        width: stagePxSize.w,
        height: stagePxSize.h,
        backgroundColor: "#f8f5f0",
        preserveObjectStacking: true,
        enableRetinaScaling: true,
        // 사용자 cs 안에서만 객체 선택
        selection: true,
        // 모바일 스크롤 충돌 방지: 캔버스 위 터치는 캔버스가 처리
        allowTouchScrolling: false,
      });
      canvasRef.current = canvas;

      // 기본 origin = center (serialize 어댑터 규약)
      fabric.FabricObject.prototype.originX = "center";
      fabric.FabricObject.prototype.originY = "center";

      // 이벤트
      const onSelectionUpdated = () => {
        const t = (canvas.getActiveObject() as TaggedFabricObject) ?? null;
        onSelectionChangeRef.current?.(t);
      };
      canvas.on("selection:created", onSelectionUpdated);
      canvas.on("selection:updated", onSelectionUpdated);
      canvas.on("selection:cleared", () =>
        onSelectionChangeRef.current?.(null),
      );

      // History push (debounced)
      const pushSnapshot = () => {
        if (isRestoringRef.current) return;
        const json = JSON.stringify((canvas as unknown as { toJSON: (props?: string[]) => unknown }).toJSON(FABRIC_EXTRA_PROPS as unknown as string[]));
        historyRef.current.push(json);
        setHistoryVersion((v) => v + 1);
        onHistoryChangeRef.current?.(
          historyRef.current.canUndo,
          historyRef.current.canRedo,
        );
        onModifiedRef.current?.();
      };
      const debouncedPush = makeHistoryDebouncer(pushSnapshot, 200);
      const handler = () => debouncedPush();
      canvas.on("object:modified", handler);
      canvas.on("object:added", handler);
      canvas.on("object:removed", handler);

      // 안전선 (점선) — chrome 객체 (oType 미부여 → 직렬화 제외)
      drawSafeLineOverlay(canvas, widthMm, heightMm, bleedMm, dpi);

      // 제스처 + 스냅
      const detachGestures = attachGestures(canvas, {
        container,
        mmToPx: (mm) => mmToPx(mm, dpi),
        onLongPress: (t, x, y) => onLongPressRef.current?.(t ?? null, x, y),
        onUndo: () => {
          const snap = historyRef.current.undo();
          if (snap) restoreFromSnapshot(canvas, snap);
          setHistoryVersion((v) => v + 1);
          onHistoryChangeRef.current?.(
            historyRef.current.canUndo,
            historyRef.current.canRedo,
          );
        },
        onRedo: () => {
          const snap = historyRef.current.redo();
          if (snap) restoreFromSnapshot(canvas, snap);
          setHistoryVersion((v) => v + 1);
          onHistoryChangeRef.current?.(
            historyRef.current.canUndo,
            historyRef.current.canRedo,
          );
        },
      });
      const snapHandle = attachSnapGuides(canvas);

      // 리사이즈: 부모 폭에 맞춰 viewport scale fit (debounce 150ms)
      let resizeTimer: ReturnType<typeof setTimeout> | null = null;
      const ro = new ResizeObserver(() => {
        if (resizeTimer) clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
          const w = wrapper.clientWidth;
          if (!w) return;
          const scale = Math.min(1, w / stagePxSize.w);
          const cssW = stagePxSize.w * scale;
          const cssH = stagePxSize.h * scale;
          const upperEl = canvas.upperCanvasEl;
          const lowerEl = canvas.lowerCanvasEl;
          if (upperEl && lowerEl) {
            upperEl.style.width = `${cssW}px`;
            upperEl.style.height = `${cssH}px`;
            lowerEl.style.width = `${cssW}px`;
            lowerEl.style.height = `${cssH}px`;
            const wrapperEl = canvas.wrapperEl;
            if (wrapperEl) {
              wrapperEl.style.width = `${cssW}px`;
              wrapperEl.style.height = `${cssH}px`;
            }
          }
        }, 150);
      });
      ro.observe(wrapper);

      // 최초 캔버스 초기화 완료 신호 (lazy-load 시 doc 로딩 트리거)
      if (!readyCalledRef.current) {
        readyCalledRef.current = true;
        onReadyRef.current?.();
      }

      return () => {
        if (resizeTimer) clearTimeout(resizeTimer);
        ro.disconnect();
        snapHandle.detach();
        detachGestures();
        canvas.off("object:modified", handler);
        canvas.off("object:added", handler);
        canvas.off("object:removed", handler);
        canvas.off();
        canvas.dispose();
        canvasRef.current = null;
      };
      // 의도적으로 stagePxSize 만 의존: 콜백은 ref 로 우회 → 캔버스 재초기화 빈도 최소화
    }, [stagePxSize, widthMm, heightMm, bleedMm, dpi]);

    // ---------- URL refresher ----------
    useEffect(() => {
      if (!pageId) return;
      const detach = startUrlRefresher({
        pageId,
        onRefresh: async (urls) => {
          const c = canvasRef.current;
          if (!c) return;
          await applyPhotoUrlsToCanvas(c, urls);
        },
      });
      return () => detach();
    }, [pageId]);

    // ---------- Imperative API ----------
    const loadDoc = useCallback(
      async (doc: PageDoc, photoUrls: Record<string, string>) => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        isRestoringRef.current = true;
        try {
          // 기존 사용자 객체 제거 (chrome 보존)
          const toRemove: fabric.FabricObject[] = canvas
            .getObjects()
            .filter((o) => (o as TaggedFabricObject).oType !== undefined);
          for (const o of toRemove) canvas.remove(o);

          canvas.backgroundColor = doc.backgroundColor;
          // backgroundImage 처리 — photoId 우선, 그다음 url.
          (canvas as unknown as { backgroundImage: unknown }).backgroundImage =
            undefined;
          if (doc.backgroundImage) {
            const url =
              (doc.backgroundImage.photoId &&
                photoUrls[doc.backgroundImage.photoId]) ||
              doc.backgroundImage.url;
            if (url) {
              await applyBackgroundImageToCanvas(
                canvas,
                {
                  url,
                  cropMode: doc.backgroundImage.cropMode,
                  opacity: doc.backgroundImage.opacity,
                },
                stagePxSize,
              );
            }
          }

          const objs = await pageDocToFabric(doc, {
            canvas,
            dpi,
            photoUrls,
          });
          // bleed 만큼 좌표 보정: PageDoc 좌표는 trim 기준 → 캔버스 좌표는 trim+bleed
          const bleedPx = mmToPx(bleedMm, dpi);
          for (const o of objs) {
            o.set({
              left: (o.left ?? 0) + bleedPx,
              top: (o.top ?? 0) + bleedPx,
            });
            canvas.add(o);
          }
          canvas.requestRenderAll();

          // 초기 스냅샷
          const json = JSON.stringify(
            (canvas as unknown as { toJSON: (props?: string[]) => unknown }).toJSON(FABRIC_EXTRA_PROPS as unknown as string[]),
          );
          historyRef.current.reset(json);
          setHistoryVersion((v) => v + 1);
          onHistoryChangeRef.current?.(
            historyRef.current.canUndo,
            historyRef.current.canRedo,
          );
        } finally {
          isRestoringRef.current = false;
        }
      },
      [bleedMm, dpi, stagePxSize],
    );

    const serialize = useCallback(
      (meta: PageDocMeta): PageDoc => {
        const canvas = canvasRef.current;
        if (!canvas) {
          return {
            ...meta,
            objects: [],
          };
        }
        // bleed 보정 역방향
        const bleedPx = mmToPx(bleedMm, dpi);
        // 전체 객체 left/top 에서 bleed 만큼 빼서 trim 좌표계로 변환 — 임시
        const all = canvas.getObjects() as TaggedFabricObject[];
        const restore: { o: TaggedFabricObject; left: number; top: number }[] =
          [];
        for (const o of all) {
          if (!o.oType) continue;
          restore.push({ o, left: o.left ?? 0, top: o.top ?? 0 });
          o.set({
            left: (o.left ?? 0) - bleedPx,
            top: (o.top ?? 0) - bleedPx,
          });
        }
        const doc = fabricToPageDoc(canvas, meta, dpi);
        // 복원
        for (const r of restore) {
          r.o.set({ left: r.left, top: r.top });
        }
        return doc;
      },
      [bleedMm, dpi],
    );

    const addPhoto = useCallback(
      async (photoId: string, url: string) => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const img = await fabric.FabricImage.fromURL(url, {
          crossOrigin: "anonymous",
        });
        // 캔버스 중앙 (bleed + trim/2)
        const cx = mmToPx(bleedMm + widthMm / 2, dpi);
        const cy = mmToPx(bleedMm + heightMm / 2, dpi);
        // 기본 사이즈 — trim 폭의 50%
        const targetW = mmToPx(widthMm * 0.5, dpi);
        const iw = img.width ?? 1;
        const ih = img.height ?? 1;
        const scale = targetW / iw;
        img.set({
          left: cx,
          top: cy,
          originX: "center",
          originY: "center",
          scaleX: scale,
          scaleY: scale,
        });
        const tagged = img as TaggedFabricObject;
        tagged.objectId = nanoid(12);
        tagged.oType = "photo";
        tagged.photoId = photoId;
        tagged.cropMode = "cover";
        tagged.originalWidthMm = widthMm * 0.5;
        tagged.originalHeightMm = (ih * scale * 25.4) / dpi;
        canvas.add(img);
        canvas.setActiveObject(img);
        canvas.requestRenderAll();
      },
      [bleedMm, dpi, widthMm, heightMm],
    );

    const addText = useCallback(
      (opts?: {
        text?: string;
        fontFamily?: string;
        fontSizePt?: number;
        fill?: string;
      }) => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const cx = mmToPx(bleedMm + widthMm / 2, dpi);
        const cy = mmToPx(bleedMm + heightMm / 2, dpi);
        const fontSizePt = opts?.fontSizePt ?? 14;
        const tb = new fabric.Textbox(opts?.text ?? "텍스트", {
          left: cx,
          top: cy,
          originX: "center",
          originY: "center",
          width: mmToPx(widthMm * 0.6, dpi),
          fontFamily: opts?.fontFamily ?? "Pretendard",
          fontSize: ptToPx(fontSizePt, dpi),
          fill: opts?.fill ?? "#2b2b2b",
          textAlign: "center",
          lineHeight: 1.4,
          editable: true,
        });
        const tagged = tb as TaggedFabricObject;
        tagged.objectId = nanoid(12);
        tagged.oType = "text";
        canvas.add(tb);
        canvas.setActiveObject(tb);
        canvas.requestRenderAll();
      },
      [bleedMm, dpi, widthMm, heightMm],
    );

    const addClipart = useCallback(
      async (url: string, resourceId?: string) => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const img = await fabric.FabricImage.fromURL(url, {
          crossOrigin: "anonymous",
        });
        const cx = mmToPx(bleedMm + widthMm / 2, dpi);
        const cy = mmToPx(bleedMm + heightMm / 2, dpi);
        const targetW = mmToPx(widthMm * 0.3, dpi);
        const iw = img.width ?? 1;
        const scale = targetW / iw;
        img.set({
          left: cx,
          top: cy,
          originX: "center",
          originY: "center",
          scaleX: scale,
          scaleY: scale,
        });
        // M11: ClipartObject 영속화 — oType="clipart", clipartSrc/resourceId 보존.
        const tagged = img as TaggedFabricObject;
        tagged.objectId = nanoid(12);
        tagged.oType = "clipart";
        tagged.clipartSrc = url;
        if (resourceId) tagged.resourceId = resourceId;
        const ih = img.height ?? 1;
        // contain 비율 — serialize 시 widthMm/heightMm 는 fabric box 스케일 결과 사용
        tagged.originalWidthMm = widthMm * 0.3;
        tagged.originalHeightMm = (ih * scale * 25.4) / dpi;
        canvas.add(img);
        canvas.setActiveObject(img);
        canvas.requestRenderAll();
      },
      [bleedMm, dpi, widthMm, heightMm],
    );

    const pasteLayoutObject = useCallback(
      async (obj: LayoutObject, photoUrls?: Record<string, string>) => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const built = await pageDocToFabric(
          {
            version: "1",
            bookSizeId: "paste",
            pageNo: 0,
            layoutMode: "polaroid",
            widthMm,
            heightMm,
            bleedMm: bleedMm as 2,
            backgroundColor: "#ffffff",
            objects: [obj],
          },
          {
            canvas,
            dpi,
            photoUrls: photoUrls ?? {},
          },
        );

        const bleedPx = mmToPx(bleedMm, dpi);
        for (const o of built) {
          o.set({
            left: (o.left ?? 0) + bleedPx,
            top: (o.top ?? 0) + bleedPx,
          });
          canvas.add(o);
          canvas.setActiveObject(o);
        }
        canvas.requestRenderAll();
      },
      [bleedMm, dpi, widthMm, heightMm],
    );

    const replacePhoto = useCallback(
      async (photoId: string, url: string) => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const sel = canvas.getActiveObject() as TaggedFabricObject | null;
        if (!sel || sel.oType !== "photo") return;

        const img = sel as fabric.FabricImage & TaggedFabricObject;

        // 위치/스케일/회전/origin 보존, source 만 교체.
        try {
          await img.setSrc(url, { crossOrigin: "anonymous" });
        } catch {
          // setSrc 실패 시 fromURL 로 새 객체 만들고 위치 복사.
          const next = await fabric.FabricImage.fromURL(url, {
            crossOrigin: "anonymous",
          });
          const props = {
            left: img.left,
            top: img.top,
            originX: img.originX,
            originY: img.originY,
            scaleX: img.scaleX,
            scaleY: img.scaleY,
            angle: img.angle,
            opacity: img.opacity,
          };
          next.set(props);
          const tagged = next as TaggedFabricObject;
          tagged.objectId = sel.objectId;
          tagged.oType = "photo";
          tagged.photoId = photoId;
          tagged.cropMode = sel.cropMode ?? "cover";
          tagged.borderRadiusMm = sel.borderRadiusMm;
          tagged.originalWidthMm = sel.originalWidthMm;
          tagged.originalHeightMm = sel.originalHeightMm;
          canvas.remove(sel);
          canvas.add(next);
          canvas.setActiveObject(next);
          canvas.requestRenderAll();
          return;
        }

        img.photoId = photoId;
        img.canvas?.fire("object:modified", { target: img });
        canvas.requestRenderAll();
      },
      [],
    );

    const duplicateSelected = useCallback(async () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const sel = canvas.getActiveObject() as TaggedFabricObject | null;
      if (!sel || !sel.oType) return;

      // 객체를 trim 기준 좌표로 임시 이동해 fabricToPageDoc 직렬화 후 paste.
      const bleedPx = mmToPx(bleedMm, dpi);
      const origLeft = sel.left ?? 0;
      const origTop = sel.top ?? 0;
      sel.set({ left: origLeft - bleedPx, top: origTop - bleedPx });
      const meta: PageDocMeta = {
        version: "1",
        bookSizeId: "duplicate",
        pageNo: 0,
        layoutMode: "polaroid",
        widthMm,
        heightMm,
        bleedMm: bleedMm as 2,
        backgroundColor: "#ffffff",
      };
      const fakeCanvas = {
        getObjects: () => [sel],
      } as unknown as fabric.Canvas;
      const doc = fabricToPageDoc(fakeCanvas, meta, dpi);
      sel.set({ left: origLeft, top: origTop });

      if (doc.objects.length === 0) return;
      const layoutObj = doc.objects[0]!;
      const DUP_OFFSET_MM = 5;
      const cloned = {
        ...layoutObj,
        objectId: "",
        leftMm: layoutObj.leftMm + DUP_OFFSET_MM,
        topMm: layoutObj.topMm + DUP_OFFSET_MM,
      } as LayoutObject;
      // 새 objectId 부여는 pageDocToFabric 가 보존하므로 직접 nanoid.
      cloned.objectId = nanoid(12);
      await pasteLayoutObject(cloned, {});
    }, [bleedMm, dpi, widthMm, heightMm, pasteLayoutObject]);

    const setBackground = useCallback(
      (value: SetBackgroundInput) => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const applyImage = (url: string, photoId?: string) => {
          void fabric.FabricImage.fromURL(url, {
            crossOrigin: "anonymous",
          }).then((img) => {
            const sx = stagePxSize.w / (img.width ?? 1);
            const sy = stagePxSize.h / (img.height ?? 1);
            img.set({
              originX: "left",
              originY: "top",
              left: 0,
              top: 0,
              scaleX: sx,
              scaleY: sy,
              selectable: false,
              evented: false,
            });
            // Stage 가 backgroundImage 메타를 보존하려면 별도 ref 필요 — 직렬화는
            // FabricStage 가 아닌 페이지 에디터에서 PageDoc.backgroundImage 로 처리.
            (img as unknown as { __bgPhotoId?: string }).__bgPhotoId = photoId;
            (img as unknown as { __bgUrl?: string }).__bgUrl = url;
            canvas.backgroundImage = img;
            canvas.requestRenderAll();
          });
        };

        const clearImage = () => {
          (canvas as unknown as { backgroundImage: unknown }).backgroundImage =
            undefined;
        };

        // null / { type: "none" } — 배경 제거 (흰색 채움)
        if (value === null || (typeof value === "object" && value.type === "none")) {
          canvas.backgroundColor = "#ffffff";
          clearImage();
          canvas.requestRenderAll();
          return;
        }

        if (typeof value === "string") {
          // 후방 호환 — color shortcut or url shortcut
          const looksLikeUrl =
            value.startsWith("http") ||
            value.startsWith("/") ||
            value.startsWith("data:");
          if (looksLikeUrl) {
            applyImage(value);
          } else {
            canvas.backgroundColor = value;
            clearImage();
            canvas.requestRenderAll();
          }
          return;
        }

        switch (value.type) {
          case "color":
            canvas.backgroundColor = value.color;
            clearImage();
            canvas.requestRenderAll();
            break;
          case "photo":
            applyImage(value.url, value.photoId);
            break;
          case "resource":
            applyImage(value.url);
            break;
        }
      },
      [stagePxSize],
    );

    const undo = useCallback(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const snap = historyRef.current.undo();
      if (!snap) return;
      restoreFromSnapshot(canvas, snap);
      setHistoryVersion((v) => v + 1);
      onHistoryChangeRef.current?.(
        historyRef.current.canUndo,
        historyRef.current.canRedo,
      );
    }, []);

    const redo = useCallback(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const snap = historyRef.current.redo();
      if (!snap) return;
      restoreFromSnapshot(canvas, snap);
      setHistoryVersion((v) => v + 1);
      onHistoryChangeRef.current?.(
        historyRef.current.canUndo,
        historyRef.current.canRedo,
      );
    }, []);

    const remove = useCallback(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const a = canvas.getActiveObject();
      if (!a) return;
      canvas.remove(a);
      canvas.discardActiveObject();
      canvas.requestRenderAll();
    }, []);

    const bringForward = useCallback(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const a = canvas.getActiveObject();
      if (!a) return;
      canvas.bringObjectForward(a);
      canvas.requestRenderAll();
    }, []);

    const sendBackward = useCallback(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const a = canvas.getActiveObject();
      if (!a) return;
      canvas.sendObjectBackwards(a);
      canvas.requestRenderAll();
    }, []);

    const getSelection = useCallback((): TaggedFabricObject | null => {
      const canvas = canvasRef.current;
      if (!canvas) return null;
      return (canvas.getActiveObject() as TaggedFabricObject) ?? null;
    }, []);

    const refreshPhotoUrls = useCallback(
      async (urls: Record<string, string>) => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        await applyPhotoUrlsToCanvas(canvas, urls);
      },
      [],
    );

    useImperativeHandle(
      ref,
      () => ({
        loadDoc,
        serialize,
        addPhoto,
        addText,
        addClipart,
        pasteLayoutObject,
        duplicateSelected,
        replacePhoto,
        setBackground,
        undo,
        redo,
        remove,
        bringForward,
        sendBackward,
        getSelection,
        getDpi: () => dpi,
        getBleedMm: () => bleedMm,
        refreshPhotoUrls,
        canUndo: () => historyRef.current.canUndo,
        canRedo: () => historyRef.current.canRedo,
      }),
      [
        loadDoc,
        serialize,
        addPhoto,
        addText,
        addClipart,
        pasteLayoutObject,
        duplicateSelected,
        replacePhoto,
        setBackground,
        undo,
        redo,
        remove,
        bringForward,
        sendBackward,
        getSelection,
        refreshPhotoUrls,
        dpi,
        bleedMm,
      ],
    );

    void historyVersion; // re-render trigger

    return (
      <div
        ref={wrapperRef}
        className={
          "relative mx-auto flex w-full max-w-full items-center justify-center " +
          (className ?? "")
        }
        // 키보드 접근: 탭 진입 시 안내
        tabIndex={0}
        role="application"
        aria-label="페이지 편집 캔버스. 화살표로 객체 이동, Delete 로 삭제, Cmd/Ctrl+Z 로 되돌리기."
      >
        <div
          ref={containerRef}
          className="relative inline-block touch-none select-none"
          style={{
            // 부모(wrapper) 영역 안에 자연 비율 컨테이너
            width: stagePxSize.w,
            maxWidth: "100%",
          }}
        >
          <canvas ref={canvasElRef} aria-hidden />
        </div>
      </div>
    );
  },
);

/**
 * 안전선(bleed 안쪽 점선) 그리기 — 캔버스 chrome 객체.
 * oType 을 부여하지 않아 PageDoc 직렬화에서 제외된다.
 */
function drawSafeLineOverlay(
  canvas: fabric.Canvas,
  widthMm: number,
  heightMm: number,
  bleedMm: number,
  dpi: number,
) {
  const bleedPx = mmToPx(bleedMm, dpi);
  const trimW = mmToPx(widthMm, dpi);
  const trimH = mmToPx(heightMm, dpi);

  // trim 영역 외곽선 (실선)
  const trimRect = new fabric.Rect({
    left: bleedPx + trimW / 2,
    top: bleedPx + trimH / 2,
    originX: "center",
    originY: "center",
    width: trimW,
    height: trimH,
    fill: "transparent",
    stroke: "rgba(0,0,0,0.15)",
    strokeWidth: 1,
    selectable: false,
    evented: false,
    excludeFromExport: true,
  });

  // 안전선 (trim 안쪽 2mm) — 점선
  const innerInset = mmToPx(2, dpi);
  const safeRect = new fabric.Rect({
    left: bleedPx + trimW / 2,
    top: bleedPx + trimH / 2,
    originX: "center",
    originY: "center",
    width: trimW - innerInset * 2,
    height: trimH - innerInset * 2,
    fill: "transparent",
    stroke: "rgba(244, 63, 94, 0.4)",
    strokeWidth: 1,
    strokeDashArray: [4, 4],
    selectable: false,
    evented: false,
    excludeFromExport: true,
  });

  canvas.add(trimRect);
  canvas.add(safeRect);
}

function restoreFromSnapshot(canvas: fabric.Canvas, snapshot: string) {
  const data = JSON.parse(snapshot) as Record<string, unknown>;
  // chrome 객체(safe line / trim rect)는 excludeFromExport=true 이므로 toJSON 에 포함되지 않음.
  // 복원 시엔 사용자 객체만 다시 그려진다 — chrome 은 살아있는 객체를 보존하기 위해
  // loadFromJSON 전에 분리한 뒤 재삽입한다.
  const chromeObjects = canvas
    .getObjects()
    .filter((o) => (o as { excludeFromExport?: boolean }).excludeFromExport);
  void canvas.loadFromJSON(data).then(() => {
    const present = new Set(canvas.getObjects());
    for (const c of chromeObjects) {
      if (!present.has(c)) canvas.add(c);
    }
    canvas.requestRenderAll();
  });
}

export default FabricStage;

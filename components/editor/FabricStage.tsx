"use client";

import * as fabric from "fabric";
import { nanoid } from "nanoid";
import {
  forwardRef,
  type Ref,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";

import { toast } from "@/components/ui/use-toast";
import { createIdleTracker } from "@/lib/editor/async-gates";
import { attachGestures } from "@/lib/fabric/gestures";
import { applyPhotoSlot } from "@/lib/fabric/photo-slot";
import {
  connectCanvasHistory,
  HistoryRecorder,
  HistoryStack,
} from "@/lib/fabric/history";
import {
  captureUserObjects,
  createBackgroundGate,
  createLoadFailureLatch,
  replaceUserObjects,
  type LoadDocResult,
} from "@/lib/fabric/load-guards";
import {
  applyBackgroundImageToCanvas,
  fabricToPageDoc,
  findUntaggedUserObjects,
  mmToPx,
  pageDocToFabric,
  ptToPx,
  type PageDocMeta,
  type SerializeForSaveResult,
  type TaggedFabricObject,
} from "@/lib/fabric/serialize";
import { attachSnapGuides } from "@/lib/fabric/snap";
import {
  createSnapshot,
  createSnapshotWithout,
  restoreSnapshotObjects,
} from "@/lib/fabric/snapshot";
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
  /**
   * 문서 로드(초기·템플릿 적용·최신본 재로드). 히스토리를 이 문서로 초기화한다.
   * 로드는 **dirty 를 일으키지 않는다** — 저장이 필요하면 호출자가 명시적으로 표시할 것.
   * 객체 교체가 끝나면 resolve 한다. 배경 이미지는 그 뒤 비동기로 적용된다(직렬화와 무관).
   *
   * 호출 시점에 있던 객체만 교체한다. 기다리는 동안 추가된 객체는 새 문서 위에 보존되고,
   * 히스토리에 한 단계로 쌓이며 onModified 가 발화한다(저장 대상).
   * 배경은 호출 순서로 판정해, 기다리는 동안 setBackground 로 바꾼 레이어(색/이미지)는 덮지 않는다.
   *
   * 결과: "applied"(반영) · "superseded"(더 새 로드에 밀림) · "skipped"(캔버스 없음). 실패는 reject.
   * 실패하면 로드 종료 알림 **전에** 저장 차단을 래치한다 — serializeForSave 가 "load_failed" 를
   * 돌려준다(대기 중이던 저장이 호출자 catch 보다 먼저 재개돼도 막힌다). "applied" 만 차단을 푼다.
   */
  loadDoc: (
    doc: PageDoc,
    photoUrls: Record<string, string>,
  ) => Promise<LoadDocResult>;
  serialize: (meta: PageDocMeta) => PageDoc;
  /**
   * 저장용 직렬화 — 저장 불변식(태그 없는 사용자 객체 0개)을 검사한다.
   * ok:false 면 서버에 보내지 말 것(빈 문서 덮어쓰기 방지).
   */
  serializeForSave: (meta: PageDocMeta) => SerializeForSaveResult;
  /**
   * 진행 중인 loadDoc · undo/redo 복원이 끝날 때까지 대기. 저장 직전에 호출.
   * timeoutMs 안에 끝나지 않으면 false — 호출자는 저장을 실패로 처리할 것.
   */
  whenIdle: (timeoutMs?: number) => Promise<boolean>;
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
  /**
   * 부모 폭 fit 시 허용 최대 스케일. 기본 1(논리 px 초과 업스케일 금지).
   * 표지 책등처럼 좁은 영역을 확대 편집할 때만 1 초과 값을 준다
   * (벡터 렌더 + retina 스케일링이라 ~DPR 배까지는 선명도 유지).
   */
  maxFitScale?: number;
  /** 페이지 ID — url-refresher 용. */
  pageId?: string;
  /** 객체 선택/수정 콜백. */
  onSelectionChange?: (target: TaggedFabricObject | null) => void;
  /**
   * 문서가 실제로 바뀌었을 때만 호출된다(사용자 편집으로 스냅샷이 달라진 push, undo/redo 적용).
   * loadDoc · 복원 과정의 객체 이벤트 · 내용이 같은 push 에서는 호출되지 않는다.
   */
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
  /**
   * 읽기 전용(결제 후 편집 잠금). 선택·대상 탐색을 끄고, 문서를 바꾸는 명령(추가·삭제·undo 등)을
   * 무시한다. 문서 로드(loadDoc)는 계속 동작한다 — 최신본을 보여줄 수 있어야 한다.
   */
  readOnly?: boolean;
  className?: string;
  /**
   * `next/dynamic` 경유용 ref 통로.
   *
   * next/dynamic 이 만드는 Loadable 래퍼는 함수 컴포넌트라 ref 를 받지 못한다
   * (React 가 "Function components cannot be given refs" 로 경고하고 ref 는 버려진다).
   * 그래서 lazy 래퍼(`FabricStageLazy`)가 ref 를 **prop 으로** 넘기고, 여기서
   * 일반 ref 와 동일하게 핸들을 연결한다. 직접 import 하는 경우엔 쓰지 않는다.
   */
  forwardedRef?: Ref<FabricStageHandle>;
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
      maxFitScale = 1,
      pageId,
      onSelectionChange,
      onModified,
      onLongPress,
      onHistoryChange,
      onReady,
      readOnly = false,
      className,
      forwardedRef,
    } = props;

    const wrapperRef = useRef<HTMLDivElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const canvasElRef = useRef<HTMLCanvasElement>(null);
    const canvasRef = useRef<fabric.Canvas | null>(null);
    const historyRef = useRef<HistoryStack>(new HistoryStack());
    /** 캔버스 이벤트 → 히스토리 연결. 캔버스와 수명이 같다. */
    const recorderRef = useRef<HistoryRecorder | null>(null);
    /** loadDoc 요청 순번 — 늦게 끝난 옛 로드가 새 문서를 덮지 않게 한다. */
    const loadSeqRef = useRef(0);
    /** undo/redo 복원 순번 — 연속 undo 시 마지막 요청만 캔버스에 반영한다. */
    const restoreSeqRef = useRef(0);
    /** 진행 중인 loadDoc 수 — 로드 중 undo/redo 는 무시한다(옛 문서 히스토리라서). */
    const loadingCountRef = useRef(0);
    /** 로드·복원 진행 추적 — 저장은 whenIdle 뒤에 직렬화한다. */
    const idleRef = useRef(createIdleTracker());
    /** 배경 변경 호출 순서 — 늦게 끝난 비동기 적용이 더 나중에 요청된 배경을 덮지 않게. */
    const bgGateRef = useRef(createBackgroundGate());
    /** 마지막 문서 로드 실패 래치 — serializeForSave 가 본다(lib/fabric/load-guards.ts). */
    const loadFailureRef = useRef(createLoadFailureLatch());
    /** 읽기 전용 — 명령 가드와 캔버스 재생성 시 적용용. */
    const readOnlyRef = useRef(readOnly);
    /** 마지막 loadDoc 입력 — 크기 변경으로 캔버스를 새로 만들 때 다시 올린다. */
    const lastLoadRef = useRef<{
      doc: PageDoc;
      photoUrls: Record<string, string>;
    } | null>(null);
    /** photoId → 최신 signed URL. undo 복원 시 만료 URL 대신 쓴다. */
    const photoUrlsRef = useRef<Record<string, string>>({});
    const [historyVersion, setHistoryVersion] = useState(0);

    // 콜백들을 ref 로 보관 — 캔버스 재초기화 빈도를 낮춘다.
    const onSelectionChangeRef = useRef(onSelectionChange);
    const onModifiedRef = useRef(onModified);
    const onLongPressRef = useRef(onLongPress);
    const onHistoryChangeRef = useRef(onHistoryChange);
    const onReadyRef = useRef(onReady);
    const readyCalledRef = useRef(false);
    const maxFitScaleRef = useRef(maxFitScale);
    /** 현재 캔버스의 fit 재계산 함수 — maxFitScale 변경 시 즉시 재적용용. */
    const refitRef = useRef<(() => void) | null>(null);
    // 캔버스 init effect(제스처 단축키·재생성 시 재로드)가 최신 콜백을 쓰도록 ref 로 우회.
    const undoRef = useRef<() => void>(() => {});
    const redoRef = useRef<() => void>(() => {});
    const loadDocRef = useRef<
      | ((
          doc: PageDoc,
          photoUrls: Record<string, string>,
        ) => Promise<LoadDocResult>)
      | null
    >(null);
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
    useEffect(() => {
      maxFitScaleRef.current = maxFitScale;
      refitRef.current?.();
    }, [maxFitScale]);
    useEffect(() => {
      readOnlyRef.current = readOnly;
      const canvas = canvasRef.current;
      if (canvas) applyReadOnly(canvas, readOnly);
    }, [readOnly]);

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
      applyReadOnly(canvas, readOnlyRef.current);

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

      // 안전선 (점선) — chrome 객체 (oType 미부여 → 직렬화 제외).
      // 히스토리 연결 **전에** 그린다 — chrome add 이벤트가 push 를 예약하지 않게(QA-4).
      drawSafeLineOverlay(canvas, widthMm, heightMm, bleedMm, dpi);

      // History push (debounced 200ms).
      // 스냅샷은 createSnapshot(= canvas.toObject(FABRIC_EXTRA_PROPS)) — toJSON(props) 는
      // fabric 6.9.1 에서 인자를 무시해 태그가 빠진다(QA-1).
      // 로드·복원 중 이벤트 무시, 내용이 같은 push 는 onModified 없음 — HistoryRecorder 참고.
      const recorder = new HistoryRecorder({
        stack: historyRef.current,
        takeSnapshot: () => createSnapshot(canvas),
        debounceMs: 200,
        onHistoryChange: (canUndo, canRedo) => {
          setHistoryVersion((v) => v + 1);
          onHistoryChangeRef.current?.(canUndo, canRedo);
        },
        onModified: () => onModifiedRef.current?.(),
      });
      recorderRef.current = recorder;
      // 로드 전 기준점 = chrome 만 있는 빈 문서. 로드 전에 발화한 이벤트가 있어도 no-op push 가 된다.
      // (문서 없이 시작하는 페이지에서는 첫 사용자 편집이 이 기준점과 달라 정상적으로 dirty 가 된다.)
      recorder.ensureBaseline();
      // chrome(excludeFromExport) 대상 이벤트는 걸러서 연결한다.
      const disconnectHistory = connectCanvasHistory(canvas, recorder);

      // 제스처 + 스냅
      const detachGestures = attachGestures(canvas, {
        container,
        mmToPx: (mm) => mmToPx(mm, dpi),
        onLongPress: (t, x, y) => onLongPressRef.current?.(t ?? null, x, y),
        // 버튼·단축키 모두 같은 undo/redo 경로(가드·태그 보존 복원)를 탄다.
        onUndo: () => undoRef.current(),
        onRedo: () => redoRef.current(),
      });
      const snapHandle = attachSnapGuides(canvas);

      // 리사이즈: 부모 폭에 맞춰 viewport scale fit (debounce 150ms)
      let resizeTimer: ReturnType<typeof setTimeout> | null = null;
      const applyFit = () => {
          const w = wrapper.clientWidth;
          if (!w) return;
          const scale = Math.min(maxFitScaleRef.current, w / stagePxSize.w);
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
          // 선택 핸들 CSS 축소 역보정 — 화면 기준 시각 ~13px / 터치 판정 ≥44px 유지
          const inv = 1 / scale;
          fabric.FabricObject.prototype.cornerSize = Math.round(13 * inv);
          fabric.FabricObject.prototype.touchCornerSize = Math.round(44 * inv);
          fabric.FabricObject.prototype.padding = Math.round(4 * inv);
          canvas.requestRenderAll();
      };
      refitRef.current = applyFit;
      const ro = new ResizeObserver(() => {
        if (resizeTimer) clearTimeout(resizeTimer);
        resizeTimer = setTimeout(applyFit, 150);
      });
      ro.observe(wrapper);

      // 최초 캔버스 초기화 완료 신호 (lazy-load 시 doc 로딩 트리거)
      if (!readyCalledRef.current) {
        readyCalledRef.current = true;
        onReadyRef.current?.();
      } else if (lastLoadRef.current) {
        // 크기(widthMm 등)가 바뀌어 캔버스를 새로 만들었다 — 새 캔버스는 비어 있다.
        // 크기 변경은 항상 문서 교체(구규격 표지 재생성·템플릿·최신본 재로드)와 함께 오므로
        // 마지막 문서를 다시 올린다. 안 하면 빈 캔버스가 자동저장돼 표지가 비워진다.
        // 실패는 loadDoc 이 저장 차단으로 래치한다 — 여기서는 처리되지 않은 reject 만 막는다.
        const last = lastLoadRef.current;
        void loadDocRef.current?.(last.doc, last.photoUrls).catch((err: unknown) => {
          console.warn("[FabricStage] 캔버스 재생성 후 문서 재로드 실패 — 저장을 멈춘다", err);
        });
      }

      return () => {
        if (resizeTimer) clearTimeout(resizeTimer);
        refitRef.current = null;
        recorder.cancel();
        if (recorderRef.current === recorder) recorderRef.current = null;
        ro.disconnect();
        snapHandle.detach();
        detachGestures();
        disconnectHistory();
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
          photoUrlsRef.current = { ...photoUrlsRef.current, ...urls };
          const c = canvasRef.current;
          if (!c) return;
          await applyPhotoUrlsToCanvas(c, urls);
          // src 만 바뀐 것은 편집이 아니다 — 포인터 내용을 맞춰 다음 이벤트가 dirty 를 만들지 않게.
          if (canvasRef.current === c) recorderRef.current?.rebaseCurrent();
        },
      });
      return () => detach();
    }, [pageId]);

    // ---------- Imperative API ----------
    const loadDoc = useCallback(
      async (
        doc: PageDoc,
        photoUrls: Record<string, string>,
      ): Promise<LoadDocResult> => {
        const initialCanvas = canvasRef.current;
        if (!initialCanvas) return "skipped";
        lastLoadRef.current = { doc, photoUrls };
        photoUrlsRef.current = { ...photoUrlsRef.current, ...photoUrls };
        const seq = ++loadSeqRef.current;
        // 진행 중인 undo/redo 복원은 무효 — 새 문서가 이긴다.
        restoreSeqRef.current += 1;
        loadingCountRef.current += 1;
        const endIdle = idleRef.current.begin();
        let loadingEnded = false;
        // 객체 교체가 끝나면 즉시 해제한다 — 배경 이미지는 직렬화와 무관하므로 기다리지 않는다.
        const endLoading = () => {
          if (loadingEnded) return;
          loadingEnded = true;
          loadingCountRef.current -= 1;
          endIdle();
        };
        // 로드 구간의 히스토리 기록 중지 — **await 전에 동기로** 건다(QA-4 회귀).
        // 예전에는 이미지 로드(await)가 끝난 뒤에야 suspend 해서, 그 사이 예약된 push 가
        // 가드 없이 돌아 편집 없이 onModified → dirty → 자동저장이 됐다.
        // 로드 중 사용자 이벤트는 기록하지 않는다 — 교체되는 옛 객체의 편집은 사라지고,
        // 새로 추가된 객체는 교체 뒤 보존 객체 전체를 한 단계로 commit 한다(아래).
        // 캔버스가 재생성되면 recorder 도 바뀌므로, 멈춘 recorder 를 모아 두고 전부 재개한다.
        const suspended: HistoryRecorder[] = [];
        const suspendActiveRecorder = (): HistoryRecorder | null => {
          const r = recorderRef.current;
          if (r && !suspended.includes(r)) {
            r.suspend();
            suspended.push(r);
          }
          return r;
        };
        const resumeRecorders = () => {
          for (const r of suspended.splice(0)) r.resume();
        };
        // 호출 시점의 사용자 객체 = 교체 대상. **await 전에 동기로** 찍는다.
        // 기다리는 동안 툴바로 추가한 텍스트·사진은 여기에 없으므로 교체에서 살아남는다
        // (예전에는 교체 때 전부 지워 조용히 사라졌다 — lib/fabric/load-guards.ts).
        const previousAtStart = captureUserObjects(initialCanvas.getObjects());
        // 배경도 호출 시점에 등록 — 기다리는 동안 사용자가 고른 배경(에디터 저장 메타에는 이미
        // 반영됨)을 교체 시점에 덮어 화면과 저장본이 어긋나지 않게.
        const bgClaim = bgGateRef.current.claim(["color", "image"]);
        suspendActiveRecorder();
        try {
          // 새 객체를 먼저 전부 만든 뒤 한 번에 교체한다.
          // (먼저 지우고 이미지 로드를 기다리면 그 사이 저장·스냅샷이 빈 캔버스를 본다.)
          const objs = await pageDocToFabric(doc, {
            canvas: initialCanvas,
            dpi,
            photoUrls,
          });
          // 기다리는 동안 더 새 로드가 들어왔거나 캔버스가 재생성됐을 수 있다 — 현재 캔버스 기준.
          const canvas = canvasRef.current;
          // 밀린 로드는 저장 차단을 건드리지 않는다 — 더 새 로드의 결과(실패 포함)가 판정한다.
          if (seq !== loadSeqRef.current || !canvas) return "superseded";

          // 재생성된 캔버스의 recorder 도 교체 동안 멈춘다(이미 멈췄으면 no-op).
          const recorder = suspendActiveRecorder();
          // 재생성은 항상 새 loadDoc(순번 증가)을 부르므로 여기선 같은 캔버스다. 방어적으로만 다시 찍는다.
          const previous =
            canvas === initialCanvas
              ? previousAtStart
              : captureUserObjects(canvas.getObjects());
          releaseSelectionFor(canvas, previous);

          // bleed 만큼 좌표 보정: PageDoc 좌표는 trim 기준 → 캔버스 좌표는 trim+bleed
          const bleedPx = mmToPx(bleedMm, dpi);
          for (const o of objs) {
            o.set({
              left: (o.left ?? 0) + bleedPx,
              top: (o.top ?? 0) + bleedPx,
            });
          }
          // 기존 사용자 객체 제거(chrome 보존, 태그가 깨진 객체 포함) + 새 객체를 보존 객체 아래에 삽입.
          const { preserved } = replaceUserObjects(canvas, previous, objs);
          // 캔버스가 이 문서를 반영했다 — 앞선 로드 실패로 멈춘 저장을 푼다.
          loadFailureRef.current.markApplied();

          if (bgClaim.isCurrent("color")) {
            canvas.backgroundColor = doc.backgroundColor;
          }
          const applyDocBackgroundImage = bgClaim.isCurrent("image");
          if (applyDocBackgroundImage) {
            (canvas as unknown as { backgroundImage: unknown }).backgroundImage =
              undefined;
          }
          canvas.requestRenderAll();

          // 기준점 = 로드한 문서. 이후 같은 내용의 push 는 no-op 이라 dirty 가 안 된다.
          // 보존 객체가 있으면 기준점에서 빼고, 그 위 편집 한 단계로 push 한다(undo 대상 + onModified).
          if (preserved.length === 0) {
            if (recorder) recorder.resetToCurrent();
            else historyRef.current.reset(createSnapshot(canvas));
          } else {
            const baseline = createSnapshotWithout(canvas, new Set(preserved));
            if (recorder) recorder.resetTo(baseline);
            else historyRef.current.reset(baseline);
          }
          resumeRecorders();
          if (preserved.length > 0 && !recorder?.commit()) {
            // 다른 복원이 recorder 를 멈춰 push 하지 못했다 — 저장 대상임은 직접 알린다.
            onModifiedRef.current?.();
          }
          endLoading();

          // backgroundImage 처리 — photoId 우선, 그다음 url. (스냅샷과 무관)
          // 기다리지 않는다: loadDoc 을 기다리는 저장 큐(최신본 확인)가 느린 배경 이미지에
          // 막히지 않게. 늦게 끝난 옛 요청·그 뒤 사용자가 바꾼 배경은 isCurrent 로 가려진다.
          if (applyDocBackgroundImage && doc.backgroundImage) {
            const url =
              (doc.backgroundImage.photoId &&
                photoUrls[doc.backgroundImage.photoId]) ||
              doc.backgroundImage.url;
            if (url) {
              void applyBackgroundImageToCanvas(
                canvas,
                {
                  url,
                  cropMode: doc.backgroundImage.cropMode,
                  opacity: doc.backgroundImage.opacity,
                },
                stagePxSize,
                {
                  isCurrent: () =>
                    seq === loadSeqRef.current &&
                    canvasRef.current === canvas &&
                    bgClaim.isCurrent("image"),
                },
              );
            }
          }
          return "applied";
        } catch (err) {
          // 로드 종료 알림(finally 의 endLoading → whenIdle 대기자 재개) **전에** 동기로 저장을 막는다.
          // 호출자(에디터)의 catch 는 대기 중이던 저장보다 늦게 돈다 — 그 틈에 실패한 캔버스(빈 문서)가
          // 서버를 덮던 경로(A 리뷰). 더 새 로드가 이미 시작됐으면 그 결과에 맡긴다.
          loadFailureRef.current.markFailed(seq === loadSeqRef.current);
          throw err;
        } finally {
          resumeRecorders();
          endLoading();
        }
      },
      [bleedMm, dpi, stagePxSize],
    );
    loadDocRef.current = loadDoc;

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

    const serializeForSave = useCallback(
      (meta: PageDocMeta): SerializeForSaveResult => {
        const canvas = canvasRef.current;
        if (!canvas) {
          return { ok: false, reason: "not_ready", untaggedCount: 0 };
        }
        // 마지막 문서 로드가 실패했다 — 캔버스가 문서를 반영하지 못했으니 서버를 덮지 않는다.
        if (loadFailureRef.current.failed) {
          return { ok: false, reason: "load_failed", untaggedCount: 0 };
        }
        // 태그 없는 사용자 객체가 있으면 직렬화가 그 객체들을 조용히 버린다 →
        // 화면에 보이는 내용이 저장본에서 사라진다. 저장 자체를 막는다.
        const untagged = findUntaggedUserObjects(
          canvas.getObjects() as TaggedFabricObject[],
        );
        if (untagged.length > 0) {
          return {
            ok: false,
            reason: "untagged_objects",
            untaggedCount: untagged.length,
          };
        }
        return { ok: true, doc: serialize(meta) };
      },
      [serialize],
    );

    const addPhoto = useCallback(
      async (photoId: string, url: string) => {
        if (readOnlyRef.current) return;
        const canvas = canvasRef.current;
        if (!canvas) return;
        const img = await fabric.FabricImage.fromURL(url, {
          crossOrigin: "anonymous",
        });
        // 캔버스 중앙 (bleed + trim/2)
        const cx = mmToPx(bleedMm + widthMm / 2, dpi);
        const cy = mmToPx(bleedMm + heightMm / 2, dpi);
        // 기본 사이즈 — trim 폭의 50%
        // 기본 슬롯 — trim 폭의 50%, 사진 원본 비율 유지(잘라내지 않는다).
        const iw = img.width ?? 1;
        const ih = img.height ?? 1;
        const slotWidthMm = widthMm * 0.5;
        const slotHeightMm = slotWidthMm * (ih / iw);
        img.set({
          left: cx,
          top: cy,
          originX: "center",
          originY: "center",
        });
        photoUrlsRef.current = { ...photoUrlsRef.current, [photoId]: url };
        const tagged = img as TaggedFabricObject;
        tagged.objectId = nanoid(12);
        tagged.oType = "photo";
        tagged.photoId = photoId;
        tagged.originalWidthMm = slotWidthMm;
        tagged.originalHeightMm = slotHeightMm;
        // 슬롯 = 화면에 보이는 박스. 직렬화는 이 값을 그대로 저장한다.
        applyPhotoSlot(img, {
          slotWidthMm,
          slotHeightMm,
          cropMode: "cover",
          dpi,
        });
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
        if (readOnlyRef.current) return;
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
        if (readOnlyRef.current) return;
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
        if (readOnlyRef.current) return;
        const canvas = canvasRef.current;
        if (!canvas) return;
        if (photoUrls) {
          photoUrlsRef.current = { ...photoUrlsRef.current, ...photoUrls };
        }

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

    /** 원본이 바뀐 사진에 기존 슬롯을 다시 적용한다(슬롯 태그가 없으면 no-op). */
    const reapplySlotFrom = useCallback(
      (src: TaggedFabricObject, dest: fabric.FabricImage) => {
        if (
          typeof src.slotWidthMm !== "number" ||
          typeof src.slotHeightMm !== "number"
        ) {
          return;
        }
        const rx =
          src.slotScaleX && src.slotScaleX > 0
            ? (src.scaleX ?? 1) / src.slotScaleX
            : 1;
        const ry =
          src.slotScaleY && src.slotScaleY > 0
            ? (src.scaleY ?? 1) / src.slotScaleY
            : 1;
        applyPhotoSlot(dest, {
          slotWidthMm: src.slotWidthMm * rx,
          slotHeightMm: src.slotHeightMm * ry,
          cropMode: src.cropMode ?? "cover",
          borderRadiusMm: src.borderRadiusMm,
          dpi,
        });
      },
      [dpi],
    );

    const replacePhoto = useCallback(
      async (photoId: string, url: string) => {
        if (readOnlyRef.current) return;
        const canvas = canvasRef.current;
        if (!canvas) return;
        const sel = canvas.getActiveObject() as TaggedFabricObject | null;
        if (!sel || sel.oType !== "photo") return;

        const img = sel as fabric.FabricImage & TaggedFabricObject;
        photoUrlsRef.current = { ...photoUrlsRef.current, [photoId]: url };

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
          reapplySlotFrom(sel, next);
          canvas.remove(sel);
          canvas.add(next);
          canvas.setActiveObject(next);
          canvas.requestRenderAll();
          return;
        }

        img.photoId = photoId;
        // 새 사진은 원본 픽셀 크기가 다르다 — 같은 슬롯에 맞춰 스케일·클립을 다시 계산한다.
        // (기존 scaleX 를 그대로 두면 교체한 사진만 슬롯을 벗어난다.)
        reapplySlotFrom(img, img);
        img.canvas?.fire("object:modified", { target: img });
        canvas.requestRenderAll();
      },
      [reapplySlotFrom],
    );

    const duplicateSelected = useCallback(async () => {
      if (readOnlyRef.current) return;
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
        if (readOnlyRef.current) return;
        const canvas = canvasRef.current;
        if (!canvas) return;

        const applyImage = (url: string, photoId?: string) => {
          // 호출 순서로 판정 — 늦게 끝난 이미지가 그 뒤 요청된 배경(다른 선택·문서 로드)을 덮지 않게.
          const claim = bgGateRef.current.claim(["image"]);
          void fabric.FabricImage.fromURL(url, {
            crossOrigin: "anonymous",
          }).then((img) => {
            if (!claim.isCurrent("image") || canvasRef.current !== canvas) {
              return;
            }
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
          }).catch((err: unknown) => {
            console.warn("[FabricStage] 배경 이미지 로드 실패", err);
          });
        };

        const clearImage = () => {
          (canvas as unknown as { backgroundImage: unknown }).backgroundImage =
            undefined;
        };

        // null / { type: "none" } — 배경 제거 (흰색 채움)
        if (value === null || (typeof value === "object" && value.type === "none")) {
          bgGateRef.current.claim(["color", "image"]);
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
            bgGateRef.current.claim(["color", "image"]);
            canvas.backgroundColor = value;
            clearImage();
            canvas.requestRenderAll();
          }
          return;
        }

        switch (value.type) {
          case "color":
            bgGateRef.current.claim(["color", "image"]);
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

    /**
     * 히스토리 스냅샷으로 사용자 객체를 교체한다(chrome·배경은 그대로).
     *
     * - 복원 중 object:removed/added 는 recorder 가 무시한다 → push 가 없어 redo 스택이 산다.
     * - 스냅샷은 태그를 보존하므로(snapshot.ts) 복원 객체도 그대로 저장된다.
     * - 성공하면 onModified 를 한 번 부른다: undo/redo 는 저장해야 하는 사용자 변경이다.
     * - 복원 시작 시점의 객체만 교체한다. 기다리는 동안 추가된 객체는 보존되고, 복원 결과 위의
     *   새 편집 한 단계로 push 된다(새 편집이므로 redo 는 비워진다).
     */
    const restoreSnapshot = useCallback(
      async (snapshot: string, direction: "undo" | "redo") => {
        const canvas = canvasRef.current;
        const recorder = recorderRef.current;
        if (!canvas || !recorder) return;
        const seq = ++restoreSeqRef.current;
        const done = idleRef.current.begin();
        // 복원 시작 시점의 사용자 객체 = 교체 대상(await 전에 동기로 — loadDoc 과 같은 규약).
        const previous = captureUserObjects(canvas.getObjects());
        recorder.suspend();
        let applied = false;
        let preservedCount = 0;
        try {
          let objs: TaggedFabricObject[];
          try {
            objs = await restoreSnapshotObjects(snapshot, {
              dpi,
              photoUrls: photoUrlsRef.current,
            });
          } catch (err) {
            if (
              seq === restoreSeqRef.current &&
              recorderRef.current === recorder
            ) {
              // 캔버스는 마지막으로 반영된 상태 그대로다. 연속 undo 로 앞선 복원이 순번에 밀려
              // 반영되지 않았을 수 있으므로, 그 뒤로 움직인 포인터를 전부 되돌린다.
              recorder.revertUnapplied();
              console.warn("[FabricStage] 히스토리 복원 실패", err);
              toast({
                description:
                  direction === "undo"
                    ? "되돌리기를 적용하지 못했어요. 잠시 후 다시 시도해주세요."
                    : "다시 실행을 적용하지 못했어요. 잠시 후 다시 시도해주세요.",
                variant: "destructive",
              });
            }
            return;
          }
          if (seq !== restoreSeqRef.current || canvasRef.current !== canvas) {
            return;
          }
          releaseSelectionFor(canvas, previous);
          const { preserved } = replaceUserObjects(canvas, previous, objs);
          canvas.requestRenderAll();
          // 포인터 내용을 복원된 캔버스의 실제 스냅샷으로 맞춘다(사진 src 최신 URL 치환 등).
          // 보존 객체는 복원 결과에 넣지 않는다 — 아래에서 그 위의 새 편집으로 push 한다.
          recorder.markRestored(
            preserved.length === 0
              ? createSnapshot(canvas)
              : createSnapshotWithout(canvas, new Set(preserved)),
          );
          preservedCount = preserved.length;
          applied = true;
        } finally {
          recorder.resume();
          done();
        }
        if (applied) {
          if (preservedCount > 0) recorder.commit();
          onModifiedRef.current?.();
        }
      },
      [dpi],
    );

    const undo = useCallback(() => {
      // 로드 중에는 옛 문서의 히스토리라 되돌릴 대상이 아니다. 읽기 전용이면 문서를 바꾸지 않는다.
      if (loadingCountRef.current > 0 || readOnlyRef.current) return;
      const snap = recorderRef.current?.undo();
      if (snap == null) return;
      void restoreSnapshot(snap, "undo");
    }, [restoreSnapshot]);

    const redo = useCallback(() => {
      if (loadingCountRef.current > 0 || readOnlyRef.current) return;
      const snap = recorderRef.current?.redo();
      if (snap == null) return;
      void restoreSnapshot(snap, "redo");
    }, [restoreSnapshot]);
    undoRef.current = undo;
    redoRef.current = redo;

    const remove = useCallback(() => {
      if (readOnlyRef.current) return;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const a = canvas.getActiveObject();
      if (!a) return;
      canvas.remove(a);
      canvas.discardActiveObject();
      canvas.requestRenderAll();
    }, []);

    const bringForward = useCallback(() => {
      if (readOnlyRef.current) return;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const a = canvas.getActiveObject();
      if (!a) return;
      canvas.bringObjectForward(a);
      canvas.requestRenderAll();
    }, []);

    const sendBackward = useCallback(() => {
      if (readOnlyRef.current) return;
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
        photoUrlsRef.current = { ...photoUrlsRef.current, ...urls };
        const canvas = canvasRef.current;
        if (!canvas) return;
        await applyPhotoUrlsToCanvas(canvas, urls);
        // src 만 바뀐 것은 편집이 아니다 — 포인터 내용을 캔버스에 맞춘다.
        if (canvasRef.current === canvas) recorderRef.current?.rebaseCurrent();
      },
      [],
    );

    const whenIdle = useCallback(
      (timeoutMs?: number) => idleRef.current.whenIdle(timeoutMs),
      [],
    );

    // 핸들을 한 번 만들어 두 경로(직접 ref / lazy 래퍼가 넘긴 forwardedRef)에 같이 붙인다.
    // 둘을 따로 만들면 같은 캔버스에 서로 다른 핸들 객체가 물려 헷갈린다.
    const handle = useMemo<FabricStageHandle>(
      () => ({
        loadDoc,
        serialize,
        serializeForSave,
        whenIdle,
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
        serializeForSave,
        whenIdle,
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

    useImperativeHandle(ref, () => handle, [handle]);
    useImperativeHandle(forwardedRef, () => handle, [handle]);

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
        aria-label={
          readOnly
            ? "페이지 캔버스 (읽기 전용 — 결제가 완료돼 수정할 수 없어요)."
            : "페이지 편집 캔버스. 화살표로 객체 이동, Delete 로 삭제, Cmd/Ctrl+Z 로 되돌리기."
        }
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
 * 읽기 전용 전환 — 선택·대상 탐색을 끄고 진행 중인 선택·텍스트 편집을 끝낸다.
 * 대상 탐색이 꺼지면 키보드 이동·삭제(lib/fabric/gestures.ts 는 활성 객체가 있어야 동작)도 멈춘다.
 */
function applyReadOnly(canvas: fabric.Canvas, readOnly: boolean) {
  canvas.selection = !readOnly;
  canvas.skipTargetFind = readOnly;
  if (!readOnly) return;
  const active = canvas.getActiveObject();
  if (active) {
    const text = active as fabric.IText;
    if (text.isEditing) text.exitEditing();
    canvas.discardActiveObject();
  }
  canvas.requestRenderAll();
}

/**
 * 교체로 지워질 객체가 선택돼 있으면 교체 전에 선택을 푼다.
 * 여러 객체 선택(ActiveSelection)은 그룹 변환을 객체에 반영하려면 먼저 풀어야 한다.
 * 교체 대기 중 추가된(보존될) 단일 객체 선택은 유지한다 — 텍스트 편집 중일 수 있다.
 */
function releaseSelectionFor(
  canvas: fabric.Canvas,
  previous: ReadonlySet<fabric.FabricObject>,
) {
  const active = canvas.getActiveObject();
  if (!active) return;
  const preservedSingle =
    !previous.has(active) && canvas.getObjects().includes(active);
  if (!preservedSingle) canvas.discardActiveObject();
}

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

export default FabricStage;

"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Eye, Save, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import dynamic from "next/dynamic";

import Cover3DPreview from "@/components/editor/Cover3DPreview";
import CoverSpineGuide from "@/components/editor/CoverSpineGuide";
import CoverTemplateDialog from "@/components/editor/CoverTemplateDialog";
import type { FabricStageHandle } from "@/components/editor/FabricStage";
import PhotoPickerDialog from "@/components/editor/PhotoPickerDialog";
import ResourcePalette from "@/components/editor/ResourcePalette";

// ⚠️ FabricStage 를 dynamic() 으로 직접 감싸면 ref 가 전달되지 않아 stageRef 가 null 이
// 된다(저장·객체 추가가 전부 no-op). lazy 청크는 유지하면서 ref 를 살리는 래퍼를 쓴다 —
// 근거는 components/editor/FabricStageLazy.tsx 상단 주석.
import FabricStage from "@/components/editor/FabricStageLazy";
const SelectionPanel = dynamic(() => import("@/components/editor/SelectionPanel"), { ssr: false });
const PREVIEW_DPI = 72;
/** 모바일 면 세그먼트 확대 시 논리 px 대비 허용 최대 업스케일(핀치 maxZoom 4와 정합). */
const SEGMENT_MAX_FIT_SCALE = 4;
import Toolbar, { type ToolbarTool } from "@/components/editor/Toolbar";
import MobileBottomSheet from "@/components/layout/MobileBottomSheet";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/use-toast";
import type { BookSize } from "@/lib/db/types";
import {
  createSerialQueue,
  fetchJsonWithTimeout,
} from "@/lib/editor/async-gates";
import {
  decideLatestDoc,
  reloadEditorDoc,
  type SaveBlockReason,
} from "@/lib/editor/doc-sync";
import {
  interpretSaveResponse,
  type SaveOutcome,
} from "@/lib/editor/edit-conflict";
import type { TaggedFabricObject } from "@/lib/fabric/serialize";
import {
  buildDefaultCoverDoc,
  buildSpineText,
  calcCoverDimensions,
  SPINE_TEXT_MIN_MM,
} from "@/lib/layout/cover";
import { isPageDoc, PAGEDOC_VERSION, type PageDoc } from "@/lib/layout/types";
import { cn } from "@/lib/utils";

export interface ProjectPhotoSummary {
  id: string;
  filename: string | null;
}

export interface CoverEditorProps {
  projectId: string;
  projectTitle: string;
  initialDoc: PageDoc;
  /** initialDoc 가 DB 에 저장된 게 아니라 buildDefaultCoverDoc 결과인 경우 true. */
  initialIsDefault: boolean;
  /** 저장된 cover_json 의 내용 버전(lib/editor/doc-version). PATCH baseVersion 기준. */
  initialVersion: string;
  initialPhotoUrls: Record<string, string>;
  bookSize: BookSize;
  pageCount: number;
  /** 사용자가 표지에 추가할 수 있는 프로젝트 사진 목록(앞쪽 N장). */
  projectPhotos: ProjectPhotoSummary[];
}

const AUTOSAVE_DEBOUNCE_MS = 5000;

/** 저장 전 캔버스 로드·복원 대기 한도 — 이미지 로드가 멈춰도 저장·이동이 영원히 막히지 않게. */
const STAGE_IDLE_TIMEOUT_MS = 15_000;

/** 최신본 확인 GET 한도 — 저장 큐 안에서 돌기 때문에 멈추면 뒤따르는 저장·이동이 막힌다. */
const SYNC_FETCH_TIMEOUT_MS = 10_000;

const SAVE_BLOCKED_MESSAGE =
  "편집 화면의 일부 요소를 인식하지 못해 저장을 멈췄어요. 새로고침하면 마지막 저장본을 불러와요.";

const SAVE_BLOCK_MESSAGES: Record<SaveBlockReason, string> = {
  load_failed:
    "표지를 화면에 불러오지 못해 저장을 멈췄어요. 새로고침하면 마지막 저장본을 다시 불러와요.",
  server_doc_unreadable:
    "서버에 저장된 표지를 이 화면에서 읽을 수 없어 저장을 멈췄어요. 새로고침한 뒤 다시 편집해주세요.",
};

/** GET /api/cover 응답 중 최신본 동기화에 쓰는 필드. */
interface CoverLatestResponse {
  coverJson: unknown;
  isDefault: boolean;
  photoUrls: Record<string, string>;
  version: string;
}

/** 모바일 면 단위 편집 세그먼트. */
type CoverSegment = "back" | "spine" | "front" | "all";

const SEGMENTS: Array<{ id: CoverSegment; label: string }> = [
  { id: "back", label: "뒤표지" },
  { id: "spine", label: "책등" },
  { id: "front", label: "앞표지" },
  { id: "all", label: "전체" },
];

/**
 * 표지 에디터 클라이언트.
 *
 * 레이아웃:
 *   - 데스크탑: 좌측(템플릿 + 팔레트) / 중앙 캔버스 / 우측 SelectionPanel.
 *   - 모바일: 상단 헤더 / 면(앞·책등·뒤) 단위 확대 + 가로 스크롤 캔버스 / 하단 Toolbar.
 *
 * 저장:
 *   - 수동 + 5초 debounce 자동저장 토글.
 *   - PATCH /api/cover (baseVersion 동봉 — 서버가 더 새로우면 409, 최신본 재로드).
 *   - 저장은 한 줄로 직렬화하고, 캔버스 로드·복원이 끝난 뒤 직렬화한다.
 *   - 태그 없는 객체가 섞이면 저장을 중단한다(빈 표지 덮어쓰기 방지).
 *   - dirty 시 beforeunload guard + 클라이언트 네비게이션(주문/내지) 전 flush 저장.
 *   - 진입 직후 서버 최신본과 버전을 비교해, 라우터 캐시로 옛 문서가 올라왔으면 교체한다.
 *
 * 책등 가이드는 CoverSpineGuide 가 캔버스 위 absolute 오버레이로 그린다.
 */
export default function CoverEditor({
  projectId,
  projectTitle,
  initialDoc,
  initialIsDefault,
  initialVersion,
  initialPhotoUrls,
  bookSize,
  pageCount,
  projectPhotos,
}: CoverEditorProps) {
  const router = useRouter();
  const stageRef = useRef<FabricStageHandle>(null);
  const [selection, setSelection] = useState<TaggedFabricObject | null>(null);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [autosave, setAutosave] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  /** 첫 캔버스 로드 + 최신본 확인 완료 시각 — 자동저장 재무장 트리거. */
  const [stageLoadedAt, setStageLoadedAt] = useState<number | null>(null);
  // 초기 doc 가 default(미저장) 면 dirty=true 로 시작 (자동저장이 작동하도록).
  // 로드 자체는 dirty 를 만들지 않으므로(FabricStage), 이것이 로드 시 저장이 필요한 유일한 경로다.
  const [dirty, setDirty] = useState(initialIsDefault);
  /** 서버 cover_json 기준 버전 — 저장 성공·최신본 재로드 때 갱신. */
  const baseVersionRef = useRef(initialVersion);
  /** 사용자 편집 순번 — 저장 중 편집이 있으면 dirty 를 유지한다. */
  const editSeqRef = useRef(0);
  const markDirty = useCallback(() => {
    editSeqRef.current += 1;
    setDirty(true);
  }, []);
  /** 저장·최신본 확인 직렬화 — 동시에 나간 저장이 서로를 409 로 만들지 않게. */
  const saveQueueRef = useRef(createSerialQueue());
  const [error, setError] = useState<string | null>(null);
  const [toolSheet, setToolSheet] = useState<ToolbarTool | null>(null);
  const [photoSheetOpen, setPhotoSheetOpen] = useState(false);
  const [templateDialogOpen, setTemplateDialogOpen] = useState(false);
  const [photoPickerOpen, setPhotoPickerOpen] = useState(false);
  const [currentDoc, setCurrentDocState] = useState<PageDoc>(initialDoc);
  const [photoUrls, setPhotoUrlsState] =
    useState<Record<string, string>>(initialPhotoUrls);
  // 비동기 저장·재로드는 ref 를 읽는다. ref 는 **아래 커밋 함수에서만** 갱신한다.
  // 렌더에서 미러링(`ref.current = state`)하면 최신본 재로드 직후 렌더 전에 큐에서 실행된 저장이
  // 옛 크기·배경 메타 + 새 기준 버전으로 서버 최신 표지를 덮는다(lib/editor/doc-sync.ts).
  const currentDocRef = useRef<PageDoc>(initialDoc);
  const commitCurrentDoc = useCallback((next: PageDoc) => {
    currentDocRef.current = next;
    setCurrentDocState(next);
  }, []);
  const photoUrlsRef = useRef<Record<string, string>>(initialPhotoUrls);
  const commitPhotoUrls = useCallback((next: Record<string, string>) => {
    photoUrlsRef.current = next;
    setPhotoUrlsState(next);
  }, []);
  /** 저장을 서버 호출 없이 멈춘 사유(doc-sync SaveBlockReason). */
  const saveBlockRef = useRef<SaveBlockReason | null>(null);
  const [showGuide, setShowGuide] = useState(true);
  const [title, setTitle] = useState(projectTitle);
  const [titleSaving, setTitleSaving] = useState(false);
  const lastSavedTitleRef = useRef(projectTitle);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewPng, setPreviewPng] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  // dirty 저장 실패 상태로 미리보기 진행 중 — 모달 내부 배너로 알림.
  const [previewStale, setPreviewStale] = useState(false);
  // 첫 저장(책 완성) 축하 1회 — 이미 저장된 표지로 들어온 세션은 발화하지 않음.
  const celebratedRef = useRef(!initialIsDefault);

  // 모바일 뷰포트 감지 (md 미만) — 면 단위 편집/사진 시트 분기.
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    const update = () => setIsMobile(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  // 모바일 면 단위 편집 상태 — 기본 앞표지 중심 뷰.
  const [coverSegment, setCoverSegment] = useState<CoverSegment>("front");
  const scrollBoxRef = useRef<HTMLDivElement>(null);
  const [stageBoxWidth, setStageBoxWidth] = useState<number | null>(null);

  // 표지 차원 (책등 두께 표시용)
  const dims = calcCoverDimensions({ bookSize, pageCount });
  const spineTooNarrow = dims.spineMm < SPINE_TEXT_MIN_MM;
  // 구버전(2배 폭) 규격으로 저장된 cover_json 감지 — 자동 변환 없이 배너로 안내.
  const legacyWidthMismatch =
    Math.abs(currentDoc.widthMm - dims.totalWidthMm) > 0.5;

  // beforeunload guard
  useEffect(() => {
    function onBeforeUnload(e: BeforeUnloadEvent) {
      if (!dirty) return;
      e.preventDefault();
      e.returnValue = "저장되지 않은 변경 사항이 있어요.";
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  /** 라이브 캔버스를 현재 meta 기준 PageDoc 으로 직렬화. */
  const serializeLive = useCallback((): PageDoc | null => {
    const handle = stageRef.current;
    if (!handle) return null;
    const docMeta = currentDocRef.current;
    return handle.serialize({
      version: PAGEDOC_VERSION,
      bookSizeId: bookSize.id,
      pageNo: 0,
      layoutMode: "cover",
      widthMm: docMeta.widthMm,
      heightMm: docMeta.heightMm,
      bleedMm: 2,
      backgroundColor: docMeta.backgroundColor,
      backgroundImage: docMeta.backgroundImage,
    });
  }, [bookSize.id]);

  /**
   * 캔버스에 문서를 올린다. 실패해도 던지지 않고 false — 저장을 멈추고 새로고침을 안내한다
   * (캔버스가 문서를 반영하지 못한 채 저장하면 화면과 다른 내용·빈 표지가 서버를 덮는다).
   */
  const loadIntoStage = useCallback(
    async (doc: PageDoc, urls: Record<string, string>): Promise<boolean> => {
      const handle = stageRef.current;
      if (!handle) return false;
      try {
        await handle.loadDoc(doc, urls);
      } catch (err) {
        console.warn("[CoverEditor] 표지 캔버스 로드 실패", err);
        if (saveBlockRef.current === null) saveBlockRef.current = "load_failed";
        setError(SAVE_BLOCK_MESSAGES.load_failed);
        toast({
          title: "표지를 불러오지 못했어요",
          description: SAVE_BLOCK_MESSAGES.load_failed,
          variant: "destructive",
        });
        return false;
      }
      if (saveBlockRef.current === "load_failed") {
        saveBlockRef.current = null;
        setError(null);
      }
      return true;
    },
    [],
  );

  /**
   * 서버 최신 표지와 기준 버전을 맞춘다. 저장 큐 안에서만 호출할 것.
   *  - "stale": 진입 직후 확인. 라우터 캐시(staleTimes.dynamic)·뒤로가기로 저장 이전 문서가
   *    올라왔으면 최신본으로 교체한다(QA-2: 옛 문서가 자동저장으로 최신본을 덮던 문제).
   *  - "conflict": 저장이 409 로 거절됨 — 로컬 변경을 버리고 최신본을 올린다.
   * 버전이 같으면 아무것도 하지 않는다.
   */
  const syncWithServer = useCallback(
    async (reason: "stale" | "conflict"): Promise<void> => {
      const handle = stageRef.current;
      if (!handle) return;
      let data: CoverLatestResponse | undefined;
      try {
        const res = await fetchJsonWithTimeout(
          `/api/cover?projectId=${encodeURIComponent(projectId)}`,
          { cache: "no-store" },
          SYNC_FETCH_TIMEOUT_MS,
        );
        const json = res.body as {
          ok?: boolean;
          data?: CoverLatestResponse;
        } | null;
        data = res.ok && json?.ok ? json.data : undefined;
      } catch {
        data = undefined;
      }
      const decision = decideLatestDoc(
        data ? { version: data.version, doc: data.coverJson } : undefined,
        baseVersionRef.current,
        isPageDoc,
      );
      if (decision.kind === "unavailable") {
        // 진입 확인 실패는 조용히 넘긴다 — 저장 시 서버가 409 로 다시 막아준다.
        if (reason === "conflict") {
          setError("최신 표지를 불러오지 못했어요. 새로고침해주세요.");
        }
        return;
      }
      if (decision.kind === "up_to_date") return;
      if (decision.kind === "unreadable") {
        // 기준을 바꾸지 않으면 저장마다 409 가 반복된다 — 새로고침 전까지 저장을 멈춘다.
        saveBlockRef.current = "server_doc_unreadable";
        setError(SAVE_BLOCK_MESSAGES.server_doc_unreadable);
        toast({
          title: "저장을 멈췄어요",
          description: SAVE_BLOCK_MESSAGES.server_doc_unreadable,
          variant: "destructive",
        });
        return;
      }

      const editedBeforeSync = editSeqRef.current > 0;
      const latestPhotoUrls = data?.photoUrls ?? {};
      // 메타 커밋(동기) → 캔버스 로드 → 기준 버전 커밋. 큐에서 기다리던 저장이 렌더 전에 돌아도
      // 새 메타·새 기준을 함께 읽는다. 로드 실패 시 기준은 옛 값 그대로(저장은 409 로 막힌다).
      const result = await reloadEditorDoc({
        doc: decision.doc,
        version: decision.version,
        commitMeta: (doc) => {
          commitPhotoUrls({ ...photoUrlsRef.current, ...latestPhotoUrls });
          commitCurrentDoc(doc);
        },
        loadCanvas: (doc) => loadIntoStage(doc, photoUrlsRef.current),
        commitVersion: (version) => {
          baseVersionRef.current = version;
        },
        readEditSeq: () => editSeqRef.current,
      });
      if (!result.loaded) return;
      editSeqRef.current += 1;
      const isDefault = data?.isDefault === true;
      // 서버에도 표지가 없으면(기본값) 진입 때와 같이 자동저장 대상이다.
      // 로드를 기다리는 동안 추가한 객체는 캔버스에 보존됐다 — dirty 를 내리지 않는다.
      setDirty(isDefault || result.editedDuringLoad);
      if (!isDefault) celebratedRef.current = true;
      if (saveBlockRef.current === null) setError(null);
      // 자동저장 재무장 — dirty 가 true 로 유지되면 effect 가 다시 돌지 않는다.
      setStageLoadedAt(Date.now());
      // 로드 중 추가한 객체는 보존·저장되므로 "변경이 저장되지 않았다" 안내 조건에 넣지 않는다.
      if (reason === "conflict" || editedBeforeSync) {
        toast({
          title: "최신 표지를 불러왔어요",
          description:
            "다른 곳에서 먼저 저장된 내용이 있어 방금 변경은 저장되지 않았어요.",
          variant: "warning",
        });
      }
    },
    [commitCurrentDoc, commitPhotoUrls, loadIntoStage, projectId],
  );

  const save = useCallback(
    (): Promise<SaveOutcome> =>
      saveQueueRef.current.run(async (): Promise<SaveOutcome> => {
        const handle = stageRef.current;
        if (!handle) return "skipped";
        // 템플릿 적용·undo 복원이 진행 중이면 끝난 캔버스를 저장한다.
        if (!(await handle.whenIdle(STAGE_IDLE_TIMEOUT_MS))) {
          setError("표지를 불러오는 중이라 저장하지 못했어요. 잠시 후 다시 시도해주세요.");
          return "failed";
        }
        const blockReason = saveBlockRef.current;
        if (blockReason !== null) {
          setError(SAVE_BLOCK_MESSAGES[blockReason]);
          toast({
            title: "저장을 멈췄어요",
            description: SAVE_BLOCK_MESSAGES[blockReason],
            variant: "destructive",
          });
          return "blocked";
        }
        const seq = editSeqRef.current;
        // 메타는 렌더가 아니라 커밋 시점에 갱신된 ref 에서 읽는다(최신본 재로드 직후 저장 대비).
        const docMeta = currentDocRef.current;
        const result = handle.serializeForSave({
          version: PAGEDOC_VERSION,
          bookSizeId: bookSize.id,
          pageNo: 0,
          layoutMode: "cover",
          widthMm: docMeta.widthMm,
          heightMm: docMeta.heightMm,
          bleedMm: 2,
          backgroundColor: docMeta.backgroundColor,
          backgroundImage: docMeta.backgroundImage,
        });
        if (!result.ok) {
          if (result.reason === "not_ready") return "skipped";
          // 서버에 보내면 화면에 보이는 요소가 저장본에서 사라진다 — 덮어쓰기 금지.
          setError(SAVE_BLOCKED_MESSAGE);
          toast({
            title: "저장을 멈췄어요",
            description: SAVE_BLOCKED_MESSAGE,
            variant: "destructive",
          });
          return "blocked";
        }
        const doc = result.doc;
        setSaving(true);
        setError(null);
        try {
          const res = await fetch(`/api/cover`, {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              projectId,
              fabricJson: doc,
              baseVersion: baseVersionRef.current,
            }),
          });
          const json: unknown = await res.json().catch(() => null);
          const outcome = interpretSaveResponse(res.status, json);
          if (outcome.kind === "conflict") {
            // 조용히 덮어쓰지 않는다 — 최신본을 불러오고 알린다.
            await syncWithServer("conflict");
            return "conflict";
          }
          if (outcome.kind === "failed") {
            throw new Error(outcome.message ?? "표지 저장에 실패했어요.");
          }
          if (outcome.version) baseVersionRef.current = outcome.version;
          setSavedAt(Date.now());
          // 저장 요청 중 새 편집이 없을 때만 해제 — 있으면 dirty 유지해 다음 자동저장이 돈다.
          if (editSeqRef.current === seq) {
            setDirty(false);
            commitCurrentDoc(doc);
          }
          // 첫 저장 = 책 완성 순간 — 다음 행동(주문)을 1회 안내.
          if (!celebratedRef.current) {
            celebratedRef.current = true;
            toast({
              title: "책이 완성됐어요!",
              description: "표지까지 저장됐어요. 이제 주문할 수 있어요.",
              variant: "success",
            });
          }
          return "saved";
        } catch (e) {
          setError(e instanceof Error ? e.message : "표지 저장에 실패했어요.");
          return "failed";
        } finally {
          setSaving(false);
        }
      }),
    [bookSize.id, commitCurrentDoc, projectId, syncWithServer],
  );

  // 첫 마운트 시 doc 로드 — FabricStage 준비 완료 시 (lazy load 지원)
  const handleStageReady = useCallback(() => {
    void (async () => {
      try {
        // 실패하면 loadIntoStage 가 저장을 멈추고 안내한다(던지지 않는다).
        await loadIntoStage(initialDoc, initialPhotoUrls);
        // 진입 직후 서버 최신본 확인 — 저장 큐에 넣어 자동저장과 섞이지 않게 한다.
        await saveQueueRef.current.run(() => syncWithServer("stale"));
      } catch (err) {
        console.warn("[CoverEditor] 진입 직후 표지 확인 실패", err);
      } finally {
        // 어떤 경우에도 재무장한다 — 빠지면 미저장 기본 표지의 자동저장이 다시 돌지 않는다.
        setStageLoadedAt(Date.now());
      }
    })();
    // 의도적으로 초기 1회만 로드.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 자동 저장 debounce.
  // savedAt 의존 포함: 저장 중 편집(dirty 유지)된 경우 저장 완료 후 타이머를 재무장한다.
  // stageLoadedAt 의존 포함: 미저장 기본 표지(dirty 로 시작)의 첫 자동저장이 lazy 캔버스 준비 전에
  // 돌아 skipped 되면 다시 돌지 않았다 — 첫 로드가 끝나면 재무장한다.
  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!dirty || !autosave) return;
    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    autosaveTimerRef.current = setTimeout(() => {
      void save();
    }, AUTOSAVE_DEBOUNCE_MS);
    return () => {
      if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    };
  }, [dirty, autosave, save, savedAt, stageLoadedAt]);

  // 클라이언트 네비게이션 전 dirty flush — 실패 시 이동 차단 (편집 무음 유실 방지).
  const flushAndNavigate = useCallback(
    async (href: string) => {
      if (dirty) {
        const outcome = await save();
        // conflict: 최신본을 불러왔다(토스트 안내됨) — 사용자가 확인한 뒤 다시 이동한다.
        // blocked: 저장 중단 안내가 이미 떴다.
        if (outcome === "conflict" || outcome === "blocked") return;
        if (outcome !== "saved") {
          toast({
            description: "저장에 실패해 이동을 멈췄어요. 다시 시도해주세요.",
            variant: "destructive",
          });
          return;
        }
      }
      // 저장 뒤 목적지가 최신 서버 렌더를 보여주게 하는 순서: push → refresh.
      // (Next 14.2.35 shared/lib/router/action-queue.js dispatchAction 근거)
      //  - 예전 순서(refresh → push)는 대기 중인 REFRESH 가 뒤이은 NAVIGATE 에 의해
      //    discarded 되어 결과가 버려졌다 → staleTimes.dynamic=30 캐시가 그대로 재생(QA-2·QA-3).
      //  - push 를 먼저 하면 REFRESH 는 NAVIGATE 뒤에 큐잉되어 이동 완료 후 실행된다.
      //    refresh-reducer 가 **목적지** 트리를 다시 받아오고 prefetchCache 를 비우므로,
      //    캐시된 옛 화면이 잠깐 보이더라도 곧 최신 서버 렌더로 교체된다.
      //  - 에디터 목적지는 props 를 첫 로드에만 쓰므로 진입 시 syncWithServer 가 함께 막는다.
      router.push(href);
      router.refresh();
    },
    [dirty, router, save],
  );

  const onToolPick = useCallback((tool: ToolbarTool) => {
    if (tool === "image") {
      setPhotoSheetOpen(true);
      return;
    }
    setToolSheet(tool);
  }, []);

  // 사진 추가 — 실패 시 signed URL 재발급 1회 재시도 후 토스트.
  const addProjectPhoto = useCallback(
    async (photoId: string) => {
      const url = photoUrlsRef.current[photoId];
      if (!url) return;
      try {
        await stageRef.current?.addPhoto(photoId, url);
      } catch {
        // signed URL 만료(1시간) 가능성 — 재발급 후 1회 재시도.
        try {
          const res = await fetch(
            `/api/cover?projectId=${encodeURIComponent(projectId)}`,
          );
          const json = (await res.json()) as {
            ok: boolean;
            data?: { photoUrls: Record<string, string> };
          };
          const fresh =
            res.ok && json.ok && json.data
              ? json.data.photoUrls[photoId]
              : undefined;
          if (!fresh) throw new Error("photo url refresh failed");
          commitPhotoUrls({
            ...photoUrlsRef.current,
            ...json.data?.photoUrls,
          });
          await stageRef.current?.addPhoto(photoId, fresh);
        } catch {
          toast({
            description:
              "사진을 불러오지 못했어요. 잠시 후 다시 시도해주세요.",
            variant: "destructive",
          });
          return;
        }
      }
      markDirty();
      setPhotoSheetOpen(false);
    },
    [commitPhotoUrls, markDirty, projectId],
  );

  // 뒷표지에 글 추가 — 뒷표지 영역 중앙에 텍스트 박스 자동 배치
  const addBackCoverText = useCallback(() => {
    // FabricStage.addText 는 캔버스 중앙에 추가. 후처리로 좌측(뒷표지) 중앙 이동.
    stageRef.current?.addText({
      text: "뒷표지에 한 줄",
      fontSizePt: 12,
    });
    // 마지막 추가 객체의 left 를 뒷표지 중앙 mm 으로 옮김
    const handle = stageRef.current;
    if (!handle) return;
    const sel = handle.getSelection();
    if (!sel) return;
    // mm → px (PREVIEW_DPI) 직접 계산
    const dpi = PREVIEW_DPI;
    const bleedMm = 2;
    const cxMm = bleedMm + dims.bookWidthMm / 2; // 뒤표지 중앙 (bleed 포함 캔버스 좌표)
    const cyMm = bleedMm + dims.totalHeightMm / 2;
    const cxPx = (cxMm * dpi) / 25.4;
    const cyPx = (cyMm * dpi) / 25.4;
    sel.set({ left: cxPx, top: cyPx });
    sel.canvas?.fire("object:modified", { target: sel });
    sel.canvas?.requestRenderAll();
    markDirty();
  }, [dims, markDirty]);

  // 제목 인라인 저장
  async function persistTitle(next: string) {
    const clean = next.trim();
    if (clean.length === 0 || clean === lastSavedTitleRef.current) {
      setTitle(lastSavedTitleRef.current);
      return;
    }
    setTitleSaving(true);
    try {
      const res = await fetch(`/api/projects/${projectId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: clean }),
      });
      const json = (await res.json()) as {
        ok: boolean;
        error?: { message: string };
      };
      if (!res.ok || !json.ok) {
        throw new Error(json.error?.message ?? "제목 저장 실패");
      }
      lastSavedTitleRef.current = clean;
      setTitle(clean);
    } catch {
      setTitle(lastSavedTitleRef.current);
    } finally {
      setTitleSaving(false);
    }
  }

  // 템플릿 다이얼로그 열기 — 미저장 편집도 추출에 반영되도록 라이브 캔버스로 doc 갱신.
  const openTemplateDialog = useCallback(() => {
    const live = serializeLive();
    if (live) commitCurrentDoc(live);
    setTemplateDialogOpen(true);
  }, [commitCurrentDoc, serializeLive]);

  const onApplyTemplate = useCallback(
    (next: PageDoc) => {
      commitCurrentDoc(next);
      void loadIntoStage(next, photoUrlsRef.current);
      // 로드는 dirty 를 만들지 않는다 — 템플릿 적용은 저장 대상이므로 명시적으로 표시.
      markDirty();
    },
    [commitCurrentDoc, loadIntoStage, markDirty],
  );

  // 구버전 규격 문서 재생성 — 라이브 캔버스에서 사진/제목 추출 후 새 규격으로 재빌드.
  const regenerateCover = useCallback(() => {
    const source = serializeLive() ?? currentDocRef.current;
    const firstPhoto = source.objects.find((o) => o.type === "photo");
    const firstPhotoId =
      firstPhoto && firstPhoto.type === "photo"
        ? firstPhoto.photoId
        : source.backgroundImage?.photoId;
    let extractedTitle = "";
    let maxPt = -Infinity;
    for (const obj of source.objects) {
      if (obj.type === "text" && obj.text && obj.fontSizePt > maxPt) {
        maxPt = obj.fontSizePt;
        extractedTitle = obj.text;
      }
    }
    const next = buildDefaultCoverDoc({
      bookSize,
      pageCount,
      title: extractedTitle || title,
      photoId: firstPhotoId,
    });
    commitCurrentDoc(next);
    // 규격(폭)이 바뀌면 FabricStage 가 캔버스를 새로 만들고 이 문서를 다시 올린다.
    void loadIntoStage(next, photoUrlsRef.current);
    // 로드는 dirty 를 만들지 않는다 — 재생성 결과는 저장 대상이므로 명시적으로 표시.
    markDirty();
    toast({
      description: "새 규격으로 표지를 다시 만들었어요. 확인 후 저장해주세요.",
      variant: "success",
    });
  }, [
    bookSize,
    commitCurrentDoc,
    loadIntoStage,
    markDirty,
    pageCount,
    serializeLive,
    title,
  ]);

  // 폰트 픽 — 텍스트 선택 시 fontFamily 변경, 없으면 새 텍스트 추가 (데스크탑/모바일 공용).
  const applyFontPick = useCallback((family: string) => {
    const sel = stageRef.current?.getSelection();
    if (sel && sel.oType === "text") {
      const tb = sel as unknown as {
        set: (a: { fontFamily: string }) => void;
        canvas?: { fire: (n: string, o: object) => void };
      };
      tb.set({ fontFamily: family });
      tb.canvas?.fire("object:modified", { target: sel });
      markDirty();
    } else {
      stageRef.current?.addText({ fontFamily: family });
      markDirty();
    }
  }, [markDirty]);

  // 배경 픽 — 캔버스 적용 + PageDoc.backgroundImage 메타 갱신 (저장/PDF 반영).
  const applyBackgroundPick = useCallback((url: string) => {
    stageRef.current?.setBackground({ type: "resource", url });
    commitCurrentDoc({
      ...currentDocRef.current,
      backgroundImage: { url, cropMode: "cover", opacity: 1 },
    });
    markDirty();
  }, [commitCurrentDoc, markDirty]);

  // 책등 텍스트 자동 추가 (rotation 90)
  const addSpineText = useCallback(async () => {
    if (spineTooNarrow) {
      toast({
        title: "책등이 좁아요",
        description: `책등이 ${SPINE_TEXT_MIN_MM}mm 미만이라 텍스트가 잘릴 수 있어요. 페이지 수를 늘려보세요.`,
        variant: "warning",
      });
      return;
    }
    const obj = buildSpineText({
      text: title,
      spineMm: dims.spineMm,
      bookHeightMm: dims.bookHeightMm,
      bookLeftMm: dims.bookWidthMm,
      bookTopMm: 0,
    });
    if (!obj) return;
    await stageRef.current?.pasteLayoutObject(obj, {});
    markDirty();
    toast({ description: "책등 텍스트를 추가했어요.", variant: "success" });
  }, [dims, markDirty, spineTooNarrow, title]);

  // 3D 미리보기 열기 — 자동저장 후 서버 PNG 미리보기 요청
  const openPreview = useCallback(async () => {
    setPreviewOpen(true);
    setPreviewError(null);
    setPreviewLoading(true);
    setPreviewPng(null);
    setPreviewStale(false);

    // dirty 면 먼저 저장 (서버 미리보기는 저장된 cover_json 기반)
    if (dirty) {
      const outcome = await save();
      // 저장 실패 시 마지막 저장본으로 진행 — 모달 내부 배너로 알림.
      // conflict 는 최신 저장본을 불러왔으므로 화면과 미리보기가 일치한다.
      if (outcome !== "saved" && outcome !== "conflict") setPreviewStale(true);
    }

    try {
      const res = await fetch(`/api/cover/preview`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId }),
      });
      const json = (await res.json()) as {
        ok: boolean;
        data?: { pngDataUrl: string };
        error?: { message: string };
      };
      if (!res.ok || !json.ok || !json.data) {
        throw new Error(json.error?.message ?? "미리보기 생성 실패");
      }
      setPreviewPng(json.data.pngDataUrl);
    } catch (e) {
      setPreviewError(e instanceof Error ? e.message : "미리보기 생성 실패");
    } finally {
      setPreviewLoading(false);
    }
  }, [dirty, projectId, save]);

  // 모바일 면 단위 확대 — 선택 면이 화면 폭을 채우도록 캔버스 컨테이너 폭을 넓히고
  // 가로 스크롤로 해당 면 중앙에 정렬한다. (FabricStage 는 부모 폭에 fit)
  useEffect(() => {
    const box = scrollBoxRef.current;
    if (!box) return;
    if (!isMobile || coverSegment === "all") {
      setStageBoxWidth(null);
      return;
    }
    const totalMm = currentDoc.widthMm + 4; // bleed 2mm 양쪽 포함 캔버스 폭
    const visibleMm =
      coverSegment === "spine"
        ? Math.max(dims.spineMm + 24, 36)
        : dims.bookWidthMm + 8;
    const containerW = box.clientWidth;
    if (!containerW || visibleMm <= 0 || totalMm <= 0) return;
    // FabricStage maxFitScale(=SEGMENT_MAX_FIT_SCALE)까지 업스케일 허용 —
    // 책등처럼 좁은 면도 화면 폭을 채워 편집 가능(벡터 렌더라 선명도 유지).
    const maxWidthPx =
      ((totalMm * PREVIEW_DPI) / 25.4) * SEGMENT_MAX_FIT_SCALE;
    const width = Math.min(containerW * (totalMm / visibleMm), maxWidthPx);
    setStageBoxWidth(width);

    const centerTrimMm =
      coverSegment === "back"
        ? dims.bookWidthMm / 2
        : coverSegment === "spine"
          ? dims.bookWidthMm + dims.spineMm / 2
          : dims.bookWidthMm + dims.spineMm + dims.bookWidthMm / 2;
    const frac = (2 + centerTrimMm) / totalMm;
    // FabricStage 리사이즈 debounce(150ms) 이후 스크롤 — 확대 완료 시점에 정렬.
    const t = setTimeout(() => {
      box.scrollTo({
        left: Math.max(0, frac * width - box.clientWidth / 2),
        behavior: "smooth",
      });
    }, 200);
    return () => clearTimeout(t);
  }, [isMobile, coverSegment, currentDoc.widthMm, dims.bookWidthMm, dims.spineMm]);

  return (
    <div className="flex min-h-[calc(100dvh-4rem)] flex-col">
      {/* 상단 헤더 */}
      <header className="sticky top-0 z-30 flex flex-wrap items-center gap-2 border-b bg-background/95 px-3 py-2 backdrop-blur md:px-6">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void flushAndNavigate(`/editor/${projectId}`)}
        >
          ← 내지 편집
        </Button>
        <span className="text-xs uppercase tracking-widest text-coral/90">
          step 3 of 4 · 표지 편집
        </span>

        <label htmlFor="cover-title" className="sr-only">
          프로젝트 제목
        </label>
        <input
          id="cover-title"
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={(e) => void persistTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              (e.currentTarget as HTMLInputElement).blur();
            }
          }}
          disabled={titleSaving}
          aria-label="프로젝트 제목"
          className="ml-1 max-w-[12rem] flex-1 truncate bg-transparent text-sm font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring sm:max-w-md md:text-base"
        />

        <div className="ml-auto flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={openTemplateDialog}
          >
            기본 템플릿 적용
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void openPreview()}
            aria-label="3D 미리보기 열기"
          >
            <Eye className="size-4" aria-hidden />
            <span className="hidden sm:inline ml-1">3D 미리보기</span>
          </Button>

          <label className="hidden items-center gap-2 text-xs text-muted-foreground md:flex">
            <input
              type="checkbox"
              checked={autosave}
              onChange={(e) => setAutosave(e.target.checked)}
            />
            자동 저장
          </label>
          <Button
            onClick={() => void save()}
            disabled={saving}
            size="sm"
            variant="gradient"
          >
            <Save className="size-4" aria-hidden />
            {saving ? "저장 중…" : dirty ? "저장" : "저장됨"}
          </Button>
          <Button
            variant="coral"
            size="sm"
            disabled={saving}
            onClick={() => void flushAndNavigate(`/order/${projectId}`)}
            aria-label="다음: 주문"
          >
            다음: 주문
          </Button>
        </div>
        <div className="basis-full text-xs text-muted-foreground">
          <span>책등 {dims.spineMm.toFixed(2)}mm · 페이지 {pageCount}p · </span>
          <span>총 폭 {dims.totalWidthMm.toFixed(1)}mm × 높이 {dims.totalHeightMm.toFixed(1)}mm</span>
          {savedAt ? (
            <span className="ml-2">
              · 마지막 저장 {new Date(savedAt).toLocaleTimeString()}
            </span>
          ) : null}
          {error ? (
            <span className="ml-2 text-destructive" role="alert">
              {error}
            </span>
          ) : null}
        </div>
      </header>

      <div className="flex flex-1 flex-col gap-3 p-3 md:flex-row md:gap-4 md:p-6">
        {/* 좌측 — 도구 + 팔레트 (데스크탑) */}
        <aside
          aria-label="도구 / 리소스"
          className={cn("hidden md:flex md:w-72 md:shrink-0 md:flex-col md:gap-3")}
        >
          <Toolbar
            onPick={onToolPick}
            onUndo={() => stageRef.current?.undo()}
            onRedo={() => stageRef.current?.redo()}
            onDelete={() => stageRef.current?.remove()}
            canUndo={canUndo}
            canRedo={canRedo}
            hasSelection={Boolean(selection)}
            mobile={false}
          />
          <div className="space-y-2 rounded-lg border bg-white/40 p-2">
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              onClick={addBackCoverText}
            >
              뒷표지에 글 추가
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              onClick={() => void addSpineText()}
              disabled={spineTooNarrow}
              title={
                spineTooNarrow
                  ? `책등이 ${SPINE_TEXT_MIN_MM}mm 미만이라 텍스트가 잘릴 수 있어요.`
                  : "책등에 세로 제목 텍스트를 추가합니다."
              }
            >
              책등 텍스트 추가
              {spineTooNarrow ? (
                <span className="ml-1 text-[10px] text-muted-foreground">
                  (너무 좁아요)
                </span>
              ) : null}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              onClick={() => setPhotoSheetOpen(true)}
              disabled={projectPhotos.length === 0}
            >
              표지에 사진 추가
            </Button>
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={showGuide}
                onChange={(e) => setShowGuide(e.target.checked)}
              />
              영역 가이드 표시
            </label>
          </div>
          <div className="min-h-0 flex-1 rounded-lg border bg-white/40 p-2">
            <ResourcePalette
              initialTab={
                toolSheet === "background"
                  ? "background"
                  : toolSheet === "clipart"
                    ? "clipart"
                    : "font"
              }
              onPickFont={applyFontPick}
              onPickClipart={(url, resourceId) => {
                void stageRef.current?.addClipart(url, resourceId);
                markDirty();
              }}
              onPickBackground={applyBackgroundPick}
            />
          </div>
        </aside>

        {/* 중앙 — Stage + 가이드 오버레이 */}
        <main className="flex min-h-0 flex-1 flex-col items-center justify-start gap-3">
          {legacyWidthMismatch ? (
            <div
              role="alert"
              className="w-full rounded-lg border border-amber-300/60 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800/60 dark:bg-amber-950/40 dark:text-amber-200"
            >
              <p className="font-medium">표지 규격이 갱신되었어요</p>
              <p className="mt-1">
                이 표지는 이전 규격(
                {currentDoc.widthMm.toFixed(1)}mm)으로 만들어져 현재 인쇄 규격(
                {dims.totalWidthMm.toFixed(1)}mm)과 달라요. 새 규격으로 다시
                만들면 첫 사진과 제목은 이어져요.
              </p>
              <Button
                size="sm"
                variant="outline"
                className="mt-2"
                onClick={regenerateCover}
              >
                새 규격으로 다시 만들기
              </Button>
            </div>
          ) : null}

          {/* 모바일 — 면 단위 편집 세그먼트 */}
          <div
            role="group"
            aria-label="표지 편집 영역 선택"
            className="flex w-full items-center gap-1 md:hidden"
          >
            {SEGMENTS.map((s) => (
              <Button
                key={s.id}
                type="button"
                size="sm"
                variant={coverSegment === s.id ? "default" : "outline"}
                className="min-h-11 flex-1"
                aria-pressed={coverSegment === s.id}
                onClick={() => setCoverSegment(s.id)}
              >
                {s.label}
              </Button>
            ))}
          </div>

          {/* 모바일에선 선택한 면(앞·책등·뒤)을 화면 폭에 맞춰 확대하고 가로 스크롤로 이동. */}
          <div ref={scrollBoxRef} className="relative w-full overflow-x-auto">
            <div
              className="relative inline-block min-w-full"
              style={stageBoxWidth !== null ? { width: stageBoxWidth } : undefined}
            >
              <FabricStage
                ref={stageRef}
                widthMm={currentDoc.widthMm}
                heightMm={currentDoc.heightMm}
                bleedMm={2}
                dpi={PREVIEW_DPI}
                maxFitScale={
                  isMobile && coverSegment !== "all" ? SEGMENT_MAX_FIT_SCALE : 1
                }
                onSelectionChange={setSelection}
                onModified={markDirty}
                onHistoryChange={(u, r) => {
                  setCanUndo(u);
                  setCanRedo(r);
                }}
                onReady={handleStageReady}
              />
              {showGuide ? (
                <CoverSpineGuide
                  dims={dims}
                  pageCount={pageCount}
                  visible={showGuide}
                />
              ) : null}
            </div>
          </div>
        </main>

        {/* 우측 — SelectionPanel */}
        <aside
          aria-label="속성"
          className="hidden md:block md:w-72 md:shrink-0"
        >
          <SelectionPanel
            selection={selection}
            dpi={PREVIEW_DPI}
            onChange={markDirty}
            onReplacePhoto={() => setPhotoPickerOpen(true)}
          />
        </aside>
      </div>

      {/* 하단 (모바일) — Toolbar (safe-area 패딩 포함) */}
      <div className="sticky bottom-0 z-20 border-t bg-background/95 p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] backdrop-blur md:hidden">
        <Toolbar
          mobile
          onPick={onToolPick}
          onUndo={() => stageRef.current?.undo()}
          onRedo={() => stageRef.current?.redo()}
          onDelete={() => stageRef.current?.remove()}
          canUndo={canUndo}
          canRedo={canRedo}
          hasSelection={Boolean(selection)}
        />
      </div>

      {/* 모바일 툴 바텀시트 */}
      <MobileBottomSheet
        open={toolSheet !== null}
        onOpenChange={(o) => !o && setToolSheet(null)}
        title={
          toolSheet === "text"
            ? "텍스트"
            : toolSheet === "clipart"
              ? "클립아트"
              : toolSheet === "background"
                ? "배경"
                : "레이어"
        }
      >
        {toolSheet === "text" ? (
          selection ? (
            <SelectionPanel
              selection={selection}
              dpi={PREVIEW_DPI}
              onChange={markDirty}
              onReplacePhoto={() => setPhotoPickerOpen(true)}
            />
          ) : (
            <div className="space-y-2">
              <Button
                variant="outline"
                className="min-h-11 w-full"
                onClick={() => {
                  stageRef.current?.addText();
                  markDirty();
                  setToolSheet(null);
                }}
              >
                텍스트 추가
              </Button>
              <Button
                variant="outline"
                className="min-h-11 w-full"
                onClick={() => {
                  addBackCoverText();
                  setToolSheet(null);
                }}
              >
                뒷표지에 글 추가
              </Button>
              <Button
                variant="outline"
                className="min-h-11 w-full"
                onClick={() => {
                  void addSpineText();
                  setToolSheet(null);
                }}
                disabled={spineTooNarrow}
              >
                책등 텍스트 추가
                {spineTooNarrow ? (
                  <span className="ml-1 text-[10px] text-muted-foreground">
                    (너무 좁아요)
                  </span>
                ) : null}
              </Button>
              <label className="flex min-h-11 items-center gap-2 text-sm text-muted-foreground">
                <input
                  type="checkbox"
                  checked={showGuide}
                  onChange={(e) => setShowGuide(e.target.checked)}
                  className="size-4 rounded border-input"
                />
                영역 가이드 표시
              </label>
            </div>
          )
        ) : toolSheet === "clipart" || toolSheet === "background" ? (
          <ResourcePalette
            initialTab={toolSheet}
            onPickFont={(family) => {
              applyFontPick(family);
              setToolSheet(null);
            }}
            onPickClipart={(url, resourceId) => {
              void stageRef.current?.addClipart(url, resourceId);
              markDirty();
              setToolSheet(null);
            }}
            onPickBackground={(url) => {
              applyBackgroundPick(url);
              setToolSheet(null);
            }}
          />
        ) : toolSheet === "layer" ? (
          <div className="space-y-2">
            <Button
              variant="outline"
              className="w-full"
              onClick={() => stageRef.current?.bringForward()}
              disabled={!selection}
            >
              앞으로 보내기
            </Button>
            <Button
              variant="outline"
              className="w-full"
              onClick={() => stageRef.current?.sendBackward()}
              disabled={!selection}
            >
              뒤로 보내기
            </Button>
          </div>
        ) : null}
      </MobileBottomSheet>

      {/* 사진 추가 — 모바일: 바텀시트 / 데스크탑: 중앙 다이얼로그 */}
      {isMobile ? (
        <MobileBottomSheet
          open={photoSheetOpen}
          onOpenChange={setPhotoSheetOpen}
          title="표지에 사진 추가"
          description={
            projectPhotos.length === 0
              ? "프로젝트에 사진이 없어요."
              : "프로젝트 사진 중에서 선택하세요."
          }
        >
          <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {projectPhotos.map((p) => {
              const url = photoUrls[p.id];
              return (
                <li key={p.id}>
                  <button
                    type="button"
                    className="block aspect-square w-full overflow-hidden rounded-md border border-border bg-card"
                    onClick={() => void addProjectPhoto(p.id)}
                    aria-label={p.filename ?? p.id}
                  >
                    {url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={url}
                        alt={p.filename ?? ""}
                        loading="lazy"
                        className="size-full object-cover"
                      />
                    ) : (
                      <span className="block size-full bg-muted/40" />
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </MobileBottomSheet>
      ) : (
        <PhotoPickerDialog
          open={photoSheetOpen}
          onOpenChange={setPhotoSheetOpen}
          currentProjectId={projectId}
          title="표지에 사진 추가"
          description="표지에 올릴 사진을 선택하세요."
          onPick={async (photoId, url) => {
            await stageRef.current?.addPhoto(photoId, url);
            commitPhotoUrls({ ...photoUrlsRef.current, [photoId]: url });
            markDirty();
          }}
          onNavigateToUpload={() =>
            flushAndNavigate(`/upload?projectId=${projectId}`)
          }
        />
      )}

      {/* 표지 템플릿 변경 다이얼로그 */}
      <CoverTemplateDialog
        open={templateDialogOpen}
        onOpenChange={setTemplateDialogOpen}
        doc={currentDoc}
        bookSize={bookSize}
        pageCount={pageCount}
        onApply={onApplyTemplate}
      />

      {/* 사진 선택 / 교체 */}
      <PhotoPickerDialog
        open={photoPickerOpen}
        onOpenChange={setPhotoPickerOpen}
        currentProjectId={projectId}
        title="사진 교체"
        description="현재 선택된 사진을 다른 사진으로 교체합니다."
        onPick={async (photoId, url) => {
          const handle = stageRef.current;
          if (!handle) return;
          await handle.replacePhoto(photoId, url);
          markDirty();
          toast({ description: "사진 교체 완료", variant: "success" });
        }}
        onNavigateToUpload={() =>
          flushAndNavigate(`/upload?projectId=${projectId}`)
        }
      />

      {/* 3D 미리보기 다이얼로그 — Radix (포커스 트랩/ESC/스크롤 락/포커스 복귀) */}
      <DialogPrimitive.Root open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/50 backdrop-blur-[2px] data-[state=open]:animate-in data-[state=open]:fade-in-0" />
          <DialogPrimitive.Content
            className={cn(
              "fixed left-1/2 top-1/2 z-50 w-[min(94vw,720px)] -translate-x-1/2 -translate-y-1/2",
              "max-h-[90dvh] overflow-y-auto",
              "rounded-xl border border-border bg-background p-5 shadow-soft-lg",
            )}
          >
            <div className="flex items-start justify-between gap-3 pb-3">
              <div>
                <DialogPrimitive.Title className="text-base font-semibold">
                  표지 3D 미리보기
                </DialogPrimitive.Title>
                <DialogPrimitive.Description className="mt-1 text-sm text-muted-foreground">
                  실제 인쇄/제본 후의 입체 형태를 근사로 보여줘요.
                </DialogPrimitive.Description>
              </div>
              <DialogPrimitive.Close
                aria-label="닫기"
                className="relative -mt-1 inline-flex size-9 items-center justify-center rounded-md text-muted-foreground after:absolute after:-inset-1 after:content-[''] hover:bg-accent"
              >
                <X className="size-5" />
              </DialogPrimitive.Close>
            </div>

            {previewStale ? (
              <div
                role="alert"
                className="mb-3 rounded-md border border-amber-300/60 bg-amber-50 p-2.5 text-sm text-amber-900 dark:border-amber-800/60 dark:bg-amber-950/40 dark:text-amber-200"
              >
                저장에 실패해 마지막 저장본으로 미리보기를 보여드려요. 닫고 다시
                저장해주세요.
              </div>
            ) : null}

            <div className="flex min-h-[360px] items-center justify-center overflow-hidden rounded-lg bg-gradient-to-br from-coral-50/40 via-amber-50/30 to-sky-50/40 dark:from-coral-950/20 dark:via-amber-950/20 dark:to-sky-950/20">
              {previewLoading ? (
                <div className="text-sm text-muted-foreground" role="status">
                  미리보기를 그리는 중…
                </div>
              ) : previewError ? (
                <div className="text-sm text-destructive" role="alert">
                  {previewError}
                </div>
              ) : (
                <Cover3DPreview
                  coverPng={previewPng ?? undefined}
                  bookWidthMm={dims.bookWidthMm}
                  bookHeightMm={dims.bookHeightMm}
                  spineMm={dims.spineMm}
                  pageCount={pageCount}
                />
              )}
            </div>

            <div className="mt-3 flex items-center justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => void openPreview()}
                disabled={previewLoading}
              >
                다시 그리기
              </Button>
              <DialogPrimitive.Close asChild>
                <Button size="sm" variant="gradient">
                  닫기
                </Button>
              </DialogPrimitive.Close>
            </div>
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
    </div>
  );
}

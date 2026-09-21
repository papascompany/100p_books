"use client";

import { ChevronLeft, ChevronRight, Eye, Keyboard, Save } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import dynamic from "next/dynamic";

import CollageTemplateDialog from "@/components/editor/CollageTemplateDialog";
import type { FabricStageHandle } from "@/components/editor/FabricStage";
// ⚠️ dynamic() 직접 사용 금지 — ref 가 끊겨 stageRef 가 null 이 된다(저장 no-op).
// 근거는 components/editor/FabricStageLazy.tsx 상단 주석.
import FabricStage from "@/components/editor/FabricStageLazy";
const PREVIEW_DPI = 72;
import KeyboardShortcutsHelp, {
  useShortcutsAutoShow,
} from "@/components/editor/KeyboardShortcutsHelp";
import MobileToolbar, { type MobileTab } from "@/components/editor/MobileToolbar";
import PagePreviewDialog from "@/components/editor/PagePreviewDialog";
import PhotoPickerDialog from "@/components/editor/PhotoPickerDialog";
import ReadOnlyNotice from "@/components/editor/ReadOnlyNotice";
import ResourcePalette from "@/components/editor/ResourcePalette";
const SelectionPanel = dynamic(() => import("@/components/editor/SelectionPanel"), { ssr: false });
import Toolbar, { type ToolbarTool } from "@/components/editor/Toolbar";
import MobileBottomSheet from "@/components/layout/MobileBottomSheet";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
  createEditLockGate,
  decideNavigationAfterSave,
  interpretSaveResponse,
  LEAVE_WITHOUT_SAVING_CONFIRM,
  type SaveOutcome,
} from "@/lib/editor/edit-conflict";
// fabricClipboard: 실제 사용 시점에 동적으로 import (fabric.js 번들 분리)
const getClipboard = () => import("@/lib/fabric/clipboard").then((m) => m.fabricClipboard);
import type { LoadDocResult } from "@/lib/fabric/load-guards";
import type { TaggedFabricObject } from "@/lib/fabric/serialize";
import {
  isPageDoc,
  PAGEDOC_VERSION,
  type BackgroundImage,
  type PageDoc,
  type PageLayoutMode,
} from "@/lib/layout/types";
import { cn } from "@/lib/utils";

export interface PageEditorProps {
  projectId: string;
  projectTitle: string;
  pageId: string;
  pageNo: number;
  initialDoc: PageDoc | null;
  /** 저장된 fabric_json 의 내용 버전(lib/editor/doc-version). PATCH baseVersion 기준. */
  initialVersion: string;
  initialPhotoUrls: Record<string, string>;
  bookSize: BookSize;
  prevPageId: string | null;
  nextPageId: string | null;
  /** 프로젝트의 모든 페이지 — 페이지 번호 점프용. */
  siblings?: { id: string; pageNo: number }[];
  /**
   * 결제 후 편집 잠금 안내(서버 페이지가 진입 시 판정). null 이면 편집 가능.
   * 값이 있으면 읽기 전용으로 열고 배너로 안내한다 — 저장 409 PROJECT_LOCKED 때 다시 토스트하지 않는다.
   */
  initialLockMessage: string | null;
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
    "페이지를 화면에 불러오지 못해 저장을 멈췄어요. 새로고침하면 마지막 저장본을 다시 불러와요.",
  server_doc_unreadable:
    "서버에 저장된 페이지를 이 화면에서 읽을 수 없어 저장을 멈췄어요. 새로고침한 뒤 다시 편집해주세요.",
};

/** GET /api/pages/[id] 응답 중 최신본 동기화에 쓰는 필드. */
interface PageLatestResponse {
  fabricJson: unknown;
  photoUrls: Record<string, string>;
  version: string;
}

/** 사진 선택 다이얼로그의 진입 경로 — 추가/교체 플로우 분리. */
type PhotoPickerMode = "add" | "replace";

/**
 * 페이지 단일 편집 클라이언트.
 *
 * 레이아웃:
 *   - 데스크탑: 좌측 ResourcePalette / 중앙 FabricStage / 우측 SelectionPanel
 *   - 모바일:   상단 미니 헤더 / 가운데 FabricStage / 하단 MobileToolbar(퀵 바 + 탭 바)
 *
 * 모바일:
 *   - 퀵 바: Undo/Redo 상시 노출 + 선택 객체 도구(복제/앞뒤/삭제/더보기).
 *     캔버스를 가리지 않는 비모달 — 객체 탭 시 자동 시트 오픈은 하지 않는다.
 *   - 탭 바: 도구(Toolbar) / 레이어(SelectionPanel) / 추가(사진·텍스트·클립아트·배경)
 *
 * 저장:
 *   - 수동: "저장" 버튼. 자동: 토글(기본 ON). 변경 후 5초 debounce.
 *   - PATCH 에 baseVersion 동봉 — 서버가 더 새로우면 409, 최신본을 다시 불러오고 알린다.
 *   - 저장은 한 줄로 직렬화하고 캔버스 로드·복원이 끝난 뒤 직렬화한다.
 *   - 태그 없는 객체가 섞이면 저장을 중단한다(빈 페이지 덮어쓰기 방지).
 *   - 진입 직후 서버 최신본과 버전을 비교해 라우터 캐시로 옛 문서가 올라왔으면 교체한다.
 *   - 페이지 이동(이전/다음/점프/J·K)은 dirty 면 저장 후 이동, 저장하지 못하면(차단·실패) confirm.
 *   - 409 PROJECT_LOCKED(결제 후 편집 잠금): 서버 안내를 한 번 보여주고 읽기 전용으로 전환한다
 *     (도구 숨김·자동저장 중단·dirty 해제로 이탈 경고 해제). 이후 저장은 서버 호출 없이 "locked".
 *   - 하드 내비게이션(새로고침/탭 닫기)은 beforeunload 로 경고.
 *   - 배경(색/이미지)은 metaRef 로 추적해 serialize meta 로 전달 — 저장 시 보존.
 */
export default function PageEditor({
  projectId,
  projectTitle,
  pageId,
  pageNo,
  initialDoc,
  initialVersion,
  initialPhotoUrls,
  bookSize,
  prevPageId,
  nextPageId,
  siblings = [],
  initialLockMessage,
}: PageEditorProps) {
  const router = useRouter();
  const stageRef = useRef<FabricStageHandle>(null);
  const [selection, setSelection] = useState<TaggedFabricObject | null>(null);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [autosave, setAutosave] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [dirty, setDirty] = useState(false);
  /** 최신본 재로드 완료 시각 — 로드 중 편집으로 dirty 가 true 로 유지될 때 자동저장 재무장. */
  const [docReloadedAt, setDocReloadedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toolSheet, setToolSheet] = useState<ToolbarTool | null>(null);
  const [collageOpen, setCollageOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [photoPicker, setPhotoPicker] = useState<PhotoPickerMode | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [currentDoc, setCurrentDoc] = useState<PageDoc | null>(initialDoc);
  /** 서버 fabric_json 기준 버전 — 저장 성공·최신본 재로드 때 갱신. */
  const baseVersionRef = useRef(initialVersion);
  /** 저장·최신본 확인 직렬화 — 동시에 나간 저장이 서로를 409 로 만들지 않게. */
  const saveQueueRef = useRef(createSerialQueue());
  /** photoId → signed URL. 최신본 재로드 시 새 사진 URL 이 합쳐진다. */
  const photoUrlsRef = useRef<Record<string, string>>(initialPhotoUrls);
  /** 저장을 서버 호출 없이 멈춘 사유(doc-sync SaveBlockReason). */
  const saveBlockRef = useRef<SaveBlockReason | null>(null);
  /** 결제 후 편집 잠금 — 한 번 잠기면 새로고침 전까지 읽기 전용(lib/editor/edit-conflict.ts). */
  const lockGateRef = useRef(createEditLockGate(initialLockMessage));
  const [lockMessage, setLockMessage] = useState<string | null>(initialLockMessage);
  const readOnly = lockMessage !== null;

  // M17-9: 모바일 탭 바 상태
  // null = 모든 시트 닫힘, 값 = 해당 시트 오픈
  const [mobileTab, setMobileTab] = useState<MobileTab | null>(null);

  // 편집 시퀀스 — 저장 요청 중 발생한 편집을 dirty 해제에서 보호 (EC-16).
  const editSeqRef = useRef(0);
  const markDirty = useCallback(() => {
    // 읽기 전용이면 저장할 수 없는 변경이다 — dirty(자동저장·이탈 경고)를 만들지 않는다.
    if (lockGateRef.current.locked) return;
    editSeqRef.current += 1;
    setDirty(true);
  }, []);

  /**
   * 409 PROJECT_LOCKED → 읽기 전용 전환. 안내 토스트는 처음 잠길 때 한 번만(진입 배너로 이미 알렸으면 생략).
   * dirty 를 내려 자동저장 타이머와 beforeunload 경고를 끈다 — 저장할 수 없는 변경을 붙잡지 않는다.
   */
  const enterReadOnly = useCallback((message: string | null) => {
    const firstLock = lockGateRef.current.lock(message);
    const shown = lockGateRef.current.message;
    setLockMessage(shown);
    setDirty(false);
    setError(null);
    if (firstLock && shown) {
      toast({
        title: "수정할 수 없는 포토북이에요",
        description: shown,
        variant: "warning",
      });
    }
  }, []);
  // 서버 재렌더(router.refresh)가 새로 잠금을 알려주면 반영한다.
  useEffect(() => {
    if (initialLockMessage !== null) enterReadOnly(initialLockMessage);
  }, [enterReadOnly, initialLockMessage]);

  // 직렬화 메타(레이아웃 모드/배경) — 저장 시 meta 로 전달해 배경 소실 방지 (EC-3).
  // 자동저장 타이머의 stale closure 를 피하려고 state 대신 ref 로 추적한다.
  const metaRef = useRef<{
    layoutMode: PageLayoutMode;
    backgroundColor: string;
    backgroundImage: BackgroundImage | null;
  }>({
    layoutMode: initialDoc?.layoutMode ?? "polaroid",
    backgroundColor: initialDoc?.backgroundColor ?? "#f8f5f0",
    backgroundImage: initialDoc?.backgroundImage ?? null,
  });

  const { shouldShow: shouldAutoShowShortcuts, mark: markShortcutsSeen } =
    useShortcutsAutoShow();

  // 첫 방문 시 단축키 안내 자동 노출 — 데스크탑(fine pointer)에서만 (EC-12,
  // 판정은 useShortcutsAutoShow 내부에서 처리)
  useEffect(() => {
    if (shouldAutoShowShortcuts) {
      const t = setTimeout(() => {
        setShortcutsOpen(true);
      }, 1200); // 캔버스 로드 후 잠시 뒤
      return () => clearTimeout(t);
    }
  }, [shouldAutoShowShortcuts]);

  /**
   * 캔버스에 문서를 올린다. 실패해도 던지지 않고 false — 저장을 멈추고 새로고침을 안내한다
   * (캔버스가 문서를 반영하지 못한 채 저장하면 저장된 객체가 빠진 페이지가 서버를 덮는다).
   *
   * 저장 차단의 1차 방어는 FabricStage 가 로드 실패를 동기로 래치하는 것이다(serializeForSave
   * "load_failed") — 여기 catch 는 대기 중이던 저장보다 늦게 돌 수 있다. 차단 해제는 문서가 실제로
   * 반영된 "applied" 때만: 더 새 로드에 밀린 "superseded" 가 그 새 로드의 실패를 지우면 안 된다.
   */
  const loadIntoStage = useCallback(
    async (doc: PageDoc, urls: Record<string, string>): Promise<boolean> => {
      const handle = stageRef.current;
      if (!handle) return false;
      let result: LoadDocResult;
      try {
        result = await handle.loadDoc(doc, urls);
      } catch (err) {
        console.warn("[PageEditor] 페이지 캔버스 로드 실패", err);
        if (saveBlockRef.current === null) saveBlockRef.current = "load_failed";
        setError(SAVE_BLOCK_MESSAGES.load_failed);
        toast({
          title: "페이지를 불러오지 못했어요",
          description: SAVE_BLOCK_MESSAGES.load_failed,
          variant: "destructive",
        });
        return false;
      }
      if (result === "skipped") return false;
      if (result === "applied" && saveBlockRef.current === "load_failed") {
        saveBlockRef.current = null;
        setError(null);
      }
      return true;
    },
    [],
  );

  /**
   * 서버 최신 페이지와 기준 버전을 맞춘다. 저장 큐 안에서만 호출할 것.
   *  - "stale": 진입 직후 확인. 라우터 캐시(staleTimes.dynamic)·뒤로가기로 저장 이전 문서가
   *    올라왔으면 최신본으로 교체한다(QA-2: 옛 문서가 자동저장으로 최신본을 덮던 문제).
   *  - "conflict": 저장이 409 로 거절됨 — 로컬 변경을 버리고 최신본을 올린다.
   * 버전이 같으면 아무것도 하지 않는다. 서버 문서를 해석할 수 없으면 저장을 멈춘다(무한 409 방지).
   */
  const syncWithServer = useCallback(
    async (reason: "stale" | "conflict"): Promise<void> => {
      const handle = stageRef.current;
      if (!handle) return;
      let data: PageLatestResponse | undefined;
      try {
        const res = await fetchJsonWithTimeout(
          `/api/pages/${pageId}`,
          { cache: "no-store" },
          SYNC_FETCH_TIMEOUT_MS,
        );
        const json = res.body as {
          ok?: boolean;
          data?: PageLatestResponse;
        } | null;
        data = res.ok && json?.ok ? json.data : undefined;
      } catch {
        data = undefined;
      }
      const decision = decideLatestDoc(
        data ? { version: data.version, doc: data.fabricJson } : undefined,
        baseVersionRef.current,
        isPageDoc,
      );
      if (decision.kind === "unavailable") {
        // 진입 확인 실패는 조용히 넘긴다 — 저장 시 서버가 409 로 다시 막아준다.
        if (reason === "conflict") {
          setError("최신 페이지를 불러오지 못했어요. 새로고침해주세요.");
        }
        return;
      }
      if (decision.kind === "up_to_date") return;
      if (decision.kind === "unreadable") {
        // 서버 문서를 해석할 수 없다(더 새 포맷·손상). 기준을 바꾸지 않으면 저장마다 409 → 이 분기가
        // 반복되고, 빈 페이지로 간주해 덮으면 모르는 내용을 지운다. 새로고침 전까지 저장을 멈춘다.
        saveBlockRef.current = "server_doc_unreadable";
        setError(SAVE_BLOCK_MESSAGES.server_doc_unreadable);
        toast({
          title: "저장을 멈췄어요",
          description: SAVE_BLOCK_MESSAGES.server_doc_unreadable,
          variant: "destructive",
        });
        return;
      }

      const discardedLocalEdits =
        reason === "conflict" || editSeqRef.current > 0;
      const latestPhotoUrls = data?.photoUrls ?? {};
      // 메타 커밋(동기) → 캔버스 로드 → 기준 버전 커밋(lib/editor/doc-sync.ts 순서 규약).
      const result = await reloadEditorDoc({
        doc: decision.doc,
        version: decision.version,
        commitMeta: (doc) => {
          photoUrlsRef.current = { ...photoUrlsRef.current, ...latestPhotoUrls };
          metaRef.current = {
            layoutMode: doc.layoutMode,
            backgroundColor: doc.backgroundColor,
            backgroundImage: doc.backgroundImage ?? null,
          };
          setCurrentDoc(doc);
        },
        loadCanvas: (doc) => loadIntoStage(doc, photoUrlsRef.current),
        commitVersion: (version) => {
          baseVersionRef.current = version;
        },
        readEditSeq: () => editSeqRef.current,
      });
      if (!result.loaded) return;
      editSeqRef.current += 1;
      // 로드를 기다리는 동안 추가한 객체는 캔버스에 보존됐다 — dirty 를 내리지 않는다(읽기 전용 제외).
      setDirty(!lockGateRef.current.locked && result.editedDuringLoad);
      if (saveBlockRef.current === null) setError(null);
      setDocReloadedAt(Date.now());
      if (discardedLocalEdits) {
        toast({
          title: "최신 페이지를 불러왔어요",
          description:
            "다른 곳에서 먼저 저장된 내용이 있어 방금 변경은 저장되지 않았어요.",
          variant: "warning",
        });
      }
    },
    [loadIntoStage, pageId],
  );

  // 페이지 doc 로드 — FabricStage 준비 완료 시 (lazy load 지원)
  const handleStageReady = useCallback(() => {
    void (async () => {
      // 로드하는 문서와 기준 버전·메타·사진 URL 을 **같은 props** 에서 맞춘다.
      // lazy 캔버스가 준비되기 전에 push→refresh 재렌더가 도착하면 initialDoc 은 새 값인데
      // baseVersionRef·metaRef(첫 렌더 값)는 옛 값이라, 최신본 확인이 불필요한 재로드를 하고
      // 확인이 실패하면 옛 기준으로 저장해 거짓 409 가 났다.
      // onReady 는 캔버스 생성 시 1회뿐이고 그 전에는 저장이 돌지 않으므로(핸들 없음) 덮어써도 안전하다.
      baseVersionRef.current = initialVersion;
      photoUrlsRef.current = { ...photoUrlsRef.current, ...initialPhotoUrls };
      try {
        if (initialDoc) {
          metaRef.current = {
            layoutMode: initialDoc.layoutMode,
            backgroundColor: initialDoc.backgroundColor,
            backgroundImage: initialDoc.backgroundImage ?? null,
          };
          setCurrentDoc(initialDoc);
          // 실패하면 loadIntoStage 가 저장을 멈추고 안내한다(던지지 않는다).
          await loadIntoStage(initialDoc, initialPhotoUrls);
        }
        // 진입 직후 서버 최신본 확인 — 저장 큐에 넣어 자동저장과 섞이지 않게 한다.
        await saveQueueRef.current.run(() => syncWithServer("stale"));
      } catch (err) {
        console.warn("[PageEditor] 진입 직후 페이지 확인 실패", err);
      }
    })();
  }, [initialDoc, initialPhotoUrls, initialVersion, loadIntoStage, syncWithServer]);

  const save = useCallback(
    (): Promise<SaveOutcome> =>
      saveQueueRef.current.run(async (): Promise<SaveOutcome> => {
        const handle = stageRef.current;
        if (!handle) return "skipped";
        // 결제 후 편집 잠금 — 서버 호출 없이 끝낸다(안내는 잠길 때 한 번 했다).
        if (lockGateRef.current.locked) return "locked";
        // 콜라주 적용·undo 복원이 진행 중이면 끝난 캔버스를 저장한다.
        if (!(await handle.whenIdle(STAGE_IDLE_TIMEOUT_MS))) {
          setError("페이지를 불러오는 중이라 저장하지 못했어요. 잠시 후 다시 시도해주세요.");
          return "failed";
        }
        const blockReason = saveBlockRef.current;
        if (blockReason !== null) {
          // 서버 호출 없이 멈춘다 — 로드 실패 캔버스·해석 불가 서버 문서를 덮지 않고 409 반복도 끊는다.
          setError(SAVE_BLOCK_MESSAGES[blockReason]);
          toast({
            title: "저장을 멈췄어요",
            description: SAVE_BLOCK_MESSAGES[blockReason],
            variant: "destructive",
          });
          return "blocked";
        }
        // 저장 시작 시점의 편집 시퀀스 캡처 — 완료 시 값이 그대로일 때만 dirty 해제.
        const seq = editSeqRef.current;
        const result = handle.serializeForSave({
          version: PAGEDOC_VERSION,
          bookSizeId: bookSize.id,
          pageNo,
          layoutMode: metaRef.current.layoutMode,
          widthMm: bookSize.width_mm,
          heightMm: bookSize.height_mm,
          bleedMm: 2,
          backgroundColor: metaRef.current.backgroundColor,
          backgroundImage: metaRef.current.backgroundImage ?? undefined,
        });
        if (!result.ok) {
          if (result.reason === "not_ready") return "skipped";
          // load_failed: 마지막 로드가 실패한 캔버스(FabricStage 래치) — 새로고침 전까지 멈춘다.
          // untagged_objects: 서버에 보내면 화면에 보이는 요소가 저장본에서 사라진다 — 덮어쓰기 금지.
          if (result.reason === "load_failed" && saveBlockRef.current === null) {
            saveBlockRef.current = "load_failed";
          }
          const blockedMessage =
            result.reason === "load_failed"
              ? SAVE_BLOCK_MESSAGES.load_failed
              : SAVE_BLOCKED_MESSAGE;
          setError(blockedMessage);
          toast({
            title: "저장을 멈췄어요",
            description: blockedMessage,
            variant: "destructive",
          });
          return "blocked";
        }
        const doc = result.doc;
        setSaving(true);
        setError(null);
        try {
          const res = await fetch(`/api/pages/${pageId}`, {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              fabricJson: doc,
              baseVersion: baseVersionRef.current,
            }),
          });
          const json: unknown = await res.json().catch(() => null);
          const outcome = interpretSaveResponse(res.status, json);
          if (outcome.kind === "locked") {
            // 결제가 끝난 포토북 — 서버 안내를 한 번 보여주고 읽기 전용으로 전환(재시도·실패 토스트 없음).
            enterReadOnly(outcome.message);
            return "locked";
          }
          if (outcome.kind === "conflict") {
            // 조용히 덮어쓰지 않는다 — 최신본을 불러오고 알린다.
            await syncWithServer("conflict");
            return "conflict";
          }
          if (outcome.kind === "failed") {
            throw new Error(outcome.message ?? "저장에 실패했어요.");
          }
          if (outcome.version) baseVersionRef.current = outcome.version;
          setSavedAt(Date.now());
          // 저장 요청 중 새 편집이 없을 때만 해제 — 있으면 dirty 유지해 다음 자동저장이 돈다.
          if (editSeqRef.current === seq) {
            setDirty(false);
          }
          setCurrentDoc(doc);
          return "saved";
        } catch (e) {
          setError(e instanceof Error ? e.message : "저장에 실패했어요.");
          return "failed";
        } finally {
          setSaving(false);
        }
      }),
    [bookSize, enterReadOnly, pageId, pageNo, syncWithServer],
  );

  // 자동 저장 debounce.
  // savedAt 의존 포함: 저장 중 편집(dirty 유지)된 경우 저장 완료 후 타이머를 재무장한다.
  // docReloadedAt 의존 포함: 최신본 재로드 중 편집으로 dirty 가 true 로 유지된 경우 재무장한다.
  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!dirty || !autosave || readOnly) return;
    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    autosaveTimerRef.current = setTimeout(() => {
      void save();
    }, AUTOSAVE_DEBOUNCE_MS);
    return () => {
      if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty, autosave, readOnly, savedAt, docReloadedAt]);

  // beforeunload guard — 하드 내비게이션(새로고침/탭 닫기) 전용.
  useEffect(() => {
    function onBeforeUnload(e: BeforeUnloadEvent) {
      if (!dirty) return;
      e.preventDefault();
      e.returnValue = "저장되지 않은 변경 사항이 있어요.";
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  /**
   * 소프트 내비게이션 가드 (EC-1).
   * App Router 소프트 내비에서는 beforeunload 가 발화하지 않으므로,
   * dirty 면 저장 후 이동하고 저장하지 못했을 때(차단·실패)만 확인을 받는다.
   */
  const navigateTo = useCallback(
    async (href: string) => {
      if (dirty && !lockGateRef.current.locked) {
        const outcome = await save();
        const decision = decideNavigationAfterSave(outcome);
        // stay: 최신본 재로드·읽기 전용 전환 안내가 방금 떴다 — 확인한 뒤 다시 누르면 이동한다.
        if (decision === "stay") return;
        if (
          decision === "confirm_discard" &&
          !window.confirm(LEAVE_WITHOUT_SAVING_CONFIRM)
        ) {
          return;
        }
      }
      // 저장 뒤 목적지가 최신 서버 렌더를 보여주게 하는 순서: push → refresh.
      // (근거: Next 14.2.35 shared/lib/router/action-queue.js dispatchAction. Next 16 은
      //  prefetch/캐시 체계를 개편했으므로 순서 의미는 E2E 로 재확인한다 — 순서 자체는 유지)
      //  - 예전 순서(refresh → push)는 대기 중인 REFRESH 가 뒤이은 NAVIGATE 에 의해
      //    discarded 되어 결과가 버려졌다 → staleTimes.dynamic=30 캐시가 그대로 재생(QA-2).
      //  - push 를 먼저 하면 REFRESH 는 NAVIGATE 뒤에 큐잉되어 이동 완료 후 실행되고,
      //    목적지 트리를 다시 받아오며 prefetchCache 를 비운다.
      //  - 에디터 목적지는 props 를 첫 로드에만 쓰므로 진입 시 syncWithServer 가 함께 막는다.
      router.push(href);
      router.refresh();
    },
    [dirty, save, router],
  );

  /** 미리보기 열기 — 저장 성공 시에만 오픈 (EC-17). */
  const openPreview = useCallback(() => {
    if (!dirty || lockGateRef.current.locked) {
      setPreviewOpen(true);
      return;
    }
    void save().then((outcome) => {
      if (outcome === "saved") {
        setPreviewOpen(true);
      } else if (
        outcome === "conflict" ||
        outcome === "blocked" ||
        outcome === "locked"
      ) {
        // 최신본 재로드·저장 중단·읽기 전용 전환 안내가 이미 떴다.
        return;
      } else {
        toast({
          title: "저장 실패",
          description: "미리보기를 열지 않았어요. 잠시 후 다시 시도해주세요.",
          variant: "destructive",
        });
      }
    });
  }, [dirty, save]);

  /**
   * 도구 선택 라우팅.
   *  - "사진": 사진 추가 플로우(PhotoPickerDialog) — 클립아트 팔레트 아님 (EC-9).
   *  - "텍스트": 선택된 텍스트가 없으면 새 텍스트를 먼저 추가한 뒤 속성 패널 (EC-10).
   */
  const handleToolPick = useCallback(
    (tool: ToolbarTool) => {
      if (tool === "image") {
        setPhotoPicker("add");
        return;
      }
      if (tool === "text") {
        const handle = stageRef.current;
        const sel = handle?.getSelection();
        if (handle && (!sel || sel.oType !== "text")) {
          handle.addText({});
          markDirty();
        }
        setToolSheet("text");
        return;
      }
      setToolSheet(tool);
    },
    [markDirty],
  );

  // M17-9: 모바일 탭 핸들러 — 같은 탭 재클릭 시 토글(닫기)
  const handleMobileTabPress = useCallback((tab: MobileTab) => {
    setMobileTab((prev) => (prev === tab ? null : tab));
  }, []);

  // ====================== 단축키 핸들러 ======================
  const copySelection = useCallback(async () => {
    const handle = stageRef.current;
    if (!handle) return;
    const sel = handle.getSelection();
    if (!sel || !sel.oType) {
      toast({
        description: "복사할 객체를 선택해주세요.",
        variant: "warning",
      });
      return;
    }
    const clipboard = await getClipboard();
    const snap = clipboard.copy(
      sel,
      handle.getDpi(),
      handle.getBleedMm(),
      pageId,
    );
    if (snap) {
      toast({ description: "복사됨", variant: "success" });
    }
  }, [pageId]);

  const pasteFromClipboard = useCallback(async () => {
    // 읽기 전용 — 단축키로도 문서를 바꾸지 않는다(안내 토스트도 띄우지 않는다).
    if (lockGateRef.current.locked) return;
    const handle = stageRef.current;
    if (!handle) return;
    const clipboard = await getClipboard();
    if (!clipboard.hasContent) {
      toast({
        description: "클립보드가 비어있어요.",
        variant: "warning",
      });
      return;
    }
    const obj = clipboard.read();
    if (!obj) return;
    await handle.pasteLayoutObject(obj, photoUrlsRef.current);
    markDirty();
    toast({ description: "붙여넣기 완료", variant: "success" });
  }, [markDirty]);

  const duplicateSelection = useCallback(async () => {
    if (lockGateRef.current.locked) return;
    const handle = stageRef.current;
    if (!handle) return;
    const sel = handle.getSelection();
    if (!sel || !sel.oType) {
      toast({
        description: "복제할 객체를 선택해주세요.",
        variant: "warning",
      });
      return;
    }
    await handle.duplicateSelected();
    markDirty();
    toast({ description: "복제 완료", variant: "success" });
  }, [markDirty]);

  // 입력 중인 폼/텍스트박스에서는 단축키 무시.
  const isTypingTarget = useCallback((target: EventTarget | null): boolean => {
    if (!(target instanceof HTMLElement)) return false;
    const tag = target.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
    if (target.isContentEditable) return true;
    return false;
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // 다이얼로그/시트가 열려있으면 페이지 단축키 전부 패스 (EC-13).
      // Esc 등 닫기 동작은 Radix 가 처리한다.
      if (
        shortcutsOpen ||
        collageOpen ||
        previewOpen ||
        photoPicker !== null ||
        toolSheet !== null ||
        mobileTab !== null
      ) {
        return;
      }
      if (isTypingTarget(e.target)) return;

      const meta = e.metaKey || e.ctrlKey;

      // 안내 다이얼로그 — `?`
      if (!meta && e.key === "?" && !e.repeat) {
        e.preventDefault();
        setShortcutsOpen(true);
        return;
      }

      // Esc — 선택 해제 (단축키 안내 표기와 일치, EC-18)
      if (!meta && e.key === "Escape") {
        const sel = stageRef.current?.getSelection();
        if (sel?.canvas) {
          sel.canvas.discardActiveObject();
          sel.canvas.requestRenderAll();
        }
        return;
      }

      // 페이지 점프 — J / K, PageDown / PageUp (dirty 면 저장 후 이동)
      if (!meta && !e.altKey) {
        if (e.key === "j" || e.key === "J" || e.key === "PageDown") {
          if (nextPageId) {
            e.preventDefault();
            void navigateTo(`/editor/${projectId}/pages/${nextPageId}`);
          }
          return;
        }
        if (e.key === "k" || e.key === "K" || e.key === "PageUp") {
          if (prevPageId) {
            e.preventDefault();
            void navigateTo(`/editor/${projectId}/pages/${prevPageId}`);
          }
          return;
        }
      }

      // 복사/붙여넣기/복제 + 미리보기 (Cmd/Ctrl+Shift+P)
      if (meta) {
        const k = e.key.toLowerCase();
        if (e.shiftKey && k === "p") {
          e.preventDefault();
          openPreview();
          return;
        }
        if (k === "c") {
          e.preventDefault();
          void copySelection();
          return;
        }
        if (k === "v") {
          e.preventDefault();
          void pasteFromClipboard();
          return;
        }
        if (k === "d") {
          e.preventDefault();
          void duplicateSelection();
          return;
        }
      }
    }

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    shortcutsOpen,
    collageOpen,
    previewOpen,
    photoPicker,
    toolSheet,
    mobileTab,
    isTypingTarget,
    copySelection,
    pasteFromClipboard,
    duplicateSelection,
    nextPageId,
    prevPageId,
    projectId,
    navigateTo,
    openPreview,
  ]);

  // EC-13: 다이얼로그/시트가 열린 동안 gestures.ts 의 window keydown(삭제/이동/undo)이
  // 뒤편 캔버스를 조작하지 못하게 캡처 단계에서 전파를 차단한다.
  // Esc/Tab 은 Radix 닫기·포커스 트랩에 필요하므로 차단하지 않는다.
  useEffect(() => {
    const overlayOpen =
      shortcutsOpen ||
      collageOpen ||
      previewOpen ||
      photoPicker !== null ||
      toolSheet !== null ||
      mobileTab !== null;
    if (!overlayOpen) return;
    function blockCanvasShortcuts(e: KeyboardEvent) {
      const meta = e.metaKey || e.ctrlKey;
      const k = e.key;
      const isCanvasKey =
        k === "Delete" ||
        k === "Backspace" ||
        k === "ArrowLeft" ||
        k === "ArrowRight" ||
        k === "ArrowUp" ||
        k === "ArrowDown" ||
        (meta && (k.toLowerCase() === "z" || k.toLowerCase() === "y"));
      if (isCanvasKey) e.stopPropagation();
    }
    window.addEventListener("keydown", blockCanvasShortcuts, true);
    return () =>
      window.removeEventListener("keydown", blockCanvasShortcuts, true);
  }, [shortcutsOpen, collageOpen, previewOpen, photoPicker, toolSheet, mobileTab]);

  // ====================== 공통 팔레트 핸들러 ======================
  const handlePickFont = useCallback(
    (family: string, _url: string) => {
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
      }
    },
    [markDirty],
  );

  const handlePickClipart = useCallback((url: string, resourceId: string) => {
    void stageRef.current?.addClipart(url, resourceId);
  }, []);

  // 배경 선택 — 캔버스 적용 + metaRef 갱신(저장 시 backgroundImage 로 직렬화, EC-3).
  const handlePickBackground = useCallback(
    (url: string, _resourceId: string) => {
      stageRef.current?.setBackground({ type: "resource", url });
      metaRef.current.backgroundImage = { url, cropMode: "cover", opacity: 1 };
      markDirty();
    },
    [markDirty],
  );

  return (
    /*
     * CSS 변수 --toolbar-h: MobileToolbar 전체 높이.
     * 퀵 바(48px) + 탭 바(56px) + 상단 보더(1px) + iOS safe-area (EC-11).
     * 모바일 캔버스 높이 계산: calc(100dvh - 헤더높이 - --toolbar-h)
     */
    <div
      className="flex min-h-[calc(100dvh-4rem)] flex-col"
      style={
        {
          "--toolbar-h": "calc(105px + env(safe-area-inset-bottom))",
        } as React.CSSProperties
      }
    >
      {/* 상단 — 페이지 번호 + 네비 + 저장 */}
      <header className="sticky top-0 z-30 flex flex-wrap items-center gap-2 border-b bg-background/95 px-3 py-2 backdrop-blur md:px-6">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void navigateTo(`/editor/${projectId}`)}
        >
          ← 페이지 목록
        </Button>
        <span className="text-sm text-muted-foreground" aria-live="polite">
          {projectTitle} ·
        </span>

        {/* 페이지 번호 드롭다운 — 다른 페이지로 점프 */}
        {siblings.length > 1 ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" aria-label="페이지로 이동">
                페이지 {pageNo} / {siblings.length}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="start"
              className="max-h-[60vh] overflow-y-auto"
            >
              <DropdownMenuLabel>페이지 점프</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {siblings.map((s) => (
                <DropdownMenuItem
                  key={s.id}
                  disabled={s.id === pageId}
                  onSelect={() => {
                    if (s.id !== pageId) {
                      void navigateTo(`/editor/${projectId}/pages/${s.id}`);
                    }
                  }}
                  className={cn(
                    s.id === pageId && "font-semibold text-primary",
                  )}
                >
                  페이지 {s.pageNo}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <span className="text-sm text-muted-foreground">
            페이지 {pageNo}
          </span>
        )}

        <div className="ml-auto flex items-center gap-2">
          {prevPageId ? (
            <Button
              variant="ghost"
              size="icon"
              aria-label="이전 페이지 (K)"
              onClick={() =>
                void navigateTo(`/editor/${projectId}/pages/${prevPageId}`)
              }
            >
              <ChevronLeft className="size-5" />
            </Button>
          ) : (
            <Button variant="ghost" size="icon" disabled aria-label="이전 페이지">
              <ChevronLeft className="size-5 opacity-30" />
            </Button>
          )}
          {nextPageId ? (
            <Button
              variant="ghost"
              size="icon"
              aria-label="다음 페이지 (J)"
              onClick={() =>
                void navigateTo(`/editor/${projectId}/pages/${nextPageId}`)
              }
            >
              <ChevronRight className="size-5" />
            </Button>
          ) : (
            <Button variant="ghost" size="icon" disabled aria-label="다음 페이지">
              <ChevronRight className="size-5 opacity-30" />
            </Button>
          )}

          <Button
            variant="ghost"
            size="sm"
            aria-label="페이지 미리보기 (Cmd/Ctrl+Shift+P)"
            onClick={openPreview}
            className="gap-1.5"
          >
            <Eye className="size-4" aria-hidden />
            <span className="hidden sm:inline">미리보기</span>
          </Button>

          <Button
            variant="ghost"
            size="icon"
            aria-label="키보드 단축키 (?)"
            onClick={() => setShortcutsOpen(true)}
            className="hidden md:inline-flex"
          >
            <Keyboard className="size-5" />
          </Button>

          {readOnly ? null : (
            <label className="hidden items-center gap-2 text-xs text-muted-foreground md:flex">
              <input
                type="checkbox"
                checked={autosave}
                onChange={(e) => setAutosave(e.target.checked)}
              />
              자동 저장
            </label>
          )}
          <Button
            onClick={() => void save()}
            disabled={saving || readOnly}
            size="sm"
            variant="gradient"
          >
            <Save className="size-4" aria-hidden />
            {readOnly
              ? "읽기 전용"
              : saving
                ? "저장 중…"
                : dirty
                  ? "저장"
                  : "저장됨"}
          </Button>
        </div>
        {savedAt ? (
          <span
            className="basis-full text-xs text-muted-foreground md:basis-auto"
            aria-live="polite"
          >
            마지막 저장 {new Date(savedAt).toLocaleTimeString()}
          </span>
        ) : null}
        {error ? (
          <span
            className="basis-full text-xs text-destructive md:basis-auto"
            role="alert"
          >
            {error}
          </span>
        ) : null}
      </header>

      {/*
       * 본문 영역.
       * 모바일: 단일 컬럼. 캔버스가 남은 화면 전체를 차지.
       *   padding-bottom: var(--toolbar-h) → MobileToolbar(퀵 바 포함) 아래 가림 방지.
       * 데스크탑: 3단 flex-row.
       */}
      <div className="flex flex-1 flex-col gap-3 p-3 pb-[var(--toolbar-h)] md:flex-row md:gap-4 md:p-6 md:pb-6">
        {/* 좌측 (데스크탑만) — Toolbar + Palette. 읽기 전용이면 편집 도구를 두지 않는다. */}
        {readOnly ? null : (
        <aside
          aria-label="도구 / 리소스"
          className="hidden md:flex md:w-72 md:shrink-0 md:flex-col md:gap-3"
        >
          <Toolbar
            onPick={handleToolPick}
            onUndo={() => stageRef.current?.undo()}
            onRedo={() => stageRef.current?.redo()}
            onDelete={() => stageRef.current?.remove()}
            canUndo={canUndo}
            canRedo={canRedo}
            hasSelection={Boolean(selection)}
            mobile={false}
          />
          <div className="min-h-0 flex-1 rounded-lg border bg-white/40 p-2">
            <ResourcePalette
              initialTab={
                toolSheet === "background"
                  ? "background"
                  : toolSheet === "clipart"
                    ? "clipart"
                    : "font"
              }
              onPickFont={handlePickFont}
              onPickClipart={handlePickClipart}
              onPickBackground={handlePickBackground}
            />
          </div>
        </aside>
        )}

        {/* 중앙 — Stage */}
        <main
          className={cn(
            "flex min-h-0 flex-1 flex-col items-center justify-start gap-3",
            // 모바일: 터치 전용, 사이드바 없음
            "touch-action-none",
          )}
        >
          <ReadOnlyNotice message={lockMessage} />
          <FabricStage
            ref={stageRef}
            widthMm={bookSize.width_mm}
            heightMm={bookSize.height_mm}
            bleedMm={2}
            dpi={PREVIEW_DPI}
            pageId={pageId}
            onSelectionChange={setSelection}
            onModified={markDirty}
            onHistoryChange={(u, r) => {
              setCanUndo(u);
              setCanRedo(r);
            }}
            onReady={handleStageReady}
            readOnly={readOnly}
          />
          {readOnly ? null : (
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCollageOpen(true)}
              >
                콜라주 템플릿 변경
              </Button>
            </div>
          )}
        </main>

        {/* 우측 (데스크탑만) — SelectionPanel */}
        {readOnly ? null : (
          <aside
            aria-label="속성"
            className="hidden md:block md:w-72 md:shrink-0"
          >
            <SelectionPanel
              selection={selection}
              dpi={PREVIEW_DPI}
              onChange={markDirty}
              onReplacePhoto={() => setPhotoPicker("replace")}
            />
          </aside>
        )}
      </div>

      {/* ====================== 모바일 전용 영역 ====================== */}

      {/* 하단 퀵 바(Undo/Redo 상시 + 선택 객체 도구) + 탭 바 (모바일). 읽기 전용이면 두지 않는다. */}
      {readOnly ? null : (
        <MobileToolbar
          activeTab={mobileTab}
          onTabPress={handleMobileTabPress}
          canUndo={canUndo}
          canRedo={canRedo}
          onUndo={() => stageRef.current?.undo()}
          onRedo={() => stageRef.current?.redo()}
          hasSelection={Boolean(selection)}
          onDuplicate={() => void duplicateSelection()}
          onBringForward={() => stageRef.current?.bringForward()}
          onSendBackward={() => stageRef.current?.sendBackward()}
          onDelete={() => stageRef.current?.remove()}
          onMore={() => setMobileTab("layers")}
          className="md:hidden"
        />
      )}

      {/* 도구 탭 시트 — 기존 Toolbar 콘텐츠 (2열 그리드) */}
      <MobileBottomSheet
        open={mobileTab === "tools"}
        onOpenChange={(o) => !o && setMobileTab(null)}
        title="도구"
        className="md:hidden"
      >
        <div className="space-y-4 pb-2">
          <Toolbar
            mobile
            onPick={(tool) => {
              setMobileTab(null);
              // 리소스 팔레트가 필요한 도구는 handleToolPick 으로 위임.
              handleToolPick(tool);
            }}
            onUndo={() => {
              stageRef.current?.undo();
              // 결과가 보이도록 시트를 닫는다 (EC-14).
              setMobileTab(null);
            }}
            onRedo={() => {
              stageRef.current?.redo();
              setMobileTab(null);
            }}
            onDelete={() => {
              stageRef.current?.remove();
              setMobileTab(null);
            }}
            canUndo={canUndo}
            canRedo={canRedo}
            hasSelection={Boolean(selection)}
          />
        </div>
      </MobileBottomSheet>

      {/* 레이어 탭 시트 — SelectionPanel (속성 편집) */}
      <MobileBottomSheet
        open={mobileTab === "layers"}
        onOpenChange={(o) => !o && setMobileTab(null)}
        title="레이어 / 속성"
        className="md:hidden"
      >
        <div className="pb-2">
          {/* 레이어 순서 제어 */}
          {selection ? (
            <div className="mb-4 flex gap-2">
              <Button
                variant="outline"
                size="sm"
                className="flex-1"
                onClick={() => stageRef.current?.bringForward()}
              >
                앞으로
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="flex-1"
                onClick={() => stageRef.current?.sendBackward()}
              >
                뒤로
              </Button>
            </div>
          ) : null}
          {/* 선택 객체 속성 편집 */}
          <SelectionPanel
            selection={selection}
            dpi={PREVIEW_DPI}
            onChange={markDirty}
            onReplacePhoto={() => {
              setPhotoPicker("replace");
              setMobileTab(null);
            }}
          />
        </div>
      </MobileBottomSheet>

      {/* 추가 탭 시트 — 사진/텍스트/클립아트/배경 */}
      <MobileBottomSheet
        open={mobileTab === "add"}
        onOpenChange={(o) => !o && setMobileTab(null)}
        title="추가"
        className="md:hidden"
      >
        <div className="space-y-3 pb-2">
          <div className="grid grid-cols-2 gap-3">
            {/* 사진 추가 */}
            <button
              type="button"
              className={cn(
                "flex min-h-[64px] flex-col items-center justify-center gap-1.5",
                "rounded-xl border border-border bg-background p-3",
                "text-sm font-medium transition-colors",
                "hover:border-coral-300 hover:bg-coral-50/40",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                "active:scale-[0.97]",
              )}
              onClick={() => {
                setMobileTab(null);
                setPhotoPicker("add");
              }}
              aria-label="사진 추가"
            >
              <span className="text-xl" aria-hidden>🖼</span>
              <span>사진 추가</span>
            </button>

            {/* 텍스트 추가 */}
            <button
              type="button"
              className={cn(
                "flex min-h-[64px] flex-col items-center justify-center gap-1.5",
                "rounded-xl border border-border bg-background p-3",
                "text-sm font-medium transition-colors",
                "hover:border-sky-300 hover:bg-sky-50/40",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                "active:scale-[0.97]",
              )}
              onClick={() => {
                stageRef.current?.addText({});
                markDirty();
                setMobileTab(null);
              }}
              aria-label="텍스트 추가"
            >
              <span className="text-xl" aria-hidden>T</span>
              <span>텍스트</span>
            </button>

            {/* 클립아트 추가 */}
            <button
              type="button"
              className={cn(
                "flex min-h-[64px] flex-col items-center justify-center gap-1.5",
                "rounded-xl border border-border bg-background p-3",
                "text-sm font-medium transition-colors",
                "hover:border-violet-300 hover:bg-violet-50/40",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                "active:scale-[0.97]",
              )}
              onClick={() => {
                setMobileTab(null);
                setToolSheet("clipart");
              }}
              aria-label="클립아트 추가"
            >
              <span className="text-xl" aria-hidden>✨</span>
              <span>클립아트</span>
            </button>

            {/* 배경 변경 */}
            <button
              type="button"
              className={cn(
                "flex min-h-[64px] flex-col items-center justify-center gap-1.5",
                "rounded-xl border border-border bg-background p-3",
                "text-sm font-medium transition-colors",
                "hover:border-coral-300 hover:bg-coral-50/40",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                "active:scale-[0.97]",
              )}
              onClick={() => {
                setMobileTab(null);
                setToolSheet("background");
              }}
              aria-label="배경 변경"
            >
              <span className="text-xl" aria-hidden>🎨</span>
              <span>배경 변경</span>
            </button>
          </div>
        </div>
      </MobileBottomSheet>

      {/* 기존 도구 선택 → 리소스 팔레트 시트 (모바일 + 데스크탑 공통 path) */}
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
          <SelectionPanel
            selection={selection}
            dpi={PREVIEW_DPI}
            onChange={markDirty}
            onReplacePhoto={() => setPhotoPicker("replace")}
          />
        ) : toolSheet === "clipart" || toolSheet === "background" ? (
          <ResourcePalette
            initialTab={toolSheet}
            tabs={["clipart", "background"]}
            onPickFont={handlePickFont}
            onPickClipart={(url, resourceId) => {
              void stageRef.current?.addClipart(url, resourceId);
              setToolSheet(null);
            }}
            onPickBackground={(url, resourceId) => {
              handlePickBackground(url, resourceId);
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

      {/* 콜라주 템플릿 변경 다이얼로그 */}
      {currentDoc ? (
        <CollageTemplateDialog
          open={collageOpen}
          onOpenChange={setCollageOpen}
          doc={currentDoc}
          onApply={(next) => {
            setCurrentDoc(next);
            metaRef.current = {
              layoutMode: next.layoutMode,
              backgroundColor: next.backgroundColor,
              backgroundImage: next.backgroundImage ?? null,
            };
            void loadIntoStage(next, photoUrlsRef.current);
            // 로드는 dirty 를 만들지 않는다 — 템플릿 적용은 저장 대상이므로 명시적으로 표시.
            markDirty();
          }}
        />
      ) : null}

      {/* 키보드 단축키 안내 */}
      <KeyboardShortcutsHelp
        open={shortcutsOpen}
        onOpenChange={(open) => {
          setShortcutsOpen(open);
          if (!open) markShortcutsSeen();
        }}
      />

      {/* 단일 페이지 미리보기 */}
      <PagePreviewDialog
        pageId={pageId}
        pageNo={pageNo}
        open={previewOpen}
        onOpenChange={setPreviewOpen}
      />

      {/* 사진 추가 / 교체 — 진입 경로별 플로우 분리 (EC-2) */}
      <PhotoPickerDialog
        open={photoPicker !== null}
        onOpenChange={(o) => !o && setPhotoPicker(null)}
        currentProjectId={projectId}
        title={photoPicker === "replace" ? "사진 교체" : "사진 추가"}
        description={
          photoPicker === "replace"
            ? "현재 선택된 사진을 다른 사진으로 교체합니다."
            : "페이지에 추가할 사진을 선택하세요."
        }
        onNavigateToUpload={() =>
          navigateTo(`/upload?projectId=${projectId}`)
        }
        onPick={async (photoId, url) => {
          const handle = stageRef.current;
          if (!handle) return;
          if (photoPicker === "replace") {
            const sel = handle.getSelection();
            if (!sel || sel.oType !== "photo") {
              toast({
                description: "교체할 사진을 먼저 선택해주세요.",
                variant: "warning",
              });
              return;
            }
            await handle.replacePhoto(photoId, url);
            markDirty();
            toast({ description: "사진 교체 완료", variant: "success" });
          } else {
            await handle.addPhoto(photoId, url);
            markDirty();
            toast({ description: "사진을 추가했어요.", variant: "success" });
          }
        }}
      />
    </div>
  );
}

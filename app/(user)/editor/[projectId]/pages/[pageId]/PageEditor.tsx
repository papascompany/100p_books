"use client";

import { ChevronLeft, ChevronRight, Eye, Keyboard, Save } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import dynamic from "next/dynamic";

import CollageTemplateDialog from "@/components/editor/CollageTemplateDialog";
import type { FabricStageHandle } from "@/components/editor/FabricStage";
const FabricStage = dynamic(() => import("@/components/editor/FabricStage"), {
  ssr: false,
  loading: () => (
    <div className="flex flex-1 items-center justify-center bg-soft-cloud">
      <div className="size-10 animate-spin rounded-full border-4 border-hairline border-t-ink" />
    </div>
  ),
});
const PREVIEW_DPI = 72;
import KeyboardShortcutsHelp, {
  useShortcutsAutoShow,
} from "@/components/editor/KeyboardShortcutsHelp";
import MobileToolbar, { type MobileTab } from "@/components/editor/MobileToolbar";
import PagePreviewDialog from "@/components/editor/PagePreviewDialog";
import PhotoPickerDialog from "@/components/editor/PhotoPickerDialog";
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
// fabricClipboard: 실제 사용 시점에 동적으로 import (fabric.js 번들 분리)
const getClipboard = () => import("@/lib/fabric/clipboard").then((m) => m.fabricClipboard);
import type { TaggedFabricObject } from "@/lib/fabric/serialize";
import { PAGEDOC_VERSION, type PageDoc } from "@/lib/layout/types";
import { cn } from "@/lib/utils";

export interface PageEditorProps {
  projectId: string;
  projectTitle: string;
  pageId: string;
  pageNo: number;
  initialDoc: PageDoc | null;
  initialPhotoUrls: Record<string, string>;
  bookSize: BookSize;
  prevPageId: string | null;
  nextPageId: string | null;
  /** 프로젝트의 모든 페이지 — 페이지 번호 점프용. */
  siblings?: { id: string; pageNo: number }[];
}

const AUTOSAVE_DEBOUNCE_MS = 5000;

/**
 * 페이지 단일 편집 클라이언트.
 *
 * 레이아웃:
 *   - 데스크탑: 좌측 ResourcePalette / 중앙 FabricStage / 우측 SelectionPanel
 *   - 모바일:   상단 미니 헤더 / 가운데 FabricStage (풀 높이) / 하단 MobileToolbar
 *
 * 모바일 탭:
 *   - 도구(Tools): 기존 Toolbar 콘텐츠 (텍스트/사진/클립아트/배경/레이어 + Undo/Redo/Delete)
 *   - 레이어(Layers): 선택 객체 속성 편집 (SelectionPanel)
 *   - 추가(Add): 사진 추가, 텍스트 추가, 클립아트, 배경 변경
 *
 * 저장:
 *   - 수동: "저장" 버튼.
 *   - 자동: 토글(기본 ON). 변경 후 5초 debounce.
 *   - leave guard: 미저장 변경이 있을 때 beforeunload.
 *
 * M12 추가:
 *   - 단축키 (복사/붙여넣기/복제, 페이지 점프, 단축키 안내)
 *   - 페이지 번호 드롭다운 점프
 *
 * M17-9 추가:
 *   - MobileToolbar (fixed bottom-0, iOS safe-area)
 *   - SelectionPanel 객체 선택 시 모바일 자동 Bottom Sheet 오픈
 *   - 캔버스 높이 --toolbar-h CSS 변수 기반 동적 계산
 */
export default function PageEditor({
  projectId,
  projectTitle,
  pageId,
  pageNo,
  initialDoc,
  initialPhotoUrls,
  bookSize,
  prevPageId,
  nextPageId,
  siblings = [],
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
  const [error, setError] = useState<string | null>(null);
  const [toolSheet, setToolSheet] = useState<ToolbarTool | null>(null);
  const [collageOpen, setCollageOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [photoPickerOpen, setPhotoPickerOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [currentDoc, setCurrentDoc] = useState<PageDoc | null>(initialDoc);

  // M17-9: 모바일 탭 바 상태
  // null = 모든 시트 닫힘, 값 = 해당 시트 오픈
  const [mobileTab, setMobileTab] = useState<MobileTab | null>(null);

  // M17-9: 객체가 선택될 때 모바일에서 자동으로 레이어 시트 오픈.
  // 시트가 이미 열려있는 경우에도 갱신 (재렌더만 발생하므로 닫지 않음).
  const prevSelectionRef = useRef<TaggedFabricObject | null>(null);
  useEffect(() => {
    const hasSel = selection !== null;
    const hadSel = prevSelectionRef.current !== null;
    prevSelectionRef.current = selection;

    // 새로운 객체 선택(없음→있음, 또는 다른 객체로 변경)일 때 시트 오픈.
    // 이미 레이어 시트가 열려있다면 그대로 유지.
    // 데스크탑(md+)에서는 동작 안 함 — JS로 판단하되 Tailwind 브레이크포인트와 동기화.
    if (hasSel && typeof window !== "undefined" && window.innerWidth < 768) {
      if (!hadSel || selection !== prevSelectionRef.current) {
        setMobileTab("layers");
      }
    }
  }, [selection]);

  const { shouldShow: shouldAutoShowShortcuts, mark: markShortcutsSeen } =
    useShortcutsAutoShow();

  // 첫 방문 시 단축키 안내 자동 노출
  useEffect(() => {
    if (shouldAutoShowShortcuts) {
      const t = setTimeout(() => {
        setShortcutsOpen(true);
      }, 1200); // 캔버스 로드 후 잠시 뒤
      return () => clearTimeout(t);
    }
  }, [shouldAutoShowShortcuts]);

  // 페이지 doc 로드 — FabricStage 준비 완료 시 (lazy load 지원)
  const handleStageReady = useCallback(() => {
    if (!initialDoc) return;
    void stageRef.current?.loadDoc(initialDoc, initialPhotoUrls);
  }, [initialDoc, initialPhotoUrls]);

  // 자동 저장 debounce
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty, autosave]);

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

  const save = useCallback(async () => {
    const handle = stageRef.current;
    if (!handle) return;
    const doc = handle.serialize({
      version: PAGEDOC_VERSION,
      bookSizeId: bookSize.id,
      pageNo,
      layoutMode: currentDoc?.layoutMode ?? initialDoc?.layoutMode ?? "polaroid",
      widthMm: bookSize.width_mm,
      heightMm: bookSize.height_mm,
      bleedMm: 2,
      backgroundColor:
        currentDoc?.backgroundColor ?? initialDoc?.backgroundColor ?? "#f8f5f0",
    });
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/pages/${pageId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fabricJson: doc }),
      });
      const json = (await res.json()) as {
        ok: boolean;
        error?: { message: string };
      };
      if (!res.ok || !json.ok) {
        throw new Error(json.error?.message ?? "저장에 실패했어요.");
      }
      setSavedAt(Date.now());
      setDirty(false);
      setCurrentDoc(doc);
    } catch (e) {
      setError(e instanceof Error ? e.message : "저장에 실패했어요.");
    } finally {
      setSaving(false);
    }
  }, [bookSize, pageId, pageNo, initialDoc, currentDoc]);

  const onToolPick = useCallback((tool: ToolbarTool) => {
    setToolSheet(tool);
  }, []);

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
    await handle.pasteLayoutObject(obj, initialPhotoUrls);
    setDirty(true);
    toast({ description: "붙여넣기 완료", variant: "success" });
  }, [initialPhotoUrls]);

  const duplicateSelection = useCallback(async () => {
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
    setDirty(true);
    toast({ description: "복제 완료", variant: "success" });
  }, []);

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
      // 모달 열려있으면 ESC 외 전부 패스
      if (shortcutsOpen || collageOpen) return;
      if (isTypingTarget(e.target)) return;

      const meta = e.metaKey || e.ctrlKey;

      // 안내 다이얼로그 — `?`
      if (!meta && e.key === "?" && !e.repeat) {
        e.preventDefault();
        setShortcutsOpen(true);
        return;
      }

      // 페이지 점프 — J / K, PageDown / PageUp
      if (!meta && !e.altKey) {
        if (e.key === "j" || e.key === "J" || e.key === "PageDown") {
          if (nextPageId) {
            e.preventDefault();
            router.push(`/editor/${projectId}/pages/${nextPageId}`);
          }
          return;
        }
        if (e.key === "k" || e.key === "K" || e.key === "PageUp") {
          if (prevPageId) {
            e.preventDefault();
            router.push(`/editor/${projectId}/pages/${prevPageId}`);
          }
          return;
        }
      }

      // 복사/붙여넣기/복제 + 미리보기 (Cmd/Ctrl+Shift+P)
      if (meta) {
        const k = e.key.toLowerCase();
        if (e.shiftKey && k === "p") {
          e.preventDefault();
          // 자동 저장 직후 호출되어야 신선한 결과 — 일단 즉시 저장 후 열기.
          if (dirty) {
            void save().then(() => setPreviewOpen(true));
          } else {
            setPreviewOpen(true);
          }
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
    isTypingTarget,
    copySelection,
    pasteFromClipboard,
    duplicateSelection,
    nextPageId,
    prevPageId,
    projectId,
    router,
    dirty,
    save,
  ]);

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
        setDirty(true);
      } else {
        stageRef.current?.addText({ fontFamily: family });
      }
    },
    [],
  );

  const handlePickClipart = useCallback((url: string, resourceId: string) => {
    void stageRef.current?.addClipart(url, resourceId);
  }, []);

  const handlePickBackground = useCallback((url: string, _resourceId: string) => {
    stageRef.current?.setBackground({ type: "resource", url });
    setDirty(true);
  }, []);

  return (
    /*
     * CSS 변수 --toolbar-h: MobileToolbar 높이.
     * 모바일 캔버스 높이 계산: calc(100dvh - 헤더높이 - --toolbar-h)
     */
    <div
      className="flex min-h-[calc(100dvh-4rem)] flex-col"
      style={{ "--toolbar-h": "64px" } as React.CSSProperties}
    >
      {/* 상단 — 페이지 번호 + 네비 + 저장 */}
      <header className="sticky top-0 z-30 flex flex-wrap items-center gap-2 border-b bg-background/95 px-3 py-2 backdrop-blur md:px-6">
        <Button asChild variant="ghost" size="sm">
          <Link href={`/editor/${projectId}`}>← 페이지 목록</Link>
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
                      router.push(`/editor/${projectId}/pages/${s.id}`);
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
            <Button asChild variant="ghost" size="icon" aria-label="이전 페이지 (K)">
              <Link href={`/editor/${projectId}/pages/${prevPageId}`}>
                <ChevronLeft className="size-5" />
              </Link>
            </Button>
          ) : (
            <Button variant="ghost" size="icon" disabled aria-label="이전 페이지">
              <ChevronLeft className="size-5 opacity-30" />
            </Button>
          )}
          {nextPageId ? (
            <Button asChild variant="ghost" size="icon" aria-label="다음 페이지 (J)">
              <Link href={`/editor/${projectId}/pages/${nextPageId}`}>
                <ChevronRight className="size-5" />
              </Link>
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
            onClick={() => {
              if (dirty) {
                void save().then(() => setPreviewOpen(true));
              } else {
                setPreviewOpen(true);
              }
            }}
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
       *   padding-bottom: var(--toolbar-h) → MobileToolbar 아래 가림 방지.
       * 데스크탑: 3단 flex-row.
       */}
      <div className="flex flex-1 flex-col gap-3 p-3 pb-[var(--toolbar-h)] md:flex-row md:gap-4 md:p-6 md:pb-6">
        {/* 좌측 (데스크탑만) — Toolbar + Palette */}
        <aside
          aria-label="도구 / 리소스"
          className="hidden md:flex md:w-72 md:shrink-0 md:flex-col md:gap-3"
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

        {/* 중앙 — Stage */}
        <main
          className={cn(
            "flex min-h-0 flex-1 flex-col items-center justify-start gap-3",
            // 모바일: 터치 전용, 사이드바 없음
            "touch-action-none",
          )}
        >
          <FabricStage
            ref={stageRef}
            widthMm={bookSize.width_mm}
            heightMm={bookSize.height_mm}
            bleedMm={2}
            dpi={PREVIEW_DPI}
            pageId={pageId}
            onSelectionChange={setSelection}
            onModified={() => setDirty(true)}
            onHistoryChange={(u, r) => {
              setCanUndo(u);
              setCanRedo(r);
            }}
            onReady={handleStageReady}
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCollageOpen(true)}
            >
              콜라주 템플릿 변경
            </Button>
          </div>
        </main>

        {/* 우측 (데스크탑만) — SelectionPanel */}
        <aside
          aria-label="속성"
          className="hidden md:block md:w-72 md:shrink-0"
        >
          <SelectionPanel
            selection={selection}
            dpi={PREVIEW_DPI}
            onChange={() => setDirty(true)}
            onReplacePhoto={() => setPhotoPickerOpen(true)}
          />
        </aside>
      </div>

      {/* ====================== 모바일 전용 영역 ====================== */}

      {/* 하단 탭 바 (모바일) */}
      <MobileToolbar
        activeTab={mobileTab}
        onTabPress={handleMobileTabPress}
        className="md:hidden"
      />

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
              // 리소스 팔레트가 필요한 도구는 toolSheet 로 위임.
              setToolSheet(tool);
            }}
            onUndo={() => {
              stageRef.current?.undo();
            }}
            onRedo={() => {
              stageRef.current?.redo();
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
            onChange={() => setDirty(true)}
            onReplacePhoto={() => {
              setPhotoPickerOpen(true);
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
                setPhotoPickerOpen(true);
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
                setDirty(true);
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
            : toolSheet === "image"
              ? "사진"
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
            onChange={() => setDirty(true)}
            onReplacePhoto={() => setPhotoPickerOpen(true)}
          />
        ) : toolSheet === "clipart" || toolSheet === "background" ? (
          <ResourcePalette
            initialTab={toolSheet}
            onPickFont={() => {}}
            onPickClipart={(url, resourceId) => {
              void stageRef.current?.addClipart(url, resourceId);
              setToolSheet(null);
            }}
            onPickBackground={(url, _resourceId) => {
              stageRef.current?.setBackground({ type: "resource", url });
              setDirty(true);
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
        ) : toolSheet === "image" ? (
          <ResourcePalette
            initialTab="clipart"
            onPickFont={() => {}}
            onPickClipart={(url, resourceId) => {
              void stageRef.current?.addClipart(url, resourceId);
              setToolSheet(null);
            }}
            onPickBackground={() => {}}
          />
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
            void stageRef.current?.loadDoc(next, initialPhotoUrls);
            setDirty(true);
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
          setDirty(true);
          toast({ description: "사진 교체 완료", variant: "success" });
        }}
      />
    </div>
  );
}

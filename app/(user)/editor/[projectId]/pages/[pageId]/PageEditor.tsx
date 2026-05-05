"use client";

import { ChevronLeft, ChevronRight, Keyboard, Save } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import CollageTemplateDialog from "@/components/editor/CollageTemplateDialog";
import FabricStage, {
  PREVIEW_DPI,
  type FabricStageHandle,
} from "@/components/editor/FabricStage";
import KeyboardShortcutsHelp, {
  useShortcutsAutoShow,
} from "@/components/editor/KeyboardShortcutsHelp";
import ResourcePalette from "@/components/editor/ResourcePalette";
import SelectionPanel from "@/components/editor/SelectionPanel";
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
import { fabricClipboard } from "@/lib/fabric/clipboard";
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
 *   - 모바일:   상단 미니 헤더 / 가운데 FabricStage / 하단 Toolbar 바텀시트
 *
 * 저장:
 *   - 수동: "저장" 버튼.
 *   - 자동: 토글(기본 ON). 변경 후 5초 debounce.
 *   - leave guard: 미저장 변경이 있을 때 beforeunload.
 *
 * M12 추가:
 *   - 단축키 (복사/붙여넣기/복제, 페이지 점프, 단축키 안내)
 *   - 페이지 번호 드롭다운 점프
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
  const [currentDoc, setCurrentDoc] = useState<PageDoc | null>(initialDoc);

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

  // 페이지 doc 로드 (FabricStage 마운트 후)
  useEffect(() => {
    const handle = stageRef.current;
    if (!handle || !initialDoc) return;
    void handle.loadDoc(initialDoc, initialPhotoUrls);
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

  // ====================== 단축키 핸들러 ======================
  const copySelection = useCallback(() => {
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
    const snap = fabricClipboard.copy(
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
    if (!fabricClipboard.hasContent) {
      toast({
        description: "클립보드가 비어있어요.",
        variant: "warning",
      });
      return;
    }
    const obj = fabricClipboard.read();
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

      // 복사/붙여넣기/복제
      if (meta) {
        const k = e.key.toLowerCase();
        if (k === "c") {
          e.preventDefault();
          copySelection();
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
  ]);

  return (
    <div className="flex min-h-[calc(100dvh-4rem)] flex-col">
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
            size="icon"
            aria-label="키보드 단축키 (?)"
            onClick={() => setShortcutsOpen(true)}
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

      <div className="flex flex-1 flex-col gap-3 p-3 md:flex-row md:gap-4 md:p-6">
        {/* 좌측 (데스크탑) — Toolbar + Palette */}
        <aside
          aria-label="도구 / 리소스"
          className={cn(
            "hidden md:flex md:w-72 md:shrink-0 md:flex-col md:gap-3",
          )}
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
              onPickFont={(family) => {
                const sel = stageRef.current?.getSelection();
                if (sel && sel.oType === "text") {
                  // selection 이 텍스트면 family 변경
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
              }}
              onPickClipart={(url, resourceId) => {
                void stageRef.current?.addClipart(url, resourceId);
              }}
              onPickBackground={(url) => {
                stageRef.current?.setBackground({ type: "resource", url });
                setDirty(true);
              }}
            />
          </div>
        </aside>

        {/* 중앙 — Stage */}
        <main className="flex min-h-0 flex-1 flex-col items-center justify-start gap-3">
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

        {/* 우측 (데스크탑) — SelectionPanel */}
        <aside
          aria-label="속성"
          className="hidden md:block md:w-72 md:shrink-0"
        >
          <SelectionPanel
            selection={selection}
            dpi={PREVIEW_DPI}
            onChange={() => setDirty(true)}
          />
        </aside>
      </div>

      {/* 하단 (모바일) — Toolbar */}
      <div className="sticky bottom-0 z-20 border-t bg-background/95 p-3 backdrop-blur md:hidden">
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

      {/* 모바일 바텀시트 — 도구 선택 시 */}
      <MobileBottomSheet
        open={toolSheet !== null}
        onOpenChange={(o) => !o && setToolSheet(null)}
        title={toolSheet === "text" ? "텍스트" : toolSheet === "image" ? "사진" : toolSheet === "clipart" ? "클립아트" : toolSheet === "background" ? "배경" : "레이어"}
      >
        {toolSheet === "text" ? (
          <SelectionPanel
            selection={selection}
            dpi={PREVIEW_DPI}
            onChange={() => setDirty(true)}
          />
        ) : toolSheet === "clipart" || toolSheet === "background" ? (
          <ResourcePalette
            initialTab={toolSheet}
            onPickFont={() => {}}
            onPickClipart={(url, resourceId) => {
              void stageRef.current?.addClipart(url, resourceId);
              setToolSheet(null);
            }}
            onPickBackground={(url) => {
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
    </div>
  );
}

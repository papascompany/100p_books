"use client";

import { Eye, Save } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import dynamic from "next/dynamic";

import Cover3DPreview from "@/components/editor/Cover3DPreview";
import CoverSpineGuide from "@/components/editor/CoverSpineGuide";
import CoverTemplateDialog from "@/components/editor/CoverTemplateDialog";
import type { FabricStageHandle } from "@/components/editor/FabricStage";
import PhotoPickerDialog from "@/components/editor/PhotoPickerDialog";
import ResourcePalette from "@/components/editor/ResourcePalette";

const FabricStage = dynamic(() => import("@/components/editor/FabricStage"), {
  ssr: false,
  loading: () => (
    <div className="flex h-64 w-full items-center justify-center bg-[#f5f5f5]">
      <div className="size-10 animate-spin rounded-full border-4 border-[#dedede] border-t-[#111111]" />
    </div>
  ),
});
const SelectionPanel = dynamic(() => import("@/components/editor/SelectionPanel"), { ssr: false });
const PREVIEW_DPI = 72;
import Toolbar, { type ToolbarTool } from "@/components/editor/Toolbar";
import MobileBottomSheet from "@/components/layout/MobileBottomSheet";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/use-toast";
import type { BookSize } from "@/lib/db/types";
import type { TaggedFabricObject } from "@/lib/fabric/serialize";
import {
  buildSpineText,
  calcCoverDimensions,
  SPINE_TEXT_MIN_MM,
} from "@/lib/layout/cover";
import { PAGEDOC_VERSION, type PageDoc } from "@/lib/layout/types";
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
  initialPhotoUrls: Record<string, string>;
  bookSize: BookSize;
  pageCount: number;
  /** 사용자가 표지에 추가할 수 있는 프로젝트 사진 목록(앞쪽 N장). */
  projectPhotos: ProjectPhotoSummary[];
}

const AUTOSAVE_DEBOUNCE_MS = 5000;

/**
 * 표지 에디터 클라이언트.
 *
 * 레이아웃:
 *   - 데스크탑: 좌측(템플릿 + 팔레트) / 중앙 캔버스 / 우측 SelectionPanel.
 *   - 모바일: 상단 헤더 / 가로 스크롤 가능한 캔버스 / 하단 Toolbar.
 *
 * 저장:
 *   - 수동 + 5초 debounce 자동저장 토글.
 *   - PATCH /api/cover.
 *   - dirty 시 beforeunload guard.
 *
 * 책등 가이드는 CoverSpineGuide 가 캔버스 위 absolute 오버레이로 그린다.
 */
export default function CoverEditor({
  projectId,
  projectTitle,
  initialDoc,
  initialIsDefault,
  initialPhotoUrls,
  bookSize,
  pageCount,
  projectPhotos,
}: CoverEditorProps) {
  const stageRef = useRef<FabricStageHandle>(null);
  const [selection, setSelection] = useState<TaggedFabricObject | null>(null);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [autosave, setAutosave] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  // 초기 doc 가 default(미저장) 면 dirty=true 로 시작 (자동저장이 작동하도록).
  const [dirty, setDirty] = useState(initialIsDefault);
  const [error, setError] = useState<string | null>(null);
  const [toolSheet, setToolSheet] = useState<ToolbarTool | null>(null);
  const [photoSheetOpen, setPhotoSheetOpen] = useState(false);
  const [templateDialogOpen, setTemplateDialogOpen] = useState(false);
  const [photoPickerOpen, setPhotoPickerOpen] = useState(false);
  const [currentDoc, setCurrentDoc] = useState<PageDoc>(initialDoc);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [photoUrls, _setPhotoUrls] =
    useState<Record<string, string>>(initialPhotoUrls);
  const [showGuide, setShowGuide] = useState(true);
  const [title, setTitle] = useState(projectTitle);
  const [titleSaving, setTitleSaving] = useState(false);
  const lastSavedTitleRef = useRef(projectTitle);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewPng, setPreviewPng] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  // 표지 차원 (책등 두께 표시용)
  const dims = calcCoverDimensions({ bookSize, pageCount });
  const spineTooNarrow = dims.spineMm < SPINE_TEXT_MIN_MM;

  // 첫 마운트 시 doc 로드 — FabricStage 준비 완료 시 (lazy load 지원)
  const handleStageReady = useCallback(() => {
    void stageRef.current?.loadDoc(initialDoc, initialPhotoUrls);
    // 의도적으로 초기 1회만 로드.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      pageNo: 0,
      layoutMode: "cover",
      widthMm: currentDoc.widthMm,
      heightMm: currentDoc.heightMm,
      bleedMm: 2,
      backgroundColor: currentDoc.backgroundColor,
      backgroundImage: currentDoc.backgroundImage,
    });
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/cover`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId, fabricJson: doc }),
      });
      const json = (await res.json()) as {
        ok: boolean;
        error?: { message: string };
      };
      if (!res.ok || !json.ok) {
        throw new Error(json.error?.message ?? "표지 저장에 실패했어요.");
      }
      setSavedAt(Date.now());
      setDirty(false);
      setCurrentDoc(doc);
    } catch (e) {
      setError(e instanceof Error ? e.message : "표지 저장에 실패했어요.");
    } finally {
      setSaving(false);
    }
  }, [bookSize.id, currentDoc, projectId]);

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
  }, [dirty, autosave, save]);

  const onToolPick = useCallback((tool: ToolbarTool) => {
    if (tool === "image") {
      setPhotoSheetOpen(true);
      return;
    }
    setToolSheet(tool);
  }, []);

  // 사진 추가
  const addProjectPhoto = useCallback(
    async (photoId: string) => {
      const url = photoUrls[photoId];
      if (!url) return;
      await stageRef.current?.addPhoto(photoId, url);
      setDirty(true);
      setPhotoSheetOpen(false);
    },
    [photoUrls],
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
    setDirty(true);
  }, [dims]);

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

  const onApplyTemplate = useCallback(
    (next: PageDoc) => {
      setCurrentDoc(next);
      void stageRef.current?.loadDoc(next, photoUrls);
      setDirty(true);
    },
    [photoUrls],
  );

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
    setDirty(true);
    toast({ description: "책등 텍스트를 추가했어요.", variant: "success" });
  }, [dims, spineTooNarrow, title]);

  // 3D 미리보기 열기 — 자동저장 후 서버 PNG 미리보기 요청
  const openPreview = useCallback(async () => {
    setPreviewOpen(true);
    setPreviewError(null);
    setPreviewLoading(true);
    setPreviewPng(null);

    // dirty 면 먼저 저장 (서버 미리보기는 저장된 cover_json 기반)
    if (dirty) {
      try {
        await save();
      } catch {
        // save() 자체가 setError 처리하므로 미리보기는 마지막 저장본으로 진행
      }
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

  return (
    <div className="flex min-h-[calc(100dvh-4rem)] flex-col">
      {/* 상단 헤더 */}
      <header className="sticky top-0 z-30 flex flex-wrap items-center gap-2 border-b bg-background/95 px-3 py-2 backdrop-blur md:px-6">
        <Button asChild variant="ghost" size="sm">
          <Link href={`/editor/${projectId}`}>← 내지 편집</Link>
        </Button>
        <span className="text-xs uppercase tracking-widest text-rose-500/90">
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
            onClick={() => setTemplateDialogOpen(true)}
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
          <Button asChild variant="outline" size="sm">
            <Link href={`/order/${projectId}`} aria-label="다음: 주문">
              다음: 주문
            </Link>
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
              onPickFont={(family) => {
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
                  setDirty(true);
                }
              }}
              onPickClipart={(url, resourceId) => {
                void stageRef.current?.addClipart(url, resourceId);
                setDirty(true);
              }}
              onPickBackground={(url) => {
                stageRef.current?.setBackground({ type: "resource", url });
                setDirty(true);
              }}
            />
          </div>
        </aside>

        {/* 중앙 — Stage + 가이드 오버레이 */}
        <main className="flex min-h-0 flex-1 flex-col items-center justify-start gap-3">
          {/* 표지는 가로로 길어서 모바일에선 가로 스크롤 가능. */}
          <div className="relative w-full overflow-x-auto">
            <div className="relative inline-block min-w-full">
              <FabricStage
                ref={stageRef}
                widthMm={currentDoc.widthMm}
                heightMm={currentDoc.heightMm}
                bleedMm={2}
                dpi={PREVIEW_DPI}
                onSelectionChange={setSelection}
                onModified={() => setDirty(true)}
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
            onChange={() => setDirty(true)}
            onReplacePhoto={() => setPhotoPickerOpen(true)}
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
              setDirty(true);
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
        ) : null}
      </MobileBottomSheet>

      {/* 사진 추가 바텀시트 */}
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
                  className="block aspect-square w-full overflow-hidden rounded-md border border-border bg-white"
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
          setDirty(true);
          toast({ description: "사진 교체 완료", variant: "success" });
        }}
      />

      {/* 3D 미리보기 다이얼로그 */}
      {previewOpen ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="표지 3D 미리보기"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-[2px]"
          onClick={() => setPreviewOpen(false)}
        >
          <div
            className="relative w-[min(94vw,720px)] rounded-xl border border-border bg-background p-5 shadow-soft-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 pb-3">
              <div>
                <h2 className="text-base font-semibold">표지 3D 미리보기</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  실제 인쇄/제본 후의 입체 형태를 근사로 보여줘요.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPreviewOpen(false)}
                aria-label="닫기"
                className="-mt-1 inline-flex size-9 items-center justify-center rounded-md text-muted-foreground hover:bg-accent"
              >
                ×
              </button>
            </div>

            <div className="flex min-h-[360px] items-center justify-center rounded-lg bg-gradient-to-br from-rose-50/40 via-amber-50/30 to-sky-50/40 dark:from-rose-950/20 dark:via-amber-950/20 dark:to-sky-950/20">
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
              <Button
                size="sm"
                variant="gradient"
                onClick={() => setPreviewOpen(false)}
              >
                닫기
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

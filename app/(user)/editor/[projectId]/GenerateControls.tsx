"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Sparkles } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import type { LayoutMode } from "@/lib/db/types";
import {
  COLLAGE_TEMPLATE_META,
  DEFAULT_COLLAGE_TEMPLATE,
} from "@/lib/layout/templates";
import type { CollageTemplateId } from "@/lib/layout/collage";
import type { SortMode } from "@/lib/layout/types";
import { cn } from "@/lib/utils";

interface SortOption {
  id: SortMode;
  label: string;
  desc: string;
}

const SORT_OPTIONS: SortOption[] = [
  {
    id: "exif",
    label: "촬영시각 순",
    desc: "사진 메타데이터의 찍은 시각 기준",
  },
  { id: "filename", label: "파일명 순", desc: "자연 정렬 (IMG_2 < IMG_10)" },
  { id: "upload", label: "업로드 순", desc: "추가한 순서 그대로" },
  { id: "random", label: "랜덤", desc: "무작위로 섞기" },
];

interface LayoutOption {
  id: LayoutMode;
  label: string;
  desc: string;
}

const LAYOUT_OPTIONS: LayoutOption[] = [
  { id: "polaroid", label: "폴라로이드", desc: "사진 1장 + 캡션" },
  { id: "collage", label: "콜라주", desc: "한 페이지에 여러 장" },
];

export interface GenerateResult {
  pageCount: number;
  layoutMode: LayoutMode;
  sortMode: SortMode;
  templateId: CollageTemplateId | null;
}

export interface GenerateControlsProps {
  projectId: string;
  photoCount: number;
  currentPageCount: number;
  initialLayoutMode: LayoutMode;
  onGenerated: (res: GenerateResult) => void;
}

export default function GenerateControls({
  projectId,
  photoCount,
  currentPageCount,
  initialLayoutMode,
  onGenerated,
}: GenerateControlsProps) {
  const [sortMode, setSortMode] = useState<SortMode>("exif");
  const [layoutMode, setLayoutMode] = useState<LayoutMode>(initialLayoutMode);
  const [templateId, setTemplateId] = useState<CollageTemplateId>(
    DEFAULT_COLLAGE_TEMPLATE,
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const hasExistingPages = currentPageCount > 0;

  async function runGenerate() {
    setSubmitting(true);
    setError(null);
    try {
      const body = {
        projectId,
        sortMode,
        layoutMode,
        ...(layoutMode === "collage" ? { templateId } : {}),
      };
      const res = await fetch("/api/layout/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await res.json()) as {
        ok: boolean;
        data?: {
          pageCount: number;
          layoutMode: LayoutMode;
          sortMode: SortMode;
          templateId: CollageTemplateId | null;
        };
        error?: { message: string };
      };
      if (!res.ok || !json.ok || !json.data) {
        throw new Error(json.error?.message ?? "자동 편집 실패");
      }
      onGenerated(json.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "자동 편집 실패");
    } finally {
      setSubmitting(false);
      setConfirming(false);
    }
  }

  function handleClickGenerate() {
    if (photoCount === 0) {
      setError("먼저 사진을 업로드해 주세요.");
      return;
    }
    if (hasExistingPages) {
      setConfirming(true);
      return;
    }
    void runGenerate();
  }

  return (
    <section
      aria-labelledby="generate-heading"
      className="rounded-xl border bg-white/70 p-5 shadow-soft dark:bg-white/[0.03]"
    >
      <div className="mb-5 flex items-baseline justify-between gap-3">
        <h2
          id="generate-heading"
          className="font-display text-xl font-semibold tracking-tight"
        >
          자동 편집
        </h2>
        <p className="text-xs text-muted-foreground">
          정렬·레이아웃을 정하고 버튼 한 번에 페이지를 만들어요.
        </p>
      </div>

      {/* 정렬 */}
      <fieldset className="mb-6">
        <legend className="mb-2 text-sm font-medium text-foreground">정렬</legend>
        <div
          role="radiogroup"
          aria-label="사진 정렬 방식"
          className="grid gap-2 sm:grid-cols-2 md:grid-cols-4"
        >
          {SORT_OPTIONS.map((opt) => {
            const selected = sortMode === opt.id;
            return (
              <label
                key={opt.id}
                className={cn(
                  "flex min-h-[44px] cursor-pointer items-start gap-2 rounded-lg border p-3 text-sm transition-colors",
                  "focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2",
                  selected
                    ? "border-coral-400 bg-coral-50/60 ring-1 ring-coral-300 dark:border-coral-500/60 dark:bg-coral-500/10 dark:ring-coral-500/40"
                    : "border-input hover:border-coral-200 hover:bg-coral-50/20 dark:hover:border-coral-500/40 dark:hover:bg-coral-500/[0.06]",
                )}
              >
                <input
                  type="radio"
                  name="sortMode"
                  value={opt.id}
                  checked={selected}
                  onChange={() => setSortMode(opt.id)}
                  className="mt-0.5 size-4 shrink-0 accent-coral"
                />
                <span className="min-w-0">
                  <span className="block font-medium">{opt.label}</span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    {opt.desc}
                  </span>
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>

      {/* 레이아웃 */}
      <fieldset className="mb-6">
        <legend className="mb-2 text-sm font-medium text-foreground">레이아웃</legend>
        <div
          role="radiogroup"
          aria-label="레이아웃 방식"
          className="grid gap-2 sm:grid-cols-2"
        >
          {LAYOUT_OPTIONS.map((opt) => {
            const selected = layoutMode === opt.id;
            return (
              <label
                key={opt.id}
                className={cn(
                  "flex min-h-[44px] cursor-pointer items-start gap-2 rounded-lg border p-3 text-sm transition-colors",
                  "focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2",
                  selected
                    ? "border-coral-400 bg-coral-50/60 ring-1 ring-coral-300 dark:border-coral-500/60 dark:bg-coral-500/10 dark:ring-coral-500/40"
                    : "border-input hover:border-coral-200 hover:bg-coral-50/20 dark:hover:border-coral-500/40 dark:hover:bg-coral-500/[0.06]",
                )}
              >
                <input
                  type="radio"
                  name="layoutMode"
                  value={opt.id}
                  checked={selected}
                  onChange={() => setLayoutMode(opt.id)}
                  className="mt-0.5 size-4 shrink-0 accent-coral"
                />
                <span className="min-w-0">
                  <span className="block font-medium">{opt.label}</span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    {opt.desc}
                  </span>
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>

      {/* 콜라주 템플릿 */}
      {layoutMode === "collage" ? (
        <fieldset className="mb-6">
          <legend className="mb-2 text-sm font-medium text-foreground">
            콜라주 템플릿
          </legend>
          <div
            role="radiogroup"
            aria-label="콜라주 템플릿"
            className="grid grid-cols-3 gap-2 sm:grid-cols-6"
          >
            {COLLAGE_TEMPLATE_META.map((meta) => {
              const selected = templateId === meta.id;
              return (
                <label
                  key={meta.id}
                  className={cn(
                    "group flex cursor-pointer flex-col items-center gap-1 rounded-lg border p-2 text-xs transition-colors",
                    "focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2",
                    selected
                      ? "border-rose-400 bg-rose-50/60 ring-1 ring-rose-300 dark:border-rose-500/60 dark:bg-rose-950/40 dark:ring-rose-500/40"
                      : "border-input hover:border-rose-200 hover:bg-rose-50/20 dark:hover:border-rose-500/40 dark:hover:bg-rose-950/20",
                  )}
                  aria-label={`${meta.label} (사진 ${meta.slotCount}장)`}
                >
                  <input
                    type="radio"
                    name="collageTemplate"
                    value={meta.id}
                    checked={selected}
                    onChange={() => setTemplateId(meta.id)}
                    className="sr-only"
                  />
                  <span
                    className="block aspect-square w-full overflow-hidden rounded border border-black/5"
                    // 신뢰할 수 있는 자체 생성 SVG (내부 상수), XSS 위험 없음
                    dangerouslySetInnerHTML={{ __html: meta.previewSvg }}
                  />
                  <span className="mt-0.5 text-center">{meta.label}</span>
                  <span className="text-[10px] text-muted-foreground">
                    {meta.slotCount}장
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>
      ) : null}

      {error ? (
        <p className="mb-3 rounded-md border border-destructive/30 bg-destructive/5 p-2 text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          variant="gradient"
          size="lg"
          disabled={submitting || photoCount === 0}
          onClick={handleClickGenerate}
        >
          <Sparkles className="size-4" aria-hidden />
          {submitting ? "생성 중…" : "자동 편집하기"}
        </Button>
        {photoCount === 0 ? (
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
            사진이 없어요. 업로드부터 시작해 주세요.
            <Link
              href={`/upload?projectId=${projectId}`}
              className="inline-flex min-h-[44px] items-center font-medium text-coral underline underline-offset-4 hover:text-coral-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              사진 업로드하러 가기
            </Link>
          </span>
        ) : (
          <p className="text-xs text-muted-foreground">
            사진 {photoCount}장 기준으로 페이지를 생성합니다.
          </p>
        )}
      </div>

      {/* 재생성 경고 다이얼로그 — Radix Dialog (포커스 트랩·초기 포커스·ESC·오버레이 닫기) */}
      {confirming ? (
        <DialogPrimitive.Root
          open
          onOpenChange={(o) => {
            // 생성 중에는 닫기 차단 — 완료 시 runGenerate 의 finally 가 닫는다.
            if (!o && !submitting) setConfirming(false);
          }}
        >
          <DialogPrimitive.Portal>
            <DialogPrimitive.Overlay
              className={cn(
                "fixed inset-0 z-50 bg-black/50 backdrop-blur-[2px]",
                "data-[state=open]:animate-in data-[state=open]:fade-in-0",
                "data-[state=closed]:animate-out data-[state=closed]:fade-out-0",
              )}
            />
            <DialogPrimitive.Content
              role="alertdialog"
              className={cn(
                "fixed left-1/2 top-1/2 z-50 w-[min(92vw,448px)] -translate-x-1/2 -translate-y-1/2",
                "rounded-xl border bg-card p-5 shadow-soft-lg",
                "focus:outline-none",
              )}
            >
              <DialogPrimitive.Title className="font-display text-lg font-semibold tracking-tight">
                기존 편집 내용을 덮어쓸까요?
              </DialogPrimitive.Title>
              <DialogPrimitive.Description className="mt-2 text-sm text-muted-foreground">
                이미 {currentPageCount}페이지가 만들어져 있어요. 자동 편집을 다시
                실행하면 기존에 편집한 내용이 모두 사라지고 새로 생성됩니다.
              </DialogPrimitive.Description>
              <div className="mt-5 flex justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setConfirming(false)}
                  disabled={submitting}
                >
                  취소
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  onClick={() => void runGenerate()}
                  disabled={submitting}
                >
                  {submitting ? "생성 중…" : "덮어쓰고 다시 만들기"}
                </Button>
              </div>
            </DialogPrimitive.Content>
          </DialogPrimitive.Portal>
        </DialogPrimitive.Root>
      ) : null}
    </section>
  );
}

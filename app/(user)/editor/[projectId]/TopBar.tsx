"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";

export interface TopBarProps {
  projectId: string;
  initialTitle: string;
  photoCount: number;
  pageCount: number;
}

/**
 * 프로젝트 타이틀 인라인 편집 + 사진/페이지 카운트 + 다음/표지 링크.
 * 실제 표지 편집 / 주문 라우트는 M4 / M6 에서 연결.
 */
export default function TopBar({
  projectId,
  initialTitle,
  photoCount,
  pageCount,
}: TopBarProps) {
  const [title, setTitle] = useState(initialTitle);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const lastSavedRef = useRef(initialTitle);

  useEffect(() => {
    lastSavedRef.current = initialTitle;
  }, [initialTitle]);

  async function persistTitle(next: string) {
    const clean = next.trim();
    if (clean.length === 0 || clean === lastSavedRef.current) {
      setTitle(lastSavedRef.current);
      return;
    }
    setSaving(true);
    setSaveError(null);
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
      lastSavedRef.current = clean;
      setTitle(clean);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "제목 저장 실패");
      setTitle(lastSavedRef.current);
    } finally {
      setSaving(false);
    }
  }

  return (
    <header className="flex flex-col gap-4 border-b pb-5 md:flex-row md:items-end md:justify-between">
      <div className="min-w-0">
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-rose-500/90">
          step 2 of 4 · 내지 편집
        </p>
        <label htmlFor="project-title" className="sr-only">
          프로젝트 제목
        </label>
        <input
          id="project-title"
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={(e) => void persistTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              (e.currentTarget as HTMLInputElement).blur();
            }
          }}
          disabled={saving}
          aria-label="프로젝트 제목"
          className="mt-1 w-full max-w-xl bg-transparent font-display text-2xl font-semibold tracking-tight outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:text-3xl"
        />
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
          <span>사진 {photoCount}장</span>
          <span aria-hidden>·</span>
          <span>페이지 {pageCount}p</span>
          {saving ? <span aria-live="polite">저장 중…</span> : null}
          {saveError ? (
            <span className="text-destructive" role="alert">
              {saveError}
            </span>
          ) : null}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button asChild variant="outline" size="sm">
          <Link href={`/cover/${projectId}`} aria-label="표지 편집으로 이동">
            표지 편집
          </Link>
        </Button>
        {pageCount === 0 ? (
          <Button
            variant="gradient"
            size="sm"
            disabled
            aria-label="페이지가 생성된 후에 주문할 수 있어요"
          >
            다음: 주문
          </Button>
        ) : (
          <Button asChild variant="gradient" size="sm">
            <Link href={`/order/${projectId}`} aria-label="주문 단계로 이동">
              다음: 주문
            </Link>
          </Button>
        )}
      </div>
    </header>
  );
}

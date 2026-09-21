"use client";

import { Share2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import ShareDialog from "@/components/editor/ShareDialog";
import { Button } from "@/components/ui/button";
import {
  READ_ONLY_BADGE_LABEL,
  resolveTitleFieldLockState,
} from "@/lib/editor/lock-ui";

export interface TopBarProps {
  projectId: string;
  initialTitle: string;
  photoCount: number;
  pageCount: number;
  /**
   * 결제 후 편집 잠금 안내(서버 페이지 판정). 값이 있으면 제목 편집·저장을 막는다.
   * 배너는 EditorClient 가 1회 노출하므로 여기서는 비활성 + 짧은 상태 표시만 한다.
   */
  lockMessage: string | null;
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
  lockMessage,
}: TopBarProps) {
  const [title, setTitle] = useState(initialTitle);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const lastSavedRef = useRef(initialTitle);
  const [shareOpen, setShareOpen] = useState(false);

  useEffect(() => {
    lastSavedRef.current = initialTitle;
  }, [initialTitle]);

  /** 표지(CoverEditor)와 같은 규약 — 잠기면 입력 비활성 + 저장 요청 자체를 보내지 않는다. */
  const titleField = resolveTitleFieldLockState({ saving, lockMessage });

  async function persistTitle(next: string) {
    // 잠긴 포토북: 서버에 보내봐야 409 PROJECT_LOCKED 다 — 직전 제목으로 되돌린다.
    if (!titleField.canPersist) {
      setTitle(lastSavedRef.current);
      return;
    }
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
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-coral/90">
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
          disabled={titleField.disabled}
          title={titleField.lockMessage ?? undefined}
          aria-label="프로젝트 제목"
          className="mt-1 w-full max-w-xl bg-transparent font-display text-2xl font-semibold tracking-tight outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:text-3xl"
        />
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
          <span>사진 {photoCount}장</span>
          <span aria-hidden>·</span>
          <span>페이지 {pageCount}p</span>
          {titleField.lockMessage !== null ? (
            <span className="rounded-full border border-amber-300/60 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-900 dark:border-amber-800/60 dark:bg-amber-950/40 dark:text-amber-200">
              {READ_ONLY_BADGE_LABEL}
            </span>
          ) : null}
          {saving ? <span aria-live="polite">저장 중…</span> : null}
          {saveError ? (
            <span className="text-destructive" role="alert">
              {saveError}
            </span>
          ) : null}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setShareOpen(true)}
          aria-label="포토북 공유 링크 관리"
        >
          <Share2 className="size-4" aria-hidden />
          공유
        </Button>
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

      <ShareDialog
        open={shareOpen}
        onOpenChange={setShareOpen}
        projectId={projectId}
      />
    </header>
  );
}

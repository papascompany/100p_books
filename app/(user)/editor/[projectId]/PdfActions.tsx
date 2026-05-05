"use client";

import { Download, FileDown, Loader2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";

export interface PdfActionsProps {
  projectId: string;
  /** 페이지 0 이면 비활성. */
  pageCount: number;
}

interface ProgressSnap {
  status: "queued" | "running" | "done" | "failed";
  progress: { done: number; total: number; phase: "render" | "compose" };
  result?: { coverUrl?: string; interiorUrl?: string };
  error?: string;
}

type Target = "interior" | "cover" | "all";

/**
 * PDF 빌드 + 다운로드 액션 카드.
 *   - "표지 PDF", "내지 PDF", "전체 다운로드" 3개 버튼.
 *   - 클릭 시 POST /api/pdf/build → 응답에 signedUrl + jobId.
 *   - jobId 로 SSE /api/pdf/progress 구독해 진행률 표시 (인라인 모델이라
 *     실제로는 응답 도착 후 거의 즉시 done 이벤트만 수신될 수 있음).
 *   - 응답 도착 시 signedUrl 로 자동 다운로드 트리거.
 */
export default function PdfActions({ projectId, pageCount }: PdfActionsProps) {
  const [busy, setBusy] = useState<Target | null>(null);
  const [progress, setProgress] = useState<ProgressSnap | null>(null);
  const [error, setError] = useState<string | null>(null);
  const esRef = useRef<EventSource | null>(null);

  const closeStream = useCallback(() => {
    esRef.current?.close();
    esRef.current = null;
  }, []);

  useEffect(() => {
    return () => closeStream();
  }, [closeStream]);

  async function build(target: Target) {
    setBusy(target);
    setError(null);
    setProgress({
      status: "running",
      progress: { done: 0, total: 1, phase: "render" },
    });

    try {
      // 빌드 요청 (인라인 처리 — 응답까지 시간이 걸림)
      const res = await fetch(`/api/pdf/build`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId, target }),
      });
      const json = (await res.json()) as {
        ok: boolean;
        data?: {
          jobId: string;
          coverUrl?: string;
          interiorUrl?: string;
        };
        error?: { message: string };
      };

      if (!res.ok || !json.ok || !json.data) {
        throw new Error(json.error?.message ?? "PDF 빌드에 실패했습니다.");
      }

      // 진행률 SSE — done 이벤트만 받으면 종료. 빌드가 이미 끝났다면 즉시 close.
      const { jobId, coverUrl, interiorUrl } = json.data;
      const es = new EventSource(`/api/pdf/progress?jobId=${jobId}`);
      esRef.current = es;
      es.onmessage = (ev) => {
        try {
          const snap = JSON.parse(ev.data) as ProgressSnap;
          setProgress(snap);
          if (snap.status === "done" || snap.status === "failed") {
            closeStream();
          }
        } catch {
          // ignore parse errors
        }
      };
      es.onerror = () => {
        closeStream();
      };

      // 자동 다운로드 트리거 (signedUrl 은 download=filename 이 붙어 있어 다운로드 강제)
      if (interiorUrl) triggerDownload(interiorUrl);
      if (coverUrl) {
        // 두 파일 동시 다운로드 시 일부 브라우저가 한 개만 처리 → 약간 딜레이.
        if (interiorUrl) await delay(300);
        triggerDownload(coverUrl);
      }
      setProgress({
        status: "done",
        progress: { done: 1, total: 1, phase: "compose" },
        result: { coverUrl, interiorUrl },
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "PDF 빌드 실패");
      setProgress({
        status: "failed",
        progress: { done: 0, total: 0, phase: "render" },
      });
    } finally {
      setBusy(null);
    }
  }

  const disabled = pageCount === 0;
  const pct = computePct(progress);

  return (
    <section
      aria-labelledby="pdf-actions-heading"
      className="rounded-2xl border bg-card p-4 sm:p-5"
    >
      <header className="mb-3 flex items-baseline justify-between">
        <h3
          id="pdf-actions-heading"
          className="font-display text-lg font-semibold tracking-tight"
        >
          PDF 다운로드
        </h3>
        <p className="text-xs text-muted-foreground">
          300dpi · 재단선 2mm 포함
        </p>
      </header>

      {disabled ? (
        <p className="text-sm text-muted-foreground">
          내지 페이지를 먼저 생성하세요.
        </p>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={!!busy}
            onClick={() => void build("cover")}
            aria-label="표지 PDF 다운로드"
          >
            {busy === "cover" ? (
              <Loader2 className="animate-spin" />
            ) : (
              <FileDown />
            )}
            표지 PDF
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={!!busy}
            onClick={() => void build("interior")}
            aria-label="내지 PDF 다운로드"
          >
            {busy === "interior" ? (
              <Loader2 className="animate-spin" />
            ) : (
              <FileDown />
            )}
            내지 PDF
          </Button>
          <Button
            variant="gradient"
            size="sm"
            disabled={!!busy}
            onClick={() => void build("all")}
            aria-label="표지 + 내지 PDF 모두 다운로드"
          >
            {busy === "all" ? (
              <Loader2 className="animate-spin" />
            ) : (
              <Download />
            )}
            전체 다운로드
          </Button>
        </div>
      )}

      {progress && busy ? (
        <div className="mt-4 space-y-1.5" aria-live="polite">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>
              {progress.progress.phase === "render" ? "렌더링" : "PDF 합성"} ·{" "}
              {progress.progress.done}/{progress.progress.total || 1}
            </span>
            <span>{pct}%</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full bg-rose-500 transition-[width] duration-200"
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      ) : null}

      {progress?.status === "done" && progress.result ? (
        <p className="mt-3 text-xs text-muted-foreground">
          다운로드가 시작되지 않았다면{" "}
          {progress.result.coverUrl ? (
            <a
              href={progress.result.coverUrl}
              className="underline hover:text-foreground"
            >
              표지
            </a>
          ) : null}
          {progress.result.coverUrl && progress.result.interiorUrl ? " · " : null}
          {progress.result.interiorUrl ? (
            <a
              href={progress.result.interiorUrl}
              className="underline hover:text-foreground"
            >
              내지
            </a>
          ) : null}{" "}
          링크를 다시 눌러주세요.
        </p>
      ) : null}

      {error ? (
        <p
          role="alert"
          className="mt-3 rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive"
        >
          {error}
        </p>
      ) : null}
    </section>
  );
}

function computePct(snap: ProgressSnap | null): number {
  if (!snap) return 0;
  if (snap.status === "done") return 100;
  if (snap.status === "failed") return 0;
  const { done, total, phase } = snap.progress;
  if (!total) return 0;
  // render 단계는 0..50%, compose 단계는 50..100%
  const ratio = Math.max(0, Math.min(1, done / total));
  return phase === "render"
    ? Math.round(ratio * 50)
    : Math.round(50 + ratio * 50);
}

function triggerDownload(url: string) {
  const a = document.createElement("a");
  a.href = url;
  // signedUrl 의 ?download=filename 가 콘텐츠 디스포지션을 결정하므로 a.download 는 보조.
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function delay(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

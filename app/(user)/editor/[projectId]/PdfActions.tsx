"use client";

import { Download, FileDown, Loader2 } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";

export interface PdfActionsProps {
  projectId: string;
  /** 페이지 0 이면 비활성. */
  pageCount: number;
}

type Target = "interior" | "cover" | "all";

interface BuildResult {
  coverUrl?: string;
  interiorUrl?: string;
}

/**
 * PDF 빌드 + 다운로드 액션 카드.
 *   - "표지 PDF", "내지 PDF", "전체 다운로드" 3개 버튼.
 *   - 클릭 시 POST /api/pdf/build → 빌드는 서버에서 동기 실행(수십 초~수 분)이라
 *     응답이 곧 완료. 중간 진행률은 제공되지 않으므로(진행률 SSE 는 인메모리 잡
 *     기반이라 본 영속 jobId 로는 조회 불가) 가짜 %바 대신 indeterminate
 *     표시 + 소요 시간 안내로 정직하게 보여준다.
 *   - 완료 시 자동 다운로드는 1개 파일만 트리거 — 긴 fetch 후에는 사용자 제스처
 *     컨텍스트가 소멸해 iOS Safari 등이 연속 자동 다운로드를 차단할 수 있어,
 *     나머지 파일은 명시적 "저장" 버튼(실제 클릭 제스처)으로 받게 한다.
 */
export default function PdfActions({ projectId, pageCount }: PdfActionsProps) {
  const [busy, setBusy] = useState<Target | null>(null);
  const [result, setResult] = useState<BuildResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function build(target: Target) {
    setBusy(target);
    setError(null);
    setResult(null);

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

      const { coverUrl, interiorUrl } = json.data;

      // 자동 다운로드는 첫 파일만 — 두 번째는 아래 명시적 버튼으로.
      const first = interiorUrl ?? coverUrl;
      if (first) triggerDownload(first);

      setResult({ coverUrl, interiorUrl });
    } catch (e) {
      setError(e instanceof Error ? e.message : "PDF 빌드 실패");
    } finally {
      setBusy(null);
    }
  }

  const disabled = pageCount === 0;

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

      {/* 빌드 진행 — 서버가 중간 진행률을 주지 않으므로 indeterminate 로 정직하게 */}
      {busy ? (
        <div className="mt-4 space-y-2" aria-live="polite">
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 shrink-0 animate-spin" aria-hidden />
            PDF를 만들고 있어요 — 페이지 수에 따라 몇 분까지 걸릴 수 있어요.
            화면을 닫지 말고 기다려 주세요.
          </p>
          <div
            role="progressbar"
            aria-label="PDF 생성 중"
            className="h-1.5 overflow-hidden rounded-full bg-muted"
          >
            <div className="h-full w-full animate-pulse rounded-full bg-coral/50" />
          </div>
        </div>
      ) : null}

      {/* 완료 — 파일별 명시적 저장 버튼 (자동 다운로드 차단 대비 + 두 번째 파일용) */}
      {!busy && result ? (
        <div className="mt-4 space-y-2" aria-live="polite">
          <p className="text-xs text-muted-foreground">
            PDF가 준비됐어요. 다운로드가 시작되지 않았거나 파일이 더 있다면 아래
            버튼으로 저장해 주세요.
          </p>
          <div className="flex flex-wrap gap-2">
            {result.coverUrl ? (
              <Button asChild variant="outline" size="sm">
                <a href={result.coverUrl} rel="noopener">
                  <FileDown />
                  표지 PDF 저장
                </a>
              </Button>
            ) : null}
            {result.interiorUrl ? (
              <Button asChild variant="outline" size="sm">
                <a href={result.interiorUrl} rel="noopener">
                  <FileDown />
                  내지 PDF 저장
                </a>
              </Button>
            ) : null}
          </div>
        </div>
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

function triggerDownload(url: string) {
  const a = document.createElement("a");
  a.href = url;
  // 다운로드 프록시(/api/pdf/download)가 Content-Disposition: attachment 를
  // 내려주므로 a.download 지정은 불필요.
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

"use client";

import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import GenerateControls, { requestLayoutGenerate } from "./GenerateControls";
import PdfActions from "./PdfActions";
import PreviewGrid, { type PageSummary } from "./PreviewGrid";
import TopBar from "./TopBar";
import ReadOnlyNotice from "@/components/editor/ReadOnlyNotice";
import { toast } from "@/components/ui/use-toast";
import type { BookSize, LayoutMode } from "@/lib/db/types";
import {
  AUTOGEN_DEFAULTS,
  editorEntryHref,
  shouldAutoGenerate,
} from "@/lib/editor/autogen";
import { normalizeLockMessage } from "@/lib/editor/lock-ui";
import { userMessageFromJson } from "@/lib/errors/user-message";

export interface EditorClientProps {
  projectId: string;
  initialTitle: string;
  initialLayoutMode: LayoutMode;
  photoCount: number;
  initialPageCount: number;
  bookSize: BookSize | null;
  /**
   * 결제 후 편집 잠금 안내(서버 페이지 판정). 값이 있으면 배너로 알리고 재생성·추가·삭제·순서 변경을 막는다.
   * 서버도 409 PROJECT_LOCKED 로 막으므로 이것은 안내다.
   */
  lockMessage: string | null;
  /** 저장된 표지가 있는지 — TopBar 주 버튼(표지 만들기 / 주문) 결정. */
  hasCover: boolean;
  /**
   * 업로드 직후 진입(`?autogen=1`, 서버 페이지 판정) — 0페이지·잠기지 않음·사진 있음이면 마운트 시
   * 한 번 기본값으로 자동 생성한다(P6). 쿼리는 처리 후 지운다.
   */
  autogenRequested: boolean;
}

/** 업로드 직후 자동 생성 진행 상태 — running 동안 생성 폼 대신 진행 안내를 보여준다. */
type AutogenStatus = "idle" | "running" | "done" | "failed";

/** 내지 목록 조회 — state 는 건드리지 않고 응답만 돌려준다(실패 시 throw). */
async function requestPages(
  projectId: string,
): Promise<{ pages: PageSummary[]; photoUrls: Record<string, string> }> {
  const res = await fetch(`/api/pages?projectId=${projectId}`, {
    cache: "no-store",
  });
  const json = (await res.json()) as {
    ok: boolean;
    data?: { pages: PageSummary[]; photoUrls: Record<string, string> };
    error?: { message: string };
  };
  if (!res.ok || !json.ok || !json.data) {
    throw new Error(userMessageFromJson(json, "페이지를 불러오지 못했어요. 새로고침해 주세요."));
  }
  return json.data;
}

/**
 * 내지 편집 메인 클라이언트 셸 —
 *   상단 TopBar + 좌/상단 컨트롤 + 하단 썸네일 프리뷰 구성.
 *   - 페이지 데이터 로딩은 /api/pages 에 한 번만 보내고 재생성 / reorder / insert / delete 시 다시 fetch.
 *   - reorder/insert/delete 는 낙관적 업데이트 후 실패 시 toast.
 */
export default function EditorClient({
  projectId,
  initialTitle,
  initialLayoutMode,
  photoCount,
  initialPageCount,
  bookSize,
  lockMessage,
  hasCover,
  autogenRequested,
}: EditorClientProps) {
  const router = useRouter();
  const [pages, setPages] = useState<PageSummary[]>([]);
  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>({});
  /** 초기 1회 로드 전용 — true 인 동안만 PreviewGrid 가 스켈레톤을 그린다. */
  const [loading, setLoading] = useState<boolean>(true);
  /** 재조회(insert/delete/재생성 후) — 기존 그리드를 유지한 채 얇은 표시만. */
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [pageCount, setPageCount] = useState<number>(initialPageCount);
  const [layoutMode, setLayoutMode] = useState<LayoutMode>(initialLayoutMode);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<boolean>(false);
  const hasLoadedRef = useRef(false);
  // 자동 생성 여부는 마운트 시점 props(서버 판정 pageCount)로 한 번만 정한다 — 이후 페이지가
  // 생겨도, 쿼리를 지운 뒤 서버 props 가 바뀌어도 다시 판정하지 않는다(덮어쓰기 금지).
  const [autogenStatus, setAutogenStatus] = useState<AutogenStatus>(() =>
    shouldAutoGenerate({
      requested: autogenRequested,
      pageCount: initialPageCount,
      photoCount,
      locked: normalizeLockMessage(lockMessage) !== null,
    })
      ? "running"
      : "idle",
  );
  /** StrictMode 이중 effect·재렌더에서도 자동 생성 요청을 한 번만 보낸다. */
  const autogenHandledRef = useRef(false);

  // 조회 본체 — 선행 상태 표시 없이 응답만 반영한다. state 반영은 promise 콜백에서만
  // 한다(effect 에서 호출되므로 — react-hooks/set-state-in-effect 는 await 경계를 보지 않는다).
  const fetchPages = useCallback(
    () =>
      requestPages(projectId)
        .then((data) => {
          setPages(data.pages);
          setPhotoUrls(data.photoUrls ?? {});
          setPageCount(data.pages.length);
          hasLoadedRef.current = true;
        })
        .catch((e: unknown) => {
          setLoadError(e instanceof Error ? e.message : "페이지 로드 실패");
        })
        .finally(() => {
          setLoading(false);
          setRefreshing(false);
        }),
    [projectId],
  );

  // 초기 로드 — loading=true·loadError=null 이 초기 state 라 선행 표시가 필요 없다.
  // (projectId 가 바뀌면 App Router 가 [projectId] 세그먼트 키로 이 컴포넌트를 새로
  //  마운트하므로 이 effect 는 사실상 마운트 1회다.)
  useEffect(() => {
    void fetchPages();
  }, [fetchPages]);

  // 재조회(insert/delete/재생성 후) — 이벤트 핸들러에서만 호출된다.
  const refresh = useCallback(() => {
    // 초기 로드에만 스켈레톤 — 이후 재조회는 stale-while-revalidate 로
    // 기존 페이지를 유지해 스크롤 위치가 튀지 않게 한다.
    if (hasLoadedRef.current) setRefreshing(true);
    else setLoading(true);
    setLoadError(null);
    return fetchPages();
  }, [fetchPages]);

  // 업로드 직후 자동 생성 — `?autogen=1` 처리는 마운트당 1회. 쿼리는 생성 여부와 무관하게 지워
  // 새로고침·뒤로가기로 다시 트리거되지 않게 한다. state 반영은 promise 콜백에서만 한다.
  useEffect(() => {
    if (!autogenRequested || autogenHandledRef.current) return;
    autogenHandledRef.current = true;
    router.replace(editorEntryHref(projectId), { scroll: false });
    if (autogenStatus !== "running") return;
    requestLayoutGenerate(projectId, AUTOGEN_DEFAULTS).then(
      (res) => {
        setLayoutMode(res.layoutMode);
        toast({
          description: `사진 ${photoCount}장으로 ${res.pageCount}페이지를 만들었어요.`,
          variant: "success",
        });
        return refresh().then(() => setAutogenStatus("done"));
      },
      (e: unknown) => {
        // 실패 — 0페이지 그대로라 생성 폼이 펼쳐진 채로 다시 나타나 수동 재시도할 수 있다.
        toast({
          description: `페이지를 자동으로 만들지 못했어요. ${
            e instanceof Error ? e.message : "자동 편집 실패"
          } — 아래에서 다시 시도해 주세요.`,
          variant: "destructive",
        });
        setAutogenStatus("failed");
      },
    );
  }, [autogenRequested, autogenStatus, photoCount, projectId, refresh, router]);

  const handleReorder = useCallback(
    async (pageIds: string[]) => {
      if (busy) return;
      setBusy(true);
      // 낙관적 — pages state 즉시 업데이트
      const prev = pages;
      const newOrder = pageIds
        .map((id, idx) => {
          const p = prev.find((x) => x.id === id);
          if (!p) return null;
          return { ...p, pageNo: idx + 1 };
        })
        .filter(Boolean) as PageSummary[];
      setPages(newOrder);
      try {
        const res = await fetch(`/api/pages/reorder`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ projectId, pageIds }),
        });
        const json = (await res.json()) as {
          ok: boolean;
          error?: { message: string };
        };
        if (!res.ok || !json.ok) {
          throw new Error(userMessageFromJson(json, "순서 변경에 실패했어요."));
        }
        toast({ description: "페이지 순서를 변경했어요.", variant: "success" });
      } catch (e) {
        // 롤백
        setPages(prev);
        throw e;
      } finally {
        setBusy(false);
      }
    },
    [busy, pages, projectId],
  );

  const handleInsert = useCallback(
    async (afterPageNo: number) => {
      if (busy) return;
      setBusy(true);
      try {
        const res = await fetch(`/api/pages/insert`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ projectId, afterPageNo, layoutMode }),
        });
        const json = (await res.json()) as {
          ok: boolean;
          data?: { pageId: string; pageNo: number; pageCount: number };
          error?: { message: string };
        };
        if (!res.ok || !json.ok || !json.data) {
          throw new Error(userMessageFromJson(json, "페이지 추가에 실패했어요."));
        }
        toast({
          description: `페이지를 추가했어요 (페이지 ${json.data.pageNo}).`,
          variant: "success",
        });
        await refresh();
      } catch (e) {
        toast({
          description:
            e instanceof Error ? e.message : "페이지 추가에 실패했어요.",
          variant: "destructive",
        });
      } finally {
        setBusy(false);
      }
    },
    [busy, layoutMode, projectId, refresh],
  );

  /** 잠긴 포토북의 드래그 순서 변경 — 서버에 보내지 않고 되돌린다(PreviewGrid 가 롤백·안내). */
  const rejectLockedReorder = useCallback(async () => {
    throw new Error(
      normalizeLockMessage(lockMessage) ?? "수정할 수 없는 포토북이에요.",
    );
  }, [lockMessage]);

  const handleDelete = useCallback(
    async (pageId: string) => {
      if (busy) return;
      setBusy(true);
      try {
        const res = await fetch(`/api/pages/${pageId}`, {
          method: "DELETE",
        });
        const json = (await res.json()) as {
          ok: boolean;
          error?: { message: string };
        };
        if (!res.ok || !json.ok) {
          throw new Error(userMessageFromJson(json, "삭제에 실패했어요."));
        }
        await refresh();
      } catch (e) {
        // toast 는 PreviewGrid 가 던질 때 처리하지만 여기서도 안전망.
        throw e;
      } finally {
        setBusy(false);
      }
    },
    [busy, refresh],
  );

  // 잠금 판정은 한 곳에서 — 배너·TopBar 비활성·생성/편집 차단이 같은 값을 본다.
  const lockNotice = normalizeLockMessage(lockMessage);
  const locked = lockNotice !== null;
  const autogenRunning = autogenStatus === "running";

  return (
    <div className="space-y-8">
      <ReadOnlyNotice message={lockNotice} />
      <TopBar
        projectId={projectId}
        initialTitle={initialTitle}
        photoCount={photoCount}
        pageCount={pageCount}
        lockMessage={lockNotice}
        hasCover={hasCover}
      />

      {autogenRunning ? (
        <section
          role="status"
          aria-live="polite"
          className="flex items-center gap-3 rounded-xl border bg-white/70 p-5 text-sm shadow-soft dark:bg-white/[0.03]"
        >
          <Loader2 className="size-5 shrink-0 animate-spin text-coral" aria-hidden />
          <span>
            <span className="block font-medium">사진으로 페이지를 만들고 있어요…</span>
            <span className="mt-0.5 block text-xs text-muted-foreground">
              촬영시각 순 · 폴라로이드로 만들어요. 만든 뒤 다시 구성할 수 있어요.
            </span>
          </span>
        </section>
      ) : (
        <GenerateControls
          projectId={projectId}
          photoCount={photoCount}
          currentPageCount={pageCount}
          initialLayoutMode={initialLayoutMode}
          onGenerated={(res) => {
            setLayoutMode(res.layoutMode);
            void refresh();
          }}
          disabled={locked}
        />
      )}

      <section aria-labelledby="preview-heading" className="space-y-3">
        <div className="flex items-baseline justify-between">
          <h2
            id="preview-heading"
            className="font-display text-xl font-semibold tracking-tight"
          >
            페이지 프리뷰
          </h2>
          <p className="text-xs text-muted-foreground" aria-live="polite">
            {autogenRunning
              ? "만드는 중…"
              : loading
                ? "불러오는 중…"
                : refreshing
                  ? "갱신 중…"
                  : `${pageCount}페이지 · ${layoutMode === "polaroid" ? "폴라로이드" : "콜라주"}`}
          </p>
        </div>
        {loadError ? (
          <p className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
            {loadError}
          </p>
        ) : null}
        <PreviewGrid
          projectId={projectId}
          pages={pages}
          photoUrls={photoUrls}
          // 자동 생성 중에는 빈 상태("위에서 자동 편집하기를…") 대신 스켈레톤.
          loading={loading || autogenRunning}
          bookSize={bookSize}
          onReorder={locked ? rejectLockedReorder : handleReorder}
          onInsert={locked ? undefined : handleInsert}
          onDelete={locked ? undefined : handleDelete}
          busy={busy}
        />
      </section>

      {/* 고급 — 인쇄용 PDF. 기본 접힘, 편집 흐름 맨 아래(P6). */}
      <PdfActions projectId={projectId} pageCount={pageCount} />
    </div>
  );
}

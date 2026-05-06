"use client";

import { Heart, Star } from "lucide-react";
import Image from "next/image";
import * as React from "react";

import { toast } from "@/components/ui/use-toast";

interface ReviewItem {
  id: string;
  rating: number;
  body: string | null;
  imageUrls: string[];
  likesCount: number;
  isLiked: boolean;
  authorName: string;
  authorId: string;
  createdAt: string;
  isMine: boolean;
}

interface GalleryClientProps {
  initialItems: ReviewItem[];
  initialNextCursor: string | null;
}

type SortMode = "recent" | "popular";

export default function GalleryClient({
  initialItems,
  initialNextCursor,
}: GalleryClientProps) {
  const [sort, setSort] = React.useState<SortMode>("recent");
  const [items, setItems] = React.useState<ReviewItem[]>(initialItems);
  const [nextCursor, setNextCursor] = React.useState<string | null>(initialNextCursor);
  const [loading, setLoading] = React.useState(false);
  const [fetchError, setFetchError] = React.useState<string | null>(null);
  // 낙관적 업데이트를 위한 로컬 좋아요 상태 오버라이드
  const [likeOverrides, setLikeOverrides] = React.useState<
    Map<string, { isLiked: boolean; likesCount: number }>
  >(new Map());
  const [likePending, setLikePending] = React.useState<Set<string>>(new Set());

  // 정렬 변경 시 처음부터 다시 로드
  React.useEffect(() => {
    let mounted = true;
    setFetchError(null);
    setLoading(true);
    setItems([]);
    setNextCursor(null);
    setLikeOverrides(new Map());

    void fetchPage(sort, null).then((result) => {
      if (!mounted) return;
      if (result.error) {
        setFetchError(result.error);
      } else {
        setItems(result.items);
        setNextCursor(result.nextCursor);
      }
      setLoading(false);
    });

    return () => {
      mounted = false;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sort]);

  // 무한 스크롤 — sentinel
  const sentinelRef = React.useRef<HTMLDivElement | null>(null);
  const loadMoreRef = React.useRef<(() => void) | null>(null);

  // 다음 페이지 로드 함수 — ref 에 저장해서 IntersectionObserver 에서 최신 상태 참조
  loadMoreRef.current = async function loadMore() {
    if (loading || !nextCursor) return;
    setLoading(true);
    const result = await fetchPage(sort, nextCursor);
    if (result.error) {
      setFetchError(result.error);
    } else {
      setItems((prev) => [...prev, ...result.items]);
      setNextCursor(result.nextCursor);
    }
    setLoading(false);
  };

  React.useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;

    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          loadMoreRef.current?.();
        }
      },
      { threshold: 0.1 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  async function toggleLike(reviewId: string) {
    if (likePending.has(reviewId)) return;

    // 현재 상태 읽기 (오버라이드 > 서버)
    const current = likeOverrides.get(reviewId);
    const serverItem = items.find((i) => i.id === reviewId);
    const wasLiked = current ? current.isLiked : (serverItem?.isLiked ?? false);
    const prevCount = current ? current.likesCount : (serverItem?.likesCount ?? 0);

    // 낙관적 업데이트
    setLikeOverrides((prev) => {
      const next = new Map(prev);
      next.set(reviewId, {
        isLiked: !wasLiked,
        likesCount: wasLiked ? Math.max(0, prevCount - 1) : prevCount + 1,
      });
      return next;
    });
    setLikePending((prev) => new Set(prev).add(reviewId));

    try {
      const res = await fetch(`/api/reviews/${reviewId}/like`, { method: "POST" });
      const json = (await res.json()) as {
        ok: boolean;
        data?: { liked: boolean; likesCount: number };
        error?: { message: string };
      };

      if (!res.ok || !json.ok) {
        // 롤백
        setLikeOverrides((prev) => {
          const next = new Map(prev);
          next.set(reviewId, { isLiked: wasLiked, likesCount: prevCount });
          return next;
        });
        if (res.status === 401) {
          toast({ variant: "warning", title: "로그인이 필요해요.", description: "로그인 후 좋아요를 누를 수 있어요." });
        }
        return;
      }

      // 서버 응답으로 확정
      if (json.data) {
        setLikeOverrides((prev) => {
          const next = new Map(prev);
          next.set(reviewId, {
            isLiked: json.data!.liked,
            likesCount: json.data!.likesCount,
          });
          return next;
        });
      }
    } catch {
      // 롤백
      setLikeOverrides((prev) => {
        const next = new Map(prev);
        next.set(reviewId, { isLiked: wasLiked, likesCount: prevCount });
        return next;
      });
    } finally {
      setLikePending((prev) => {
        const next = new Set(prev);
        next.delete(reviewId);
        return next;
      });
    }
  }

  return (
    <div>
      {/* 정렬 탭 */}
      <div
        className="flex gap-1 rounded-xl border bg-muted/40 p-1"
        role="tablist"
        aria-label="정렬 기준"
      >
        {(["recent", "popular"] as const).map((s) => (
          <button
            key={s}
            role="tab"
            aria-selected={sort === s}
            onClick={() => setSort(s)}
            className={
              "flex-1 rounded-lg px-4 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring " +
              (sort === s
                ? "bg-background text-foreground shadow-soft"
                : "text-muted-foreground hover:text-foreground")
            }
          >
            {s === "recent" ? "최신순" : "인기순"}
          </button>
        ))}
      </div>

      {/* 에러 */}
      {fetchError ? (
        <div
          role="alert"
          className="mt-6 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive"
        >
          후기를 불러오지 못했습니다: {fetchError}
        </div>
      ) : null}

      {/* 그리드 */}
      {items.length === 0 && !loading ? (
        <div className="mt-12 rounded-2xl border bg-card p-8 text-center">
          <p className="text-sm text-muted-foreground">아직 등록된 후기가 없습니다.</p>
        </div>
      ) : (
        <div className="mt-6 grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
          {items.map((item) => {
            const override = likeOverrides.get(item.id);
            const isLiked = override ? override.isLiked : item.isLiked;
            const likesCount = override ? override.likesCount : item.likesCount;
            const isPending = likePending.has(item.id);

            return (
              <ReviewCard
                key={item.id}
                item={item}
                isLiked={isLiked}
                likesCount={likesCount}
                isPending={isPending}
                onLike={() => void toggleLike(item.id)}
              />
            );
          })}

          {/* 스켈레톤 — 로딩 중 */}
          {loading
            ? Array.from({ length: 4 }).map((_, i) => (
                <ReviewSkeleton key={`sk-${i}`} />
              ))
            : null}
        </div>
      )}

      {/* 무한 스크롤 sentinel */}
      <div ref={sentinelRef} className="h-4" aria-hidden />

      {/* 더 이상 없을 때 */}
      {!loading && !nextCursor && items.length > 0 ? (
        <p className="mt-8 text-center text-xs text-muted-foreground">
          모든 후기를 불러왔습니다.
        </p>
      ) : null}
    </div>
  );
}

// ─── 카드 ──────────────────────────────────────────────────────────────────

function ReviewCard(props: {
  item: ReviewItem;
  isLiked: boolean;
  likesCount: number;
  isPending: boolean;
  onLike: () => void;
}) {
  const { item, isLiked, likesCount, isPending, onLike } = props;
  const coverUrl = item.imageUrls[0] ?? null;

  return (
    <article className="group overflow-hidden rounded-2xl border bg-card shadow-[0_1px_3px_rgba(0,0,0,0.04)] transition-shadow hover:shadow-[0_4px_12px_rgba(0,0,0,0.08)]">
      {/* 대표 이미지 */}
      <div className="relative aspect-square w-full overflow-hidden bg-muted">
        {coverUrl ? (
          <Image
            src={coverUrl}
            alt={`${item.authorName}님의 포토북 후기 이미지`}
            fill
            sizes="(max-width: 768px) 50vw, (max-width: 1024px) 33vw, 25vw"
            className="object-cover transition-transform duration-300 group-hover:scale-105"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <Star className="h-8 w-8 text-muted-foreground/30" aria-hidden />
          </div>
        )}
      </div>

      {/* 내용 */}
      <div className="p-3">
        {/* 별점 */}
        <div className="flex items-center gap-0.5" aria-label={`별점 ${item.rating}점`}>
          {[1, 2, 3, 4, 5].map((n) => (
            <Star
              key={n}
              className={
                "h-3.5 w-3.5 " +
                (n <= item.rating
                  ? "fill-amber-400 text-amber-400"
                  : "text-muted-foreground/30")
              }
              aria-hidden
            />
          ))}
        </div>

        {/* 후기 텍스트 */}
        {item.body ? (
          <p className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
            {item.body}
          </p>
        ) : null}

        {/* 작성자 + 좋아요 */}
        <div className="mt-2 flex items-center justify-between gap-2">
          <span className="truncate text-xs text-muted-foreground/70">
            {item.authorName}
          </span>
          <button
            type="button"
            onClick={onLike}
            disabled={isPending}
            aria-label={isLiked ? `좋아요 취소 (${likesCount})` : `좋아요 (${likesCount})`}
            aria-pressed={isLiked}
            className="flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
          >
            <Heart
              className={
                "h-3.5 w-3.5 transition-colors " +
                (isLiked ? "fill-rose-500 text-rose-500" : "")
              }
              aria-hidden
            />
            {likesCount}
          </button>
        </div>
      </div>
    </article>
  );
}

// ─── 스켈레톤 ──────────────────────────────────────────────────────────────

function ReviewSkeleton() {
  return (
    <div className="overflow-hidden rounded-2xl border bg-card" aria-hidden>
      <div className="aspect-square w-full animate-pulse bg-muted" />
      <div className="p-3 space-y-2">
        <div className="h-3 w-24 animate-pulse rounded bg-muted" />
        <div className="h-3 w-full animate-pulse rounded bg-muted" />
        <div className="h-3 w-3/4 animate-pulse rounded bg-muted" />
      </div>
    </div>
  );
}

// ─── API 헬퍼 ──────────────────────────────────────────────────────────────

async function fetchPage(
  sort: SortMode,
  cursor: string | null,
): Promise<{ items: ReviewItem[]; nextCursor: string | null; error: string | null }> {
  try {
    const params = new URLSearchParams({ sort, limit: "12" });
    if (cursor) params.set("cursor", cursor);

    const res = await fetch(`/api/reviews?${params.toString()}`, {
      cache: "no-store",
    });
    const json = (await res.json()) as {
      ok: boolean;
      data?: { items: ReviewItem[]; nextCursor: string | null };
      error?: { message: string };
    };

    if (!res.ok || !json.ok) {
      return {
        items: [],
        nextCursor: null,
        error: json.error?.message ?? "후기를 불러오지 못했습니다.",
      };
    }

    return {
      items: json.data?.items ?? [],
      nextCursor: json.data?.nextCursor ?? null,
      error: null,
    };
  } catch {
    return { items: [], nextCursor: null, error: "네트워크 오류가 발생했습니다." };
  }
}

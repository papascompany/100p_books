import { BookOpen, Calendar, Clock, ImageOff, Images } from "lucide-react";
import Image from "next/image";
import Link from "next/link";

import { Button } from "@/components/ui/button";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface PageProps {
  params: { token: string };
}

interface SharePhoto {
  id: string;
  filename: string | null;
  thumbUrl: string | null;
  width: number | null;
  height: number | null;
  exifTakenAt: string | null;
  orderIdx: number;
}

interface SharePage {
  id: string;
  pageNo: number;
  layoutMode: string;
  fabricJson: Record<string, unknown> | null;
}

interface ShareProject {
  id: string;
  title: string;
  layoutMode: string;
  bookSizeId: string;
  createdAt: string;
  updatedAt: string;
}

interface ShareData {
  project: ShareProject;
  pages: SharePage[];
  coverJson: Record<string, unknown> | null;
  photos: SharePhoto[];
  expiresAt: string | null;
  viewCount: number;
}

/**
 * /share/[token] — 비로그인 공개 조회 페이지.
 * 서버 컴포넌트에서 API fetch 후 정적 렌더.
 */
async function fetchShareData(
  token: string,
): Promise<{ data: ShareData | null; errorCode: string | null; errorMessage: string | null }> {
  try {
    const baseUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
    const res = await fetch(`${baseUrl}/api/share/${token}`, {
      cache: "no-store",
    });
    const json = (await res.json()) as {
      ok: boolean;
      data?: ShareData;
      error?: { code?: string; message?: string };
    };
    if (!res.ok || !json.ok || !json.data) {
      return {
        data: null,
        errorCode: json.error?.code ?? "UNKNOWN",
        errorMessage: json.error?.message ?? "알 수 없는 오류가 발생했어요.",
      };
    }
    return { data: json.data, errorCode: null, errorMessage: null };
  } catch {
    return { data: null, errorCode: "FETCH_FAILED", errorMessage: "데이터를 불러오지 못했어요." };
  }
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("ko-KR", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

/** 만료/없는 토큰 — 404-like UI */
function ErrorPage({
  code,
  message,
}: {
  code: string | null;
  message: string | null;
}) {
  const isExpired = code === "TOKEN_EXPIRED";

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-4 text-center">
      <div className="mb-6 flex size-20 items-center justify-center rounded-full bg-rose-50 dark:bg-rose-950/30">
        <BookOpen className="size-9 text-rose-400" aria-hidden />
      </div>
      <h1 className="font-display text-2xl font-semibold tracking-tight sm:text-3xl">
        {isExpired ? "링크가 만료됐어요" : "포토북을 찾을 수 없어요"}
      </h1>
      <p className="mt-3 max-w-sm text-sm text-muted-foreground sm:text-base">
        {isExpired
          ? "이 공유 링크는 유효기간이 지났어요. 책을 공유한 분께 새 링크를 요청해 보세요."
          : (message ?? "이 주소는 유효하지 않거나 삭제된 공유 링크입니다.")}
      </p>
      <Button asChild variant="gradient" size="lg" className="mt-8 h-12 px-7">
        <Link href="/">나만의 포토북 만들기</Link>
      </Button>
    </div>
  );
}

/** 사진 없는 셀 placeholder */
function EmptyPhotoCell() {
  return (
    <div className="flex aspect-square items-center justify-center rounded-lg bg-muted">
      <ImageOff className="size-6 text-muted-foreground/40" aria-hidden />
    </div>
  );
}

export default async function SharePage({ params }: PageProps) {
  const { data, errorCode, errorMessage } = await fetchShareData(params.token);

  if (!data) {
    return (
      <div className="container py-16 md:py-24">
        <ErrorPage code={errorCode} message={errorMessage} />
      </div>
    );
  }

  const { project, pages, photos, expiresAt, viewCount } = data;

  // 각 페이지에서 사용하는 사진 매핑 (fabric_json.objects 에서 photoId 추출)
  // Fabric JSON 렌더는 하지 않으므로, 페이지당 첫 번째 사진만 대표 썸네일로 사용
  const photoById = new Map<string, SharePhoto>(photos.map((p) => [p.id, p]));

  function getPagePhotos(page: SharePage): SharePhoto[] {
    if (!page.fabricJson) return [];
    const objects = page.fabricJson.objects;
    if (!Array.isArray(objects)) return [];
    const ids: string[] = [];
    for (const obj of objects as Record<string, unknown>[]) {
      const photoId = obj.photoId ?? (obj.customData as Record<string, unknown> | null)?.photoId;
      if (typeof photoId === "string" && photoById.has(photoId)) {
        ids.push(photoId);
      }
    }
    // 중복 제거 유지 순서
    return [...new Set(ids)].map((id) => photoById.get(id)!).filter(Boolean);
  }

  const createdDate = formatDate(project.createdAt);
  const expiresDate = expiresAt ? formatDate(expiresAt) : null;

  return (
    <>
      {/* 상단 배너 */}
      <div className="border-b bg-amber-50/80 dark:bg-amber-950/20">
        <div className="container flex items-center justify-center gap-2 py-2.5 text-center text-xs text-amber-700 dark:text-amber-400 sm:text-sm">
          <BookOpen className="size-3.5 shrink-0" aria-hidden />
          <span>공유된 포토북입니다 · 조회 전용</span>
          {expiresDate ? (
            <>
              <span aria-hidden className="opacity-50">
                ·
              </span>
              <span className="flex items-center gap-1">
                <Clock className="size-3 shrink-0" aria-hidden />
                {expiresDate} 만료
              </span>
            </>
          ) : null}
        </div>
      </div>

      {/* 브랜드 헤더 */}
      <header className="border-b">
        <div className="container flex h-14 items-center">
          <Link
            href="/"
            className="font-display text-xl font-semibold tracking-tight"
            aria-label="100p Books 홈"
          >
            100p <span className="text-rose-500">Books</span>
          </Link>
        </div>
      </header>

      <main className="container max-w-4xl py-10 md:py-14">
        {/* 표지 카드 */}
        <section aria-labelledby="cover-heading" className="mb-10">
          <div className="overflow-hidden rounded-2xl border bg-gradient-to-br from-rose-50 via-amber-50 to-white shadow-soft dark:from-rose-950/20 dark:via-amber-950/10 dark:to-card">
            <div className="flex flex-col gap-4 p-6 sm:flex-row sm:items-center sm:gap-8 sm:p-8">
              {/* 아이콘 */}
              <div className="flex size-16 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-rose-500 to-amber-400 shadow-soft-lg sm:size-20">
                <BookOpen className="size-8 text-white sm:size-10" aria-hidden />
              </div>

              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium uppercase tracking-[0.18em] text-rose-500/90">
                  포토북
                </p>
                <h1
                  id="cover-heading"
                  className="mt-1 font-display text-2xl font-semibold leading-tight tracking-tight sm:text-3xl"
                >
                  {project.title}
                </h1>
                <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <Calendar className="size-3.5" aria-hidden />
                    {createdDate} 제작
                  </span>
                  <span className="flex items-center gap-1">
                    <Images className="size-3.5" aria-hidden />
                    {pages.length}페이지
                  </span>
                  <span>{photos.length}장의 사진</span>
                  {viewCount > 1 ? (
                    <span>조회 {viewCount.toLocaleString()}회</span>
                  ) : null}
                </div>
              </div>

              <Button asChild variant="gradient" size="sm" className="shrink-0">
                <Link href="/upload">이 책 만들기</Link>
              </Button>
            </div>
          </div>
        </section>

        {/* 내지 그리드 */}
        <section aria-labelledby="pages-heading">
          <div className="mb-5 flex items-baseline justify-between">
            <h2
              id="pages-heading"
              className="font-display text-xl font-semibold tracking-tight"
            >
              내지 미리보기
            </h2>
            <p className="text-sm text-muted-foreground">{pages.length}페이지</p>
          </div>

          {pages.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-xl border border-dashed py-16 text-center">
              <ImageOff className="mb-3 size-10 text-muted-foreground/40" aria-hidden />
              <p className="text-sm text-muted-foreground">아직 내지가 없어요.</p>
            </div>
          ) : (
            <div
              className="grid grid-cols-2 gap-3 sm:grid-cols-3"
              role="list"
              aria-label="포토북 내지 목록"
            >
              {pages.map((page) => {
                const pagePhotos = getPagePhotos(page);
                const firstPhoto = pagePhotos[0] ?? null;

                return (
                  <article
                    key={page.id}
                    role="listitem"
                    className="group relative overflow-hidden rounded-lg border bg-muted shadow-soft"
                    aria-label={`${page.pageNo}페이지`}
                  >
                    {firstPhoto?.thumbUrl ? (
                      <div className="aspect-square overflow-hidden">
                        <Image
                          src={firstPhoto.thumbUrl}
                          alt={firstPhoto.filename ?? `${page.pageNo}페이지 사진`}
                          width={400}
                          height={400}
                          className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                          sizes="(max-width: 640px) 50vw, 33vw"
                          unoptimized
                        />
                      </div>
                    ) : (
                      <EmptyPhotoCell />
                    )}

                    {/* 페이지 번호 배지 */}
                    <div className="absolute bottom-2 left-2 rounded-md bg-black/50 px-1.5 py-0.5 text-[11px] font-medium text-white backdrop-blur-sm">
                      {page.pageNo}p
                    </div>

                    {/* 콜라주 페이지면 추가 사진 힌트 */}
                    {pagePhotos.length > 1 && (
                      <div className="absolute bottom-2 right-2 rounded-md bg-black/50 px-1.5 py-0.5 text-[11px] font-medium text-white backdrop-blur-sm">
                        +{pagePhotos.length - 1}
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </section>

        {/* 하단 CTA */}
        <section className="mt-14">
          <div className="overflow-hidden rounded-2xl border bg-gradient-to-br from-rose-50 via-amber-50 to-white p-8 shadow-soft dark:from-rose-950/30 dark:via-amber-950/20 dark:to-background">
            <div className="flex flex-col items-start gap-5 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h3 className="font-display text-xl font-semibold tracking-tight sm:text-2xl">
                  나만의 포토북을 만들어 보세요.
                </h3>
                <p className="mt-1.5 text-sm text-muted-foreground">
                  100장의 사진을 업로드하면 3분 안에 첫 페이지가 완성됩니다.
                </p>
              </div>
              <Button asChild variant="gradient" size="lg" className="h-11 shrink-0 px-6">
                <Link href="/upload">지금 시작하기</Link>
              </Button>
            </div>
          </div>
        </section>
      </main>
    </>
  );
}

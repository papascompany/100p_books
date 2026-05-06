import "server-only";

import { BookOpen, Clock, Gift, PackageOpen } from "lucide-react";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { GiftClaimButton } from "./GiftClaimButton";
import { Button } from "@/components/ui/button";
import { createAdminSupabase } from "@/lib/db/admin";
import { createServerSupabase } from "@/lib/db/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface PageProps {
  params: { token: string };
}

// ─── 메타데이터 ───────────────────────────────────────────────────────────

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  return {
    title: "선물 도착",
    description: "누군가 당신에게 포토북을 선물했습니다.",
    openGraph: {
      title: "포토북 선물이 도착했습니다",
      description: "100p Books에서 소중한 사람이 보낸 포토북 선물을 받아보세요.",
      url: `/gift/${params.token}`,
    },
  };
}

// ─── 데이터 로드 헬퍼 ─────────────────────────────────────────────────────

interface GiftData {
  id: string;
  status: "pending" | "claimed" | "expired";
  expiresAt: string;
  recipientEmail: string;
  message: string | null;
  senderName: string;
  claimedProjectId: string | null;
  project: {
    id: string;
    title: string;
    bookSizeName: string;
    pageCount: number;
    coverThumbUrl: string | null;
  };
}

type LoadResult =
  | { kind: "ok"; data: GiftData }
  | { kind: "not_found" }
  | { kind: "error"; message: string };

/** 이메일 prefix 헬퍼 */
function emailPrefix(email: string): string {
  const i = email.indexOf("@");
  return i > 0 ? email.slice(0, i) : email;
}

async function loadGift(token: string): Promise<LoadResult> {
  // UUID 형식 검증
  const UUID_RE =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!UUID_RE.test(token)) {
    return { kind: "not_found" };
  }

  const admin = createAdminSupabase();

  const { data: gift, error: giftErr } = await admin
    .from("gifts")
    .select(
      `
      id,
      order_id,
      sender_id,
      recipient_email,
      message,
      gift_token,
      status,
      claimed_project_id,
      expires_at,
      orders!inner (
        project_id,
        projects!inner (
          id,
          title,
          cover_json,
          book_size_id,
          book_sizes ( name )
        )
      )
      `,
    )
    .eq("gift_token", token)
    .maybeSingle();

  if (giftErr) {
    return { kind: "error", message: giftErr.message };
  }
  if (!gift) {
    return { kind: "not_found" };
  }

  // 실시간 만료 처리
  let currentStatus = gift.status as "pending" | "claimed" | "expired";
  if (
    currentStatus === "pending" &&
    new Date(gift.expires_at).getTime() < Date.now()
  ) {
    currentStatus = "expired";
    await admin
      .from("gifts")
      .update({ status: "expired" })
      .eq("id", gift.id)
      .eq("status", "pending");
  }

  // 발신자 표시명
  const { data: senderProfile } = await admin
    .from("profiles")
    .select("display_name, email")
    .eq("id", gift.sender_id)
    .maybeSingle();

  const senderName =
    senderProfile?.display_name ||
    (senderProfile?.email ? emailPrefix(senderProfile.email) : "보낸이");

  // orders/projects 중첩 타입 언래핑
  const order = (gift.orders as unknown) as {
    project_id: string;
    projects: {
      id: string;
      title: string;
      cover_json: Record<string, unknown> | null;
      book_size_id: string;
      book_sizes: { name: string } | null;
    };
  };
  const project = order.projects;

  // 페이지 수
  const { count: pageCount } = await admin
    .from("pages")
    .select("id", { count: "exact", head: true })
    .eq("project_id", project.id);

  // 표지 썸네일 URL (cover_json 에서 배경 이미지 key 추출 시도)
  let coverThumbUrl: string | null = null;
  const coverJson = project.cover_json;
  if (coverJson && typeof coverJson === "object" && !Array.isArray(coverJson)) {
    // Fabric JSON 오브젝트 배열에서 첫 번째 이미지 src 추출 (best-effort)
    const objs = coverJson.objects;
    if (Array.isArray(objs)) {
      for (const obj of objs) {
        if (
          obj &&
          typeof obj === "object" &&
          "type" in obj &&
          (obj.type === "image" || obj.type === "Image") &&
          "src" in obj &&
          typeof obj.src === "string" &&
          obj.src.startsWith("http")
        ) {
          coverThumbUrl = obj.src;
          break;
        }
      }
    }
  }

  return {
    kind: "ok",
    data: {
      id: gift.id,
      status: currentStatus,
      expiresAt: gift.expires_at,
      recipientEmail: gift.recipient_email,
      message: gift.message,
      senderName,
      claimedProjectId: gift.claimed_project_id,
      project: {
        id: project.id,
        title: project.title,
        bookSizeName: project.book_sizes?.name ?? "",
        pageCount: pageCount ?? 0,
        coverThumbUrl,
      },
    },
  };
}

// ─── 페이지 컴포넌트 ──────────────────────────────────────────────────────

const DT = new Intl.DateTimeFormat("ko-KR", {
  year: "numeric",
  month: "long",
  day: "numeric",
});

export default async function GiftTokenPage({ params }: PageProps) {
  const result = await loadGift(params.token);

  // ── 에러 / 없음 ──────────────────────────────────────────────────────────
  if (result.kind === "not_found" || result.kind === "error") {
    return (
      <div className="container flex min-h-[60vh] flex-col items-center justify-center py-16 text-center">
        <span className="flex h-16 w-16 items-center justify-center rounded-full bg-muted mb-4">
          <PackageOpen
            className="h-8 w-8 text-muted-foreground"
            aria-hidden="true"
          />
        </span>
        <h1 className="font-display text-2xl font-semibold">
          유효하지 않은 선물 링크입니다
        </h1>
        <p className="mt-2 text-sm text-muted-foreground max-w-sm">
          링크가 올바른지 확인해주세요. 이미 만료되었거나 존재하지 않는
          선물일 수 있습니다.
        </p>
        <Button asChild variant="outline" className="mt-6">
          <Link href="/">홈으로</Link>
        </Button>
      </div>
    );
  }

  const gift = result.data;

  // ── 만료 ─────────────────────────────────────────────────────────────────
  if (gift.status === "expired") {
    return (
      <div className="container flex min-h-[60vh] flex-col items-center justify-center py-16 text-center">
        <span className="flex h-16 w-16 items-center justify-center rounded-full bg-zinc-100 dark:bg-zinc-800 mb-4">
          <Clock
            className="h-8 w-8 text-zinc-400"
            aria-hidden="true"
          />
        </span>
        <h1 className="font-display text-2xl font-semibold text-zinc-600 dark:text-zinc-300">
          선물 링크가 만료되었습니다
        </h1>
        <p className="mt-2 text-sm text-muted-foreground max-w-sm">
          이 선물 링크는 유효 기간이 지났습니다. 보낸 분께 문의해주세요.
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          만료일: {DT.format(new Date(gift.expiresAt))}
        </p>
        <Button asChild variant="outline" className="mt-6">
          <Link href="/">홈으로</Link>
        </Button>
      </div>
    );
  }

  // ── 로그인 여부 확인 ──────────────────────────────────────────────────────
  // getSession 은 server-only (lib/auth/session.ts) — createServerSupabase 사용
  let isLoggedIn = false;
  try {
    const supabase = createServerSupabase();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    isLoggedIn = !!session;
  } catch {
    isLoggedIn = false;
  }

  const loginUrl = `/login?next=${encodeURIComponent(`/gift/${params.token}`)}`;

  // ── 유효한 선물 (pending | claimed) ──────────────────────────────────────
  return (
    <div className="container py-10 md:py-16">
      <div className="mx-auto max-w-lg">
        {/* 선물 헤더 */}
        <div className="mb-8 text-center">
          <span
            className="inline-flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-rose-100 to-amber-100 dark:from-rose-900/30 dark:to-amber-900/30 mb-4"
            aria-hidden="true"
          >
            <Gift className="h-8 w-8 text-rose-500" />
          </span>
          <h1 className="font-display text-2xl font-semibold md:text-3xl">
            포토북 선물이 도착했어요
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            <strong className="text-foreground">{gift.senderName}</strong>
            님이 보낸 선물입니다
          </p>
        </div>

        {/* 선물 카드 */}
        <div className="rounded-2xl border bg-card shadow-[0_1px_3px_rgba(0,0,0,0.04)] overflow-hidden">
          {/* 표지 영역 */}
          <div className="relative h-48 bg-gradient-to-br from-rose-50 via-orange-50 to-amber-50 dark:from-rose-950/20 dark:via-orange-950/20 dark:to-amber-950/20 flex items-center justify-center">
            {gift.project.coverThumbUrl ? (
              <Image
                src={gift.project.coverThumbUrl}
                alt={`${gift.project.title} 표지 미리보기`}
                fill
                className="object-cover"
                sizes="(max-width: 640px) 100vw, 512px"
              />
            ) : (
              <div className="flex flex-col items-center gap-2 text-rose-300 dark:text-rose-700">
                <BookOpen className="h-16 w-16" aria-hidden="true" />
                <span className="text-xs font-medium">
                  {gift.project.title || "포토북"}
                </span>
              </div>
            )}
          </div>

          {/* 내용 */}
          <div className="p-5 space-y-4">
            {/* 책 정보 */}
            <div>
              <h2 className="font-semibold text-lg leading-tight">
                {gift.project.title || "무제"}
              </h2>
              <p className="mt-0.5 text-sm text-muted-foreground">
                {gift.project.bookSizeName
                  ? `${gift.project.bookSizeName} · `
                  : ""}
                {gift.project.pageCount}페이지
              </p>
            </div>

            {/* 발신자 메시지 */}
            {gift.message && (
              <blockquote className="rounded-xl bg-rose-50 dark:bg-rose-950/30 border border-rose-100 dark:border-rose-900/40 px-4 py-3">
                <p className="text-sm text-rose-900 dark:text-rose-100 leading-relaxed whitespace-pre-line">
                  &ldquo;{gift.message}&rdquo;
                </p>
                <footer className="mt-1.5 text-xs text-rose-500 dark:text-rose-400">
                  — {gift.senderName}
                </footer>
              </blockquote>
            )}

            {/* 유효 기간 */}
            {gift.status === "pending" && (
              <p className="text-xs text-muted-foreground">
                유효 기간: {DT.format(new Date(gift.expiresAt))}까지
              </p>
            )}

            {/* CTA */}
            <div className="pt-1">
              {gift.status === "claimed" ? (
                /* 이미 수령 */
                <div className="space-y-3">
                  <div className="rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900/50 px-4 py-3 text-center">
                    <p className="text-sm font-medium text-emerald-800 dark:text-emerald-200">
                      이미 수령한 선물입니다
                    </p>
                  </div>
                  {isLoggedIn && gift.claimedProjectId ? (
                    <GiftClaimButton
                      token={params.token}
                      claimedProjectId={gift.claimedProjectId}
                    />
                  ) : null}
                </div>
              ) : isLoggedIn ? (
                /* 로그인 상태 — claim 가능 */
                <GiftClaimButton token={params.token} />
              ) : (
                /* 비로그인 — 로그인 게이트 */
                <div className="space-y-3">
                  <p className="text-sm text-muted-foreground text-center">
                    선물을 받으려면 로그인이 필요합니다
                  </p>
                  <Button asChild variant="gradient" size="lg" className="w-full gap-2">
                    <Link href={loginUrl}>
                      <BookOpen className="h-4 w-4" aria-hidden="true" />
                      로그인하고 받기
                    </Link>
                  </Button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* 브랜드 안내 */}
        <p className="mt-6 text-center text-xs text-muted-foreground">
          이 선물은{" "}
          <Link href="/" className="underline underline-offset-2 hover:text-foreground transition-colors">
            100p Books
          </Link>
          를 통해 발송되었습니다
        </p>
      </div>
    </div>
  );
}

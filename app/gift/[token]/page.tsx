import "server-only";

import { BookOpen, Clock, Gift, PackageOpen } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { CopyGiftLinkButton } from "./CopyGiftLinkButton";
import { GiftClaimButton } from "./GiftClaimButton";
import PagePreview from "@/app/(user)/editor/[projectId]/PagePreview";
import { giftSenderOwnsOrder } from "@/app/api/gifts/[token]/sender-guard";
import { Button } from "@/components/ui/button";
import { createAdminSupabase } from "@/lib/db/admin";
import { createServerSupabase } from "@/lib/db/server";
import { THUMBS_BUCKET } from "@/lib/image/constants";
import { isPageDoc, type PageDoc, type PhotoObject } from "@/lib/layout/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface PageProps {
  params: Promise<{ token: string }>;
}

// ─── 메타데이터 ───────────────────────────────────────────────────────────

export async function generateMetadata(props: PageProps): Promise<Metadata> {
  const params = await props.params;
  return {
    title: "포토북 사본 도착",
    description: "누군가 직접 만든 포토북의 사본을 보냈어요.",
    openGraph: {
      title: "포토북 사본이 도착했어요",
      description:
        "100p Books에서 받은 포토북 사본을 내 계정으로 받아 편집하고 주문해 보세요.",
      url: `/gift/${params.token}`,
    },
  };
}

// ─── 데이터 로드 헬퍼 ─────────────────────────────────────────────────────

/**
 * 표지 미리보기 — cover_json(PageDoc 펼침면: 뒤표지 | 책등 | 앞표지)과 사진 thumb signed URL.
 * 앞표지는 펼침면의 오른쪽 `cover_width_mm / 2` 구간이다(lib/layout/cover.ts 좌표 규약).
 */
interface CoverPreview {
  doc: PageDoc;
  photoUrls: Record<string, string>;
  frontLeftMm: number;
  frontWidthMm: number;
}

interface GiftData {
  id: string;
  orderId: string;
  senderId: string;
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
    cover: CoverPreview | null;
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

/** 표지 미리보기 thumb signed URL TTL — 주문서 "인쇄 전 확인"·내지 그리드와 같은 1시간. */
const COVER_THUMB_SIGNED_TTL_SEC = 3600;

/**
 * cover_json(PageDoc) → 표지 미리보기.
 *
 *   - 호출자는 토큰 검증·발신자=주문자=소유자 확인·pending 상태를 모두 통과한 경우에만 부른다.
 *   - 읽기 전용: photos 조회와 signed URL 발급만 한다(DB 쓰기 없음).
 *   - photos 는 이 프로젝트 소속·미삭제 행으로 한정 — cover_json 에 다른 프로젝트 photoId 가 있어도 서명하지 않는다.
 *   - 실패·형식 불일치·사진이 있는데 하나도 서명하지 못한 경우 null → 호출부가 placeholder 를 쓴다.
 */
async function loadCoverPreview(
  admin: ReturnType<typeof createAdminSupabase>,
  projectId: string,
  stored: unknown,
  coverWidthMm: number | null,
): Promise<CoverPreview | null> {
  if (!isPageDoc(stored) || stored.layoutMode !== "cover") return null;
  const doc = stored;
  if (!(doc.widthMm > 0) || !(doc.heightMm > 0)) return null;

  const photoIds = [
    ...new Set(
      doc.objects
        .filter((o): o is PhotoObject => o.type === "photo")
        .map((o) => o.photoId),
    ),
  ];
  const photoUrls: Record<string, string> = {};
  if (photoIds.length > 0) {
    try {
      const { data: photos } = await admin
        .from("photos")
        .select("id, thumb_key")
        .eq("project_id", projectId)
        .is("deleted_at", null)
        .in("id", photoIds);
      const idByKey = new Map<string, string>();
      const paths: string[] = [];
      for (const p of photos ?? []) {
        if (p.thumb_key) {
          idByKey.set(p.thumb_key, p.id);
          paths.push(p.thumb_key);
        }
      }
      if (paths.length > 0) {
        // storage 접근은 반드시 `admin.storage` 형태(0032 가드 테스트가 변수명으로 service_role 여부를 검사).
        const { data: signed } = await admin.storage
          .from(THUMBS_BUCKET)
          .createSignedUrls(paths, COVER_THUMB_SIGNED_TTL_SEC);
        for (const item of signed ?? []) {
          if (item.path && item.signedUrl) {
            const pid = idByKey.get(item.path);
            if (pid) photoUrls[pid] = item.signedUrl;
          }
        }
      }
    } catch {
      // 미리보기 전용 — 실패는 placeholder 로 흡수.
    }
    if (Object.keys(photoUrls).length === 0) return null;
  }

  const half =
    coverWidthMm && coverWidthMm > 0 ? coverWidthMm / 2 : doc.widthMm / 2;
  const frontWidthMm = Math.min(half, doc.widthMm);
  return {
    doc,
    photoUrls,
    frontLeftMm: doc.widthMm - frontWidthMm,
    frontWidthMm,
  };
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
        id,
        user_id,
        project_id,
        projects!inner (
          id,
          user_id,
          title,
          cover_json,
          book_size_id,
          book_sizes ( name, cover_width_mm )
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
    id: string;
    user_id: string | null;
    project_id: string;
    projects: {
      id: string;
      user_id: string;
      title: string;
      cover_json: Record<string, unknown> | null;
      book_size_id: string;
      book_sizes: { name: string; cover_width_mm: number | null } | null;
    };
  };
  const project = order.projects;

  // 페이지 수
  const { count: pageCount } = await admin
    .from("pages")
    .select("id", { count: "exact", head: true })
    .eq("project_id", project.id);

  // 표지 미리보기 — 아직 수령 전(pending)이고 발신자 = 주문자 = 프로젝트 소유자일 때만 서명한다.
  // (수령·만료된 링크나 0032 이전 부정 gift 로는 사진 URL 을 내주지 않는다 — api/gifts/[token]/sender-guard.ts)
  const cover =
    currentStatus === "pending" &&
    giftSenderOwnsOrder({
      senderId: gift.sender_id,
      orderUserId: order.user_id,
      projectUserId: project.user_id,
    })
      ? await loadCoverPreview(
          admin,
          project.id,
          project.cover_json,
          project.book_sizes?.cover_width_mm ?? null,
        )
      : null;

  return {
    kind: "ok",
    data: {
      id: gift.id,
      orderId: gift.order_id,
      senderId: gift.sender_id,
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
        cover,
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

/** 표지 영역(h-48 = 192px) 안에 앞표지를 넣을 높이(px). */
const COVER_PREVIEW_HEIGHT_PX = 168;

/**
 * 앞표지만 보이도록 펼침면 PageDoc 을 고정 높이로 축소하고 왼쪽(뒤표지·책등)을 잘라낸다.
 * PagePreview(에디터 HTML/CSS 근사 렌더)를 그대로 재사용 — 서버에서 px 를 확정하므로 측정이 필요 없다.
 */
function FrontCoverPreview({
  cover,
  title,
}: {
  cover: CoverPreview;
  title: string;
}) {
  const scale = COVER_PREVIEW_HEIGHT_PX / cover.doc.heightMm;
  return (
    <div
      role="img"
      aria-label={`${title || "포토북"} 앞표지 미리보기`}
      className="relative overflow-hidden rounded-sm shadow-[0_4px_16px_rgba(0,0,0,0.12)]"
      style={{
        width: cover.frontWidthMm * scale,
        height: COVER_PREVIEW_HEIGHT_PX,
      }}
    >
      <div aria-hidden="true" style={{ marginLeft: -cover.frontLeftMm * scale }}>
        <PagePreview
          doc={cover.doc}
          photoUrls={cover.photoUrls}
          cardWidthPx={cover.doc.widthMm * scale}
        />
      </div>
    </div>
  );
}

export default async function GiftTokenPage(props: PageProps) {
  const params = await props.params;
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
          유효하지 않은 포토북 사본 링크예요
        </h1>
        <p className="mt-2 text-sm text-muted-foreground max-w-sm">
          링크가 올바른지 확인해 주세요. 기간이 지났거나 없는 링크일 수 있어요.
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
          포토북 사본 링크의 기간이 지났어요
        </h1>
        <p className="mt-2 text-sm text-muted-foreground max-w-sm">
          이 링크는 받을 수 있는 기간이 지났어요. 보낸 분께 문의해 주세요.
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
  let currentUserId: string | null = null;
  try {
    const supabase = await createServerSupabase();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    isLoggedIn = !!session;
    currentUserId = session?.user.id ?? null;
  } catch {
    isLoggedIn = false;
  }

  // ── 보낸 사람 본인 여부 ───────────────────────────────────────────────────
  // gifts.sender_id 와 세션 사용자 비교. 보낸 사람에게는 받기 버튼 대신 안내·링크 복사를 보여준다
  // (받기를 누르면 API 가 SELF_CLAIM 으로 거부하므로 막다른 길이 된다). 화면 분기용일 뿐 권한 판단은 API 가 한다.
  const isSender = currentUserId !== null && currentUserId === gift.senderId;

  // ── 수령자 본인 여부 판정 ─────────────────────────────────────────────────
  // claimed_project_id 는 claim 시 수령자 소유로 복제된 프로젝트 —
  // 그 프로젝트의 user_id 가 현재 사용자와 일치할 때만 "내 포토북 열기"를 보여준다.
  // (보낸 사람이 자기 링크를 다시 열어도 남의 에디터로 유도하지 않는다.)
  let isClaimOwner = false;
  if (gift.status === "claimed" && gift.claimedProjectId && currentUserId) {
    const admin = createAdminSupabase();
    const { data: claimedProject } = await admin
      .from("projects")
      .select("user_id")
      .eq("id", gift.claimedProjectId)
      .maybeSingle();
    isClaimOwner = claimedProject?.user_id === currentUserId;
  }

  const loginUrl = `/login?next=${encodeURIComponent(`/gift/${params.token}`)}`;
  const orderUrl = `/mypage/orders/${gift.orderId}`;

  // ── 유효한 사본 링크 (pending | claimed) ─────────────────────────────────
  return (
    <div className="container py-10 md:py-16">
      <div className="mx-auto max-w-lg">
        {/* 헤더 */}
        <div className="mb-8 text-center">
          <span
            className="inline-flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-rose-100 to-amber-100 dark:from-rose-900/30 dark:to-amber-900/30 mb-4"
            aria-hidden="true"
          >
            <Gift className="h-8 w-8 text-rose-500" />
          </span>
          <h1 className="font-display text-2xl font-semibold md:text-3xl">
            <strong>{gift.senderName}</strong>님이 포토북 사본을 보냈어요
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            실물 배송이 아니에요. 받으면 내 계정에 편집할 수 있는 포토북이 생기고,
            인쇄본은 받은 뒤 직접 주문할 수 있어요.
          </p>
        </div>

        {/* 사본 카드 */}
        <div className="rounded-2xl border bg-card shadow-[0_1px_3px_rgba(0,0,0,0.04)] overflow-hidden">
          {/* 표지 영역 */}
          <div className="relative h-48 bg-gradient-to-br from-rose-50 via-orange-50 to-amber-50 dark:from-rose-950/20 dark:via-orange-950/20 dark:to-amber-950/20 flex items-center justify-center">
            {gift.project.cover ? (
              <FrontCoverPreview
                cover={gift.project.cover}
                title={gift.project.title}
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
                받을 수 있는 기간: {DT.format(new Date(gift.expiresAt))}까지
              </p>
            )}

            {/* CTA */}
            <div className="pt-1">
              {gift.status === "claimed" ? (
                isClaimOwner && gift.claimedProjectId ? (
                  /* 수령자 본인 — 내 포토북으로 바로 이동 */
                  <div className="space-y-3">
                    <Notice tone="success">이미 받은 사본이에요</Notice>
                    <GiftClaimButton
                      token={params.token}
                      claimedProjectId={gift.claimedProjectId}
                    />
                  </div>
                ) : isSender ? (
                  /* 보낸 사람 — 받는 분이 이미 받음 */
                  <div className="space-y-3">
                    <Notice tone="success">받는 분이 사본을 받았어요</Notice>
                    <Button asChild variant="outline" size="lg" className="w-full">
                      <Link href={orderUrl}>주문 내역으로</Link>
                    </Button>
                  </div>
                ) : !isLoggedIn ? (
                  /* 비로그인 — 세션 만료 후 재방문한 수령자를 위한 로그인 동선 */
                  <div className="space-y-3">
                    <Notice tone="success">이미 받은 사본이에요</Notice>
                    <Button
                      asChild
                      variant="gradient"
                      size="lg"
                      className="w-full gap-2"
                    >
                      <Link href={loginUrl}>
                        <BookOpen className="h-4 w-4" aria-hidden="true" />
                        로그인하고 내 포토북 열기
                      </Link>
                    </Button>
                  </div>
                ) : (
                  /* 로그인한 다른 사람 — 다른 계정에서 이미 받음 */
                  <div className="space-y-3">
                    <Notice tone="muted">
                      이 사본은 이미 다른 계정에서 받았어요. 받은 계정으로 로그인했는지
                      확인해 주세요.
                    </Notice>
                    <div className="grid grid-cols-2 gap-2">
                      <Button asChild variant="outline" size="lg">
                        <Link href="/">홈으로</Link>
                      </Button>
                      <Button asChild variant="gradient" size="lg">
                        <Link href="/projects">내 포토북</Link>
                      </Button>
                    </div>
                  </div>
                )
              ) : isSender ? (
                /* 보낸 사람 본인 — 받기 대신 링크 공유 동선 */
                <div className="space-y-3">
                  <Notice tone="muted">
                    <span className="block font-medium text-foreground">
                      내가 보낸 사본이에요
                    </span>
                    받는 분께 이 링크를 전해 주세요. 받는 분이 로그인한 뒤 &lsquo;내
                    포토북으로 받기&rsquo;를 누르면 사본이 생겨요.
                  </Notice>
                  <CopyGiftLinkButton />
                  <Button asChild variant="outline" size="lg" className="w-full">
                    <Link href={orderUrl}>주문 내역으로</Link>
                  </Button>
                </div>
              ) : isLoggedIn ? (
                /* 로그인 상태 — 받기 가능 */
                <GiftClaimButton token={params.token} />
              ) : (
                /* 비로그인 — 로그인 게이트 */
                <div className="space-y-3">
                  <p className="text-sm text-muted-foreground text-center">
                    사본을 받으려면 로그인이 필요해요
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
          이 사본은{" "}
          <Link href="/" className="underline underline-offset-2 hover:text-foreground transition-colors">
            100p Books
          </Link>
          를 통해 보냈어요
        </p>
      </div>
    </div>
  );
}

/** CTA 위 상태 안내 박스. */
function Notice({
  tone,
  children,
}: {
  tone: "success" | "muted";
  children: React.ReactNode;
}) {
  return (
    <div
      className={
        tone === "success"
          ? "rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-center text-sm font-medium text-emerald-800 dark:border-emerald-900/50 dark:bg-emerald-950/40 dark:text-emerald-200"
          : "rounded-xl border bg-muted/50 px-4 py-3 text-center text-sm text-muted-foreground"
      }
    >
      {children}
    </div>
  );
}

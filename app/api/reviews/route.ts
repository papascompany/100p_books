import "server-only";

import { z } from "zod";

import { fail, failFromError, ok } from "@/app/api/_lib/response";
import { getSession, requireUser } from "@/lib/auth/session";
import { createAdminSupabase } from "@/lib/db/admin";
import { createServerSupabase } from "@/lib/db/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** 후기 첨부 이미지 signed URL TTL (1h). */
const REVIEW_IMG_SIGNED_TTL_SEC = 3600;

/** 후기 첨부 이미지 최대 장수. */
const REVIEW_MAX_IMAGES = 3;

/** 페이지네이션 기본/최대 한도. */
const DEFAULT_LIMIT = 12;
const MAX_LIMIT = 48;

/** 후기 작성 가능한 주문 상태. */
const REVIEWABLE_ORDER_STATUSES = new Set(["shipped", "delivered"]);

/**
 * 갤러리 응답 1건.
 */
interface ReviewListItem {
  id: string;
  rating: number;
  body: string | null;
  imageUrls: string[];
  likesCount: number;
  isLiked: boolean;
  authorName: string;
  authorId: string;
  createdAt: string;
  /** 본인 후기 여부 (수정/삭제 UI 토글용) */
  isMine: boolean;
}

interface ReviewListResponse {
  items: ReviewListItem[];
  /** 다음 페이지 커서 (마지막 아이템의 created_at). null 이면 끝. */
  nextCursor: string | null;
}

// =====================================================================
// GET /api/reviews?sort=recent|popular&cursor=ISO_DATE&limit=12
// =====================================================================
const QuerySchema = z.object({
  sort: z.enum(["recent", "popular"]).default("recent"),
  cursor: z.string().datetime().optional(),
  limit: z.coerce
    .number()
    .int()
    .positive()
    .max(MAX_LIMIT)
    .default(DEFAULT_LIMIT),
});

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const parsed = QuerySchema.safeParse({
      sort: url.searchParams.get("sort") ?? undefined,
      cursor: url.searchParams.get("cursor") ?? undefined,
      limit: url.searchParams.get("limit") ?? undefined,
    });
    if (!parsed.success) {
      return fail(
        "INVALID_QUERY",
        "잘못된 쿼리 파라미터입니다.",
        400,
        parsed.error.flatten(),
      );
    }
    const { sort, cursor, limit } = parsed.data;

    // 후기 갤러리는 비로그인도 조회 가능 (RLS 의 reviews_public_read 적용).
    // 로그인 사용자는 본인 좋아요 여부 표시.
    const session = await getSession();
    const viewerId = session?.user?.id ?? null;

    const supabase = createServerSupabase();

    // public=true 만 조회 (RLS 가 추가로 강제하지만 명시)
    let query = supabase
      .from("reviews")
      .select(
        `
          id,
          user_id,
          rating,
          body,
          image_keys,
          likes_count,
          public,
          created_at
        `,
      )
      .eq("public", true)
      .limit(limit);

    if (sort === "popular") {
      // popular 이지만 동률에서 안정 정렬 보장 위해 created_at 도 함께 정렬
      query = query
        .order("likes_count", { ascending: false })
        .order("created_at", { ascending: false });
      // 커서 페이지네이션은 popular 에서는 단순 created_at 기반으로 적용
      // (likes_count 기반 커서는 동률 처리가 복잡 — 단순화 우선).
      if (cursor) query = query.lt("created_at", cursor);
    } else {
      query = query.order("created_at", { ascending: false });
      if (cursor) query = query.lt("created_at", cursor);
    }

    const { data: rows, error } = await query;
    if (error) return fail("REVIEWS_QUERY_FAILED", error.message, 500);

    const reviewRows = rows ?? [];

    if (reviewRows.length === 0) {
      const empty: ReviewListResponse = { items: [], nextCursor: null };
      return ok(empty);
    }

    const userIds = Array.from(new Set(reviewRows.map((r) => r.user_id)));

    // 작성자 표시명 — admin 으로 묶어서 조회 (profiles RLS: 본인만이지만 anon 갤러리에도
    // 작성자 닉네임을 노출해야 하므로 service_role 로 우회 + display_name 만 추출).
    // NOTE: profiles.email 은 익명 갤러리(anon 접근) 표시명 fallback 으로 사용하지 않는다.
    //       이메일 로컬파트가 식별 가능한 PII 일 수 있어, display_name 미설정 시 '익명' 으로만 노출.
    const admin = createAdminSupabase();

    const { data: profiles, error: profErr } = await admin
      .from("profiles")
      .select("id, display_name")
      .in("id", userIds);
    if (profErr) {
      return fail("PROFILES_QUERY_FAILED", profErr.message, 500);
    }
    const nameById = new Map<string, string>();
    for (const p of profiles ?? []) {
      const nm = p.display_name || "익명";
      nameById.set(p.id, nm);
    }

    // 본인 좋아요 여부 — 로그인 시에만 조회
    const likedSet = new Set<string>();
    if (viewerId) {
      const reviewIds = reviewRows.map((r) => r.id);
      const { data: likeRows, error: likeErr } = await supabase
        .from("review_likes")
        .select("review_id")
        .eq("user_id", viewerId)
        .in("review_id", reviewIds);
      if (likeErr) {
        return fail("LIKES_QUERY_FAILED", likeErr.message, 500);
      }
      for (const l of likeRows ?? []) likedSet.add(l.review_id);
    }

    // 첨부 이미지 signed URL — 모든 image_keys 를 모아서 batch
    const allKeys: string[] = [];
    for (const r of reviewRows) {
      for (const k of r.image_keys ?? []) {
        if (typeof k === "string" && k.length > 0) allKeys.push(k);
      }
    }
    const urlByKey: Record<string, string> = {};
    if (allKeys.length > 0) {
      const CHUNK = 200;
      for (let i = 0; i < allKeys.length; i += CHUNK) {
        const slice = allKeys.slice(i, i + CHUNK);
        const { data: signed, error: signErr } = await admin.storage
          .from("reviews")
          .createSignedUrls(slice, REVIEW_IMG_SIGNED_TTL_SEC);
        if (signErr) {
          return fail("SIGN_URL_FAILED", signErr.message, 500);
        }
        for (const item of signed ?? []) {
          if (item.path && item.signedUrl) {
            urlByKey[item.path] = item.signedUrl;
          }
        }
      }
    }

    const items: ReviewListItem[] = reviewRows.map((r) => {
      const keys = ((r.image_keys ?? []) as unknown[]).filter(
        (k): k is string => typeof k === "string",
      );
      const urls = keys
        .map((k) => urlByKey[k])
        .filter((u): u is string => typeof u === "string");
      return {
        id: r.id,
        rating: r.rating,
        body: r.body,
        imageUrls: urls,
        likesCount: r.likes_count,
        isLiked: viewerId ? likedSet.has(r.id) : false,
        authorName: nameById.get(r.user_id) ?? "익명",
        authorId: r.user_id,
        createdAt: r.created_at,
        isMine: viewerId === r.user_id,
      };
    });

    const lastRow = reviewRows[reviewRows.length - 1];
    const nextCursor =
      reviewRows.length === limit && lastRow ? lastRow.created_at : null;

    const body: ReviewListResponse = { items, nextCursor };
    return ok(body);
  } catch (err) {
    return failFromError(err);
  }
}

// =====================================================================
// POST /api/reviews
// =====================================================================
const CreateBodySchema = z.object({
  orderId: z.string().uuid(),
  rating: z.number().int().min(1).max(5),
  body: z.string().trim().max(2000).optional(),
  imageKeys: z
    .array(z.string().min(1).max(512))
    .max(REVIEW_MAX_IMAGES, `사진은 최대 ${REVIEW_MAX_IMAGES}장까지 첨부할 수 있어요.`)
    .optional(),
  public: z.boolean().optional(),
});

export async function POST(req: Request) {
  try {
    const user = await requireUser();

    const raw = (await req.json().catch(() => ({}))) as unknown;
    const parsed = CreateBodySchema.safeParse(raw ?? {});
    if (!parsed.success) {
      return fail(
        "INVALID_BODY",
        "요청 본문이 올바르지 않습니다.",
        400,
        parsed.error.flatten(),
      );
    }
    const { orderId, rating, body: textBody, imageKeys, public: isPublic } =
      parsed.data;

    const supabase = createServerSupabase();

    // 1) 주문 존재 + 소유 + 후기 작성 가능 상태 검증
    const { data: order, error: orderErr } = await supabase
      .from("orders")
      .select("id, user_id, status")
      .eq("id", orderId)
      .maybeSingle();
    if (orderErr) return fail("ORDER_QUERY_FAILED", orderErr.message, 500);
    if (!order) return fail("NOT_FOUND", "주문을 찾을 수 없습니다.", 404);
    if (order.user_id !== user.id) {
      return fail("FORBIDDEN", "해당 주문에 대한 권한이 없어요.", 403);
    }
    if (!REVIEWABLE_ORDER_STATUSES.has(order.status)) {
      return fail(
        "ORDER_NOT_REVIEWABLE",
        "배송 시작 이후의 주문만 후기를 작성할 수 있어요.",
        400,
      );
    }

    // 2) image_keys 의 첫 path segment 가 본인 userId 와 일치해야 함 (방어)
    if (imageKeys && imageKeys.length > 0) {
      for (const k of imageKeys) {
        const first = k.split("/")[0] ?? "";
        if (first !== user.id) {
          return fail(
            "INVALID_IMAGE_KEY",
            "본인이 업로드한 이미지만 첨부할 수 있어요.",
            400,
          );
        }
      }
    }

    // 3) 중복 방지 — order_id UNIQUE 가 보장하지만 친절한 에러 메시지 위해 선조회
    const { data: existing } = await supabase
      .from("reviews")
      .select("id")
      .eq("order_id", orderId)
      .maybeSingle();
    if (existing) {
      return fail(
        "REVIEW_ALREADY_EXISTS",
        "이미 작성한 후기가 있어요.",
        409,
      );
    }

    // 4) INSERT — RLS: reviews_own_all (user_id = auth.uid()) 통과
    const { data: inserted, error: insErr } = await supabase
      .from("reviews")
      .insert({
        order_id: orderId,
        user_id: user.id,
        rating,
        body: textBody ?? null,
        image_keys: imageKeys ?? [],
        public: isPublic ?? true,
      })
      .select("id, order_id, user_id, rating, body, image_keys, public, likes_count, created_at, updated_at")
      .single();

    if (insErr || !inserted) {
      // 23505 = unique_violation (order_id 중복) — 동시성 케이스
      if (insErr && (insErr as { code?: string }).code === "23505") {
        return fail(
          "REVIEW_ALREADY_EXISTS",
          "이미 작성한 후기가 있어요.",
          409,
        );
      }
      return fail(
        "REVIEW_INSERT_FAILED",
        insErr?.message ?? "후기 저장에 실패했어요.",
        500,
      );
    }

    return ok(inserted, { status: 201 });
  } catch (err) {
    return failFromError(err);
  }
}

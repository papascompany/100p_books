import "server-only";

import { z } from "zod";

import { fail, failFromError, ok } from "@/app/api/_lib/response";
import { getSession, requireUser } from "@/lib/auth/session";
import { createAdminSupabase } from "@/lib/db/admin";
import { createServerSupabase } from "@/lib/db/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteCtx = { params: { id: string } };

const REVIEW_IMG_SIGNED_TTL_SEC = 3600;
const REVIEW_MAX_IMAGES = 3;

const ParamsSchema = z.object({ id: z.string().uuid() });

/** 이메일 prefix — 표시명이 없을 때 fallback. */
function emailPrefix(email: string): string {
  const i = email.indexOf("@");
  return i > 0 ? email.slice(0, i) : email;
}

// =====================================================================
// GET /api/reviews/[id]
// =====================================================================
export async function GET(_req: Request, { params }: RouteCtx) {
  try {
    const parsedParams = ParamsSchema.safeParse(params);
    if (!parsedParams.success) {
      return fail("INVALID_PARAMS", "후기 id 형식이 올바르지 않습니다.", 400);
    }
    const reviewId = parsedParams.data.id;

    const session = await getSession();
    const viewerId = session?.user?.id ?? null;

    const supabase = createServerSupabase();
    const { data: review, error } = await supabase
      .from("reviews")
      .select(
        "id, user_id, order_id, rating, body, image_keys, likes_count, public, created_at, updated_at",
      )
      .eq("id", reviewId)
      .maybeSingle();
    if (error) return fail("REVIEW_QUERY_FAILED", error.message, 500);
    if (!review) return fail("NOT_FOUND", "후기를 찾을 수 없습니다.", 404);

    // 비공개 후기는 본인만 조회 가능
    if (!review.public && review.user_id !== viewerId) {
      return fail("FORBIDDEN", "비공개 후기입니다.", 403);
    }

    const admin = createAdminSupabase();

    // 작성자 이름
    const { data: authorProfile } = await admin
      .from("profiles")
      .select("display_name, email")
      .eq("id", review.user_id)
      .maybeSingle();
    const authorName =
      authorProfile?.display_name ||
      (authorProfile?.email ? emailPrefix(authorProfile.email) : null) ||
      "익명";

    // 첨부 signed URLs
    const imageUrls: string[] = [];
    const rawKeys = (review.image_keys ?? []) as unknown[];
    const keys = rawKeys.filter(
      (k): k is string => typeof k === "string" && k.length > 0,
    );
    if (keys.length > 0) {
      const { data: signed, error: signErr } = await admin.storage
        .from("reviews")
        .createSignedUrls(keys, REVIEW_IMG_SIGNED_TTL_SEC);
      if (signErr) {
        return fail("SIGN_URL_FAILED", signErr.message, 500);
      }
      const byKey = new Map<string, string>();
      for (const item of signed ?? []) {
        if (item.path && item.signedUrl) byKey.set(item.path, item.signedUrl);
      }
      for (const k of keys) {
        const u = byKey.get(k);
        if (u) imageUrls.push(u);
      }
    }

    // 본인 좋아요 여부
    let isLiked = false;
    if (viewerId) {
      const { data: like } = await supabase
        .from("review_likes")
        .select("id")
        .eq("review_id", reviewId)
        .eq("user_id", viewerId)
        .maybeSingle();
      isLiked = !!like;
    }

    return ok({
      id: review.id,
      orderId: review.order_id,
      authorId: review.user_id,
      authorName,
      rating: review.rating,
      body: review.body,
      imageUrls,
      likesCount: review.likes_count,
      isLiked,
      public: review.public,
      isMine: viewerId === review.user_id,
      createdAt: review.created_at,
      updatedAt: review.updated_at,
    });
  } catch (err) {
    return failFromError(err);
  }
}

// =====================================================================
// PATCH /api/reviews/[id]
// =====================================================================
const PatchBodySchema = z
  .object({
    rating: z.number().int().min(1).max(5).optional(),
    body: z.string().trim().max(2000).nullable().optional(),
    imageKeys: z
      .array(z.string().min(1).max(512))
      .max(REVIEW_MAX_IMAGES, `사진은 최대 ${REVIEW_MAX_IMAGES}장까지 첨부할 수 있어요.`)
      .optional(),
    public: z.boolean().optional(),
  })
  .refine(
    (v) =>
      v.rating !== undefined ||
      v.body !== undefined ||
      v.imageKeys !== undefined ||
      v.public !== undefined,
    { message: "수정할 필드가 없습니다." },
  );

export async function PATCH(req: Request, { params }: RouteCtx) {
  try {
    const user = await requireUser();

    const parsedParams = ParamsSchema.safeParse(params);
    if (!parsedParams.success) {
      return fail("INVALID_PARAMS", "후기 id 형식이 올바르지 않습니다.", 400);
    }
    const reviewId = parsedParams.data.id;

    const raw = (await req.json().catch(() => ({}))) as unknown;
    const parsed = PatchBodySchema.safeParse(raw ?? {});
    if (!parsed.success) {
      return fail(
        "INVALID_BODY",
        "요청 본문이 올바르지 않습니다.",
        400,
        parsed.error.flatten(),
      );
    }
    const patch = parsed.data;

    // image_keys 가 들어오면 본인 폴더만 허용
    if (patch.imageKeys && patch.imageKeys.length > 0) {
      for (const k of patch.imageKeys) {
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

    const supabase = createServerSupabase();

    // 본인 소유 검증 — RLS 가 차단하지만 친절한 에러를 위해 선조회
    const { data: existing, error: selErr } = await supabase
      .from("reviews")
      .select("id, user_id")
      .eq("id", reviewId)
      .maybeSingle();
    if (selErr) return fail("REVIEW_QUERY_FAILED", selErr.message, 500);
    if (!existing) return fail("NOT_FOUND", "후기를 찾을 수 없습니다.", 404);
    if (existing.user_id !== user.id) {
      return fail("FORBIDDEN", "해당 후기에 대한 권한이 없어요.", 403);
    }

    const updatePayload: Record<string, unknown> = {};
    if (patch.rating !== undefined) updatePayload.rating = patch.rating;
    if (patch.body !== undefined) updatePayload.body = patch.body;
    if (patch.imageKeys !== undefined) updatePayload.image_keys = patch.imageKeys;
    if (patch.public !== undefined) updatePayload.public = patch.public;

    const { data: updated, error: updErr } = await supabase
      .from("reviews")
      .update(updatePayload)
      .eq("id", reviewId)
      .select(
        "id, order_id, user_id, rating, body, image_keys, public, likes_count, created_at, updated_at",
      )
      .single();
    if (updErr || !updated) {
      return fail(
        "REVIEW_UPDATE_FAILED",
        updErr?.message ?? "후기 수정에 실패했어요.",
        500,
      );
    }

    return ok(updated);
  } catch (err) {
    return failFromError(err);
  }
}

// =====================================================================
// DELETE /api/reviews/[id]
// =====================================================================
export async function DELETE(_req: Request, { params }: RouteCtx) {
  try {
    const user = await requireUser();

    const parsedParams = ParamsSchema.safeParse(params);
    if (!parsedParams.success) {
      return fail("INVALID_PARAMS", "후기 id 형식이 올바르지 않습니다.", 400);
    }
    const reviewId = parsedParams.data.id;

    const supabase = createServerSupabase();

    // 소유 + 첨부 키 조회 — 삭제 후 storage 객체도 제거
    const { data: review, error: selErr } = await supabase
      .from("reviews")
      .select("id, user_id, image_keys")
      .eq("id", reviewId)
      .maybeSingle();
    if (selErr) return fail("REVIEW_QUERY_FAILED", selErr.message, 500);
    if (!review) return fail("NOT_FOUND", "후기를 찾을 수 없습니다.", 404);
    if (review.user_id !== user.id) {
      return fail("FORBIDDEN", "해당 후기에 대한 권한이 없어요.", 403);
    }

    const { error: delErr } = await supabase
      .from("reviews")
      .delete()
      .eq("id", reviewId);
    if (delErr) {
      return fail("REVIEW_DELETE_FAILED", delErr.message, 500);
    }

    // storage 객체 정리 (실패해도 DB 삭제는 성공이므로 best-effort)
    const rawKeys = (review.image_keys ?? []) as unknown[];
    const keys = rawKeys.filter(
      (k): k is string => typeof k === "string" && k.length > 0,
    );
    if (keys.length > 0) {
      const admin = createAdminSupabase();
      const { error: rmErr } = await admin.storage.from("reviews").remove(keys);
      if (rmErr) {
        console.error(
          "[reviews/delete] storage cleanup failed:",
          rmErr.message,
        );
      }
    }

    return ok({ id: reviewId, deleted: true });
  } catch (err) {
    return failFromError(err);
  }
}

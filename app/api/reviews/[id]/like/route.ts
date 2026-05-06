import "server-only";

import { z } from "zod";

import { fail, failFromError, ok } from "@/app/api/_lib/response";
import { requireUser } from "@/lib/auth/session";
import { createAdminSupabase } from "@/lib/db/admin";
import { createServerSupabase } from "@/lib/db/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteCtx = { params: { id: string } };

const ParamsSchema = z.object({ id: z.string().uuid() });

interface ToggleResult {
  liked: boolean;
  likesCount: number;
}

/**
 * POST /api/reviews/[id]/like
 *
 *   현재 사용자의 좋아요 상태를 토글한다.
 *   - 있으면 DELETE + likes_count -= 1
 *   - 없으면 INSERT + likes_count += 1
 *
 *   RPC `toggle_review_like(review_id, user_id)` 가 단일 트랜잭션으로 처리.
 *
 *   응답: { liked, likesCount }
 *
 *   주의:
 *     RPC 가 SECURITY DEFINER 라서 RLS 를 우회하므로, 라우트에서 다음을 검증한다:
 *       1) requireUser — 인증된 호출자만
 *       2) 대상 후기가 public=true 또는 본인 후기 (비공개 타인 후기 좋아요 차단)
 */
export async function POST(_req: Request, { params }: RouteCtx) {
  try {
    const user = await requireUser();

    const parsedParams = ParamsSchema.safeParse(params);
    if (!parsedParams.success) {
      return fail("INVALID_PARAMS", "후기 id 형식이 올바르지 않습니다.", 400);
    }
    const reviewId = parsedParams.data.id;

    const supabase = createServerSupabase();

    // 후기 존재/공개 여부 검증 (RLS: public=true 행은 anon 도 SELECT 가능)
    const { data: review, error: selErr } = await supabase
      .from("reviews")
      .select("id, user_id, public")
      .eq("id", reviewId)
      .maybeSingle();
    if (selErr) return fail("REVIEW_QUERY_FAILED", selErr.message, 500);
    if (!review) return fail("NOT_FOUND", "후기를 찾을 수 없습니다.", 404);
    if (!review.public && review.user_id !== user.id) {
      return fail("FORBIDDEN", "비공개 후기에는 좋아요를 누를 수 없어요.", 403);
    }

    // RPC 호출 — admin 키 사용 (SECURITY DEFINER 라 RLS 우회 가능하지만,
    // user_id 인자를 우리가 명시 전달하므로 admin 으로 호출해도 안전)
    const admin = createAdminSupabase();
    const { data, error: rpcErr } = await admin.rpc("toggle_review_like", {
      p_review_id: reviewId,
      p_user_id: user.id,
    });
    if (rpcErr) {
      return fail(
        "TOGGLE_LIKE_FAILED",
        rpcErr.message ?? "좋아요 처리에 실패했어요.",
        500,
      );
    }

    // RPC 반환은 jsonb → { liked, likesCount }
    const result = (data ?? {}) as Partial<ToggleResult>;
    if (typeof result.liked !== "boolean" || typeof result.likesCount !== "number") {
      return fail(
        "TOGGLE_LIKE_FAILED",
        "좋아요 응답 형식이 올바르지 않아요.",
        500,
      );
    }

    return ok<ToggleResult>({
      liked: result.liked,
      likesCount: result.likesCount,
    });
  } catch (err) {
    return failFromError(err);
  }
}

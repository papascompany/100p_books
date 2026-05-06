import { z } from "zod";

import { fail, failFromError, ok } from "@/app/api/_lib/response";
import { requireUser } from "@/lib/auth/session";
import { createServerSupabase } from "@/lib/db/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteCtx = { params: { id: string; tokenId: string } };

const TokenIdSchema = z.string().uuid();

/**
 * DELETE /api/projects/[id]/share/[tokenId]
 *   특정 공유 토큰 삭제 (소유자만).
 *   RLS 가 owner 검증을 보장하지만 라우트에서도 1차 검증.
 */
export async function DELETE(_req: Request, { params }: RouteCtx) {
  try {
    const user = await requireUser();

    const tokenIdParse = TokenIdSchema.safeParse(params.tokenId);
    if (!tokenIdParse.success) {
      return fail("INVALID_TOKEN_ID", "토큰 ID 형식이 올바르지 않습니다.", 400);
    }

    const supabase = createServerSupabase();

    // 프로젝트 소유 선검증
    const { data: project, error: projErr } = await supabase
      .from("projects")
      .select("id, user_id")
      .eq("id", params.id)
      .maybeSingle();

    if (projErr) return fail("PROJECT_QUERY_FAILED", projErr.message, 500);
    if (!project) return fail("NOT_FOUND", "프로젝트를 찾을 수 없습니다.", 404);
    if (project.user_id !== user.id) {
      return fail("FORBIDDEN", "해당 프로젝트에 대한 권한이 없습니다.", 403);
    }

    const { error: delErr, count } = await supabase
      .from("share_tokens")
      .delete({ count: "exact" })
      .eq("id", params.tokenId)
      .eq("project_id", params.id);

    if (delErr) return fail("SHARE_TOKEN_DELETE_FAILED", delErr.message, 500);
    if (!count) return fail("NOT_FOUND", "토큰을 찾을 수 없습니다.", 404);

    return ok({ deleted: count });
  } catch (err) {
    return failFromError(err);
  }
}

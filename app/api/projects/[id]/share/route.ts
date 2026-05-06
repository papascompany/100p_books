import { z } from "zod";

import { fail, failFromError, ok } from "@/app/api/_lib/response";
import { requireUser } from "@/lib/auth/session";
import { createServerSupabase } from "@/lib/db/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteCtx = { params: { id: string } };

const CreateSchema = z
  .object({
    /** null/0/미지정 → 무기한. */
    expiresInDays: z.number().int().positive().max(365).optional(),
  })
  .default({});

/** App URL 기반 공유 URL 합성. */
function buildShareUrl(token: string): string {
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "");
  return base ? `${base}/share/${token}` : `/share/${token}`;
}

/**
 * 프로젝트 소유 검증.
 * 인증된 user 가 해당 project 의 owner 여야 한다.
 */
async function assertProjectOwner(
  supabase: ReturnType<typeof createServerSupabase>,
  projectId: string,
  userId: string,
) {
  const { data, error } = await supabase
    .from("projects")
    .select("id, user_id")
    .eq("id", projectId)
    .maybeSingle();
  if (error) return { err: fail("PROJECT_QUERY_FAILED", error.message, 500) };
  if (!data) return { err: fail("NOT_FOUND", "프로젝트를 찾을 수 없습니다.", 404) };
  if (data.user_id !== userId) {
    return { err: fail("FORBIDDEN", "해당 프로젝트에 대한 권한이 없습니다.", 403) };
  }
  return { err: null as null };
}

/**
 * GET /api/projects/[id]/share
 *   현재 프로젝트의 활성 공유 토큰 목록 (소유자만).
 *   응답: { tokens: Array<{ id, token, shareUrl, expiresAt, viewCount, createdAt }> }
 */
export async function GET(_req: Request, { params }: RouteCtx) {
  try {
    const user = await requireUser();
    const supabase = createServerSupabase();

    const owner = await assertProjectOwner(supabase, params.id, user.id);
    if (owner.err) return owner.err;

    const { data, error } = await supabase
      .from("share_tokens")
      .select("id, token, expires_at, view_count, created_at")
      .eq("project_id", params.id)
      .order("created_at", { ascending: false });

    if (error) return fail("SHARE_TOKENS_QUERY_FAILED", error.message, 500);

    const tokens = (data ?? []).map((r) => ({
      id: r.id,
      token: r.token,
      shareUrl: buildShareUrl(r.token),
      expiresAt: r.expires_at,
      viewCount: r.view_count,
      createdAt: r.created_at,
    }));

    return ok({ tokens });
  } catch (err) {
    return failFromError(err);
  }
}

/**
 * POST /api/projects/[id]/share
 *   body: { expiresInDays?: number }
 *   새 공유 토큰 발급. (소유자만)
 *   응답: { id, token, shareUrl, expiresAt }
 */
export async function POST(req: Request, { params }: RouteCtx) {
  try {
    const user = await requireUser();

    const raw = (await req.json().catch(() => ({}))) as unknown;
    const parsed = CreateSchema.safeParse(raw ?? {});
    if (!parsed.success) {
      return fail(
        "INVALID_BODY",
        "요청 본문이 올바르지 않습니다.",
        400,
        parsed.error.flatten(),
      );
    }

    const supabase = createServerSupabase();
    const owner = await assertProjectOwner(supabase, params.id, user.id);
    if (owner.err) return owner.err;

    const expiresAt = parsed.data.expiresInDays
      ? new Date(Date.now() + parsed.data.expiresInDays * 24 * 60 * 60 * 1000).toISOString()
      : null;

    const { data, error } = await supabase
      .from("share_tokens")
      .insert({
        project_id: params.id,
        expires_at: expiresAt,
      })
      .select("id, token, expires_at, view_count, created_at")
      .single();

    if (error || !data) {
      return fail(
        "SHARE_TOKEN_INSERT_FAILED",
        error?.message ?? "토큰 발급에 실패했습니다.",
        500,
      );
    }

    return ok({
      id: data.id,
      token: data.token,
      shareUrl: buildShareUrl(data.token),
      expiresAt: data.expires_at,
      viewCount: data.view_count,
      createdAt: data.created_at,
    });
  } catch (err) {
    return failFromError(err);
  }
}

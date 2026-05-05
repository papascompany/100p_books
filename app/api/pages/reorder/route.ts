import "server-only";

import { z } from "zod";

import { fail, failFromError, ok } from "@/app/api/_lib/response";
import { requireUser } from "@/lib/auth/session";
import { createAdminSupabase } from "@/lib/db/admin";
import { createServerSupabase } from "@/lib/db/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const BodySchema = z.object({
  projectId: z.string().uuid(),
  pageIds: z.array(z.string().uuid()).min(1).max(500),
});

/**
 * POST /api/pages/reorder
 *   body: { projectId, pageIds: uuid[] }
 *
 * 검증:
 *   1. 로그인.
 *   2. project 소유권.
 *   3. pageIds 길이 == 해당 프로젝트 페이지 수.
 *   4. pageIds 의 모든 ID 가 해당 프로젝트 소유 + 중복 없음.
 *
 * 처리: service_role 로 reorder_project_pages RPC 호출 (단일 트랜잭션).
 */
export async function POST(req: Request) {
  try {
    const user = await requireUser();

    const raw = (await req.json().catch(() => ({}))) as unknown;
    const parsed = BodySchema.safeParse(raw);
    if (!parsed.success) {
      return fail(
        "INVALID_BODY",
        "projectId 와 pageIds 가 필요합니다.",
        400,
        parsed.error.flatten(),
      );
    }
    const { projectId, pageIds } = parsed.data;

    // 중복 검사
    const set = new Set(pageIds);
    if (set.size !== pageIds.length) {
      return fail("DUPLICATE_PAGE_IDS", "중복된 page id 가 있습니다.", 400);
    }

    const supabase = createServerSupabase();

    // 소유권
    const { data: project, error: projErr } = await supabase
      .from("projects")
      .select("id, user_id")
      .eq("id", projectId)
      .maybeSingle();
    if (projErr) return fail("PROJECT_QUERY_FAILED", projErr.message, 500);
    if (!project) return fail("NOT_FOUND", "프로젝트를 찾을 수 없습니다.", 404);
    if (project.user_id !== user.id) {
      return fail("FORBIDDEN", "해당 프로젝트에 대한 권한이 없습니다.", 403);
    }

    // 페이지 ID 일치성 (실제 모든 페이지가 해당 프로젝트 소속인지)
    const { data: existingPages, error: pagesErr } = await supabase
      .from("pages")
      .select("id")
      .eq("project_id", projectId);
    if (pagesErr) return fail("PAGES_QUERY_FAILED", pagesErr.message, 500);

    const existingIds = new Set((existingPages ?? []).map((p) => p.id));
    if (existingIds.size !== pageIds.length) {
      return fail(
        "PAGE_COUNT_MISMATCH",
        `pageIds 길이(${pageIds.length})가 실제 페이지 수(${existingIds.size})와 다릅니다.`,
        400,
      );
    }
    for (const id of pageIds) {
      if (!existingIds.has(id)) {
        return fail(
          "PAGE_NOT_IN_PROJECT",
          "포함되지 않은 page id 가 있습니다.",
          400,
        );
      }
    }

    const admin = createAdminSupabase();
    const { data: rpcCount, error: rpcErr } = await admin.rpc(
      "reorder_project_pages",
      { p_project_id: projectId, p_page_ids: pageIds },
    );
    if (rpcErr) {
      return fail("REORDER_FAILED", rpcErr.message, 500);
    }

    return ok({ ok: true, pageCount: rpcCount ?? pageIds.length });
  } catch (err) {
    return failFromError(err);
  }
}

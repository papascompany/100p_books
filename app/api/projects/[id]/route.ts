import { z } from "zod";

import { fail, failFromError, ok } from "@/app/api/_lib/response";
import { requireUser } from "@/lib/auth/session";
import { createServerSupabase } from "@/lib/db/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const PatchSchema = z
  .object({
    title: z.string().trim().min(1).max(80).optional(),
    bookSizeId: z.string().uuid().optional(),
  })
  .refine((d) => d.title !== undefined || d.bookSizeId !== undefined, {
    message: "수정할 필드가 없습니다.",
  });

type RouteCtx = { params: { id: string } };

/**
 * GET /api/projects/[id]
 *   프로젝트 메타 + 사진 수.
 */
export async function GET(_req: Request, { params }: RouteCtx) {
  try {
    const user = await requireUser();
    const supabase = createServerSupabase();

    const { data: project, error } = await supabase
      .from("projects")
      .select(
        "id, user_id, book_size_id, title, status, layout_mode, cover_json, created_at, updated_at",
      )
      .eq("id", params.id)
      .maybeSingle();

    if (error) return fail("PROJECT_QUERY_FAILED", error.message, 500);
    if (!project) return fail("NOT_FOUND", "프로젝트를 찾을 수 없습니다.", 404);
    if (project.user_id !== user.id) {
      return fail("FORBIDDEN", "해당 프로젝트에 대한 권한이 없습니다.", 403);
    }

    const { count, error: countErr } = await supabase
      .from("photos")
      .select("id", { count: "exact", head: true })
      .eq("project_id", project.id)
      .is("deleted_at", null);

    if (countErr) return fail("PHOTO_COUNT_FAILED", countErr.message, 500);

    return ok({
      id: project.id,
      title: project.title,
      status: project.status,
      bookSizeId: project.book_size_id,
      layoutMode: project.layout_mode,
      coverJson: project.cover_json,
      photoCount: count ?? 0,
      createdAt: project.created_at,
      updatedAt: project.updated_at,
    });
  } catch (err) {
    return failFromError(err);
  }
}

/**
 * DELETE /api/projects/[id]
 *   1. 소유권 검증
 *   2. 결제 완료된 주문이 있으면 삭제 거부 (데이터 보관 필요)
 *   3. pages 하드 삭제 → photos 하드 삭제 → project 하드 삭제
 *
 *   Storage 파일 삭제는 비동기 클린업 잡(별도 cron)에 위임.
 *   RLS 가 2차 방어선.
 */
export async function DELETE(_req: Request, { params }: RouteCtx) {
  try {
    const user = await requireUser();
    const supabase = createServerSupabase();

    // 소유권 확인
    const { data: project, error: selErr } = await supabase
      .from("projects")
      .select("id, user_id")
      .eq("id", params.id)
      .maybeSingle();

    if (selErr) return fail("PROJECT_QUERY_FAILED", selErr.message, 500);
    if (!project) return fail("NOT_FOUND", "프로젝트를 찾을 수 없습니다.", 404);
    if (project.user_id !== user.id) {
      return fail("FORBIDDEN", "해당 프로젝트에 대한 권한이 없습니다.", 403);
    }

    // 결제 완료 주문이 연결되어 있으면 삭제 거부
    const { count: paidCount, error: ordErr } = await supabase
      .from("orders")
      .select("id", { count: "exact", head: true })
      .eq("project_id", params.id)
      .neq("status", "pending")
      .neq("status", "cancelled");

    if (ordErr) return fail("ORDER_QUERY_FAILED", ordErr.message, 500);
    if ((paidCount ?? 0) > 0) {
      return fail(
        "HAS_PAID_ORDERS",
        "결제 완료된 주문이 있는 포토북은 삭제할 수 없습니다.",
        409,
      );
    }

    // pages 삭제
    const { error: pagesErr } = await supabase
      .from("pages")
      .delete()
      .eq("project_id", params.id);
    if (pagesErr) return fail("PAGES_DELETE_FAILED", pagesErr.message, 500);

    // photos 삭제 (storage 키는 별도 cron 처리)
    const { error: photosErr } = await supabase
      .from("photos")
      .delete()
      .eq("project_id", params.id);
    if (photosErr) return fail("PHOTOS_DELETE_FAILED", photosErr.message, 500);

    // project 삭제
    const { error: projErr } = await supabase
      .from("projects")
      .delete()
      .eq("id", params.id);
    if (projErr) return fail("PROJECT_DELETE_FAILED", projErr.message, 500);

    return ok({ deleted: true });
  } catch (err) {
    return failFromError(err);
  }
}

/**
 * PATCH /api/projects/[id]
 *   body: { title?, bookSizeId? }
 */
export async function PATCH(req: Request, { params }: RouteCtx) {
  try {
    const user = await requireUser();

    const raw = (await req.json().catch(() => ({}))) as unknown;
    const parsed = PatchSchema.safeParse(raw ?? {});
    if (!parsed.success) {
      return fail("INVALID_BODY", "요청 본문이 올바르지 않습니다.", 400, parsed.error.flatten());
    }

    const supabase = createServerSupabase();

    // 소유권 선검증 (RLS도 2차 방어)
    const { data: existing, error: selErr } = await supabase
      .from("projects")
      .select("id, user_id")
      .eq("id", params.id)
      .maybeSingle();

    if (selErr) return fail("PROJECT_QUERY_FAILED", selErr.message, 500);
    if (!existing) return fail("NOT_FOUND", "프로젝트를 찾을 수 없습니다.", 404);
    if (existing.user_id !== user.id) {
      return fail("FORBIDDEN", "해당 프로젝트에 대한 권한이 없습니다.", 403);
    }

    const patch: Record<string, unknown> = {};
    if (parsed.data.title !== undefined) patch.title = parsed.data.title;
    if (parsed.data.bookSizeId !== undefined) patch.book_size_id = parsed.data.bookSizeId;

    const { data: updated, error: updErr } = await supabase
      .from("projects")
      .update(patch)
      .eq("id", params.id)
      .select("id, title, status, book_size_id")
      .single();

    if (updErr || !updated) {
      return fail("PROJECT_UPDATE_FAILED", updErr?.message ?? "수정 실패", 500);
    }

    return ok({
      id: updated.id,
      title: updated.title,
      status: updated.status,
      bookSizeId: updated.book_size_id,
    });
  } catch (err) {
    return failFromError(err);
  }
}

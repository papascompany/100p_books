import "server-only";

import { z } from "zod";

import { fail, failFromError, ok } from "@/app/api/_lib/response";
import { requireUser } from "@/lib/auth/session";
import { createAdminSupabase } from "@/lib/db/admin";
import { createServerSupabase } from "@/lib/db/server";
import { ORIGINALS_BUCKET, THUMBS_BUCKET } from "@/lib/image/constants";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const BodySchema = z.object({
  photoIds: z.array(z.string().uuid()).min(1).max(200),
});

/**
 * POST /api/photos/purge
 *   body: { photoIds: uuid[] }
 *
 * 동작: 휴지통(deleted_at IS NOT NULL) 사진을 영구 삭제.
 *  - storage 객체 (원본 + 썸네일) 삭제
 *  - photos 테이블 행 삭제
 *
 * 본인 프로젝트의 사진만 허용. active(=null) 사진은 거부 (먼저 trash 호출 필요).
 */
export async function POST(req: Request) {
  try {
    const user = await requireUser();

    const raw = (await req.json().catch(() => ({}))) as unknown;
    const parsed = BodySchema.safeParse(raw);
    if (!parsed.success) {
      return fail(
        "INVALID_BODY",
        "요청 본문이 올바르지 않습니다.",
        400,
        parsed.error.flatten(),
      );
    }
    const { photoIds } = parsed.data;

    const supabase = createServerSupabase();

    // 1) 휴지통 사진 + 소유권
    const { data: rows, error: selErr } = await supabase
      .from("photos")
      .select("id, project_id, storage_key, thumb_key, deleted_at")
      .in("id", photoIds)
      .not("deleted_at", "is", null);
    if (selErr) return fail("PHOTOS_QUERY_FAILED", selErr.message, 500);

    const found = rows ?? [];
    if (found.length === 0) {
      return ok({ deleted: 0, skipped: photoIds.length });
    }

    const projectIds = Array.from(new Set(found.map((r) => r.project_id)));
    const { data: ownerRows, error: ocErr } = await supabase
      .from("projects")
      .select("id, user_id")
      .in("id", projectIds);
    if (ocErr) return fail("PROJECT_QUERY_FAILED", ocErr.message, 500);
    const allOwned = (ownerRows ?? []).every((p) => p.user_id === user.id);
    if (!allOwned || (ownerRows ?? []).length !== projectIds.length) {
      return fail("FORBIDDEN", "사진에 대한 권한이 없습니다.", 403);
    }

    const admin = createAdminSupabase();

    // 2) Storage 객체 일괄 삭제 (best-effort — 실패해도 DB 삭제 진행)
    const originalKeys = found.map((r) => r.storage_key);
    const thumbKeys = found
      .map((r) => r.thumb_key)
      .filter((k): k is string => Boolean(k));

    if (originalKeys.length > 0) {
      await admin.storage.from(ORIGINALS_BUCKET).remove(originalKeys);
    }
    if (thumbKeys.length > 0) {
      await admin.storage.from(THUMBS_BUCKET).remove(thumbKeys);
    }

    // 3) DB 행 삭제
    const idsToDelete = found.map((r) => r.id);
    const { error: delErr, data: deleted } = await admin
      .from("photos")
      .delete()
      .in("id", idsToDelete)
      .select("id");
    if (delErr) return fail("PHOTO_PURGE_FAILED", delErr.message, 500);

    return ok({
      deleted: deleted?.length ?? 0,
      skipped: photoIds.length - (deleted?.length ?? 0),
    });
  } catch (err) {
    return failFromError(err);
  }
}

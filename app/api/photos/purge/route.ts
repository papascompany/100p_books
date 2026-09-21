import "server-only";

import { z } from "zod";

import { fail, failFromError, ok } from "@/app/api/_lib/response";
import { requireActiveUser } from "@/lib/auth/session";
import { createAdminSupabase } from "@/lib/db/admin";
import { createServerSupabase } from "@/lib/db/server";

import { removeUnreferencedPhotoObjects } from "./storage-cleanup";

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
 *  - photos 테이블 행 삭제
 *  - storage 객체 (원본 + 썸네일) 삭제 — 본인 폴더(`${userId}/`) 키이고, 행 삭제 뒤에도 다른 photos 행이
 *    참조하지 않는 키만(./storage-cleanup.ts). 선물 수령 복사 실패 폴백으로 발신자 원본을 공유하는 행을
 *    지워도 발신자의 결제 완료 포토북 원본은 남는다. Storage 정리는 best-effort(실패 시 orphan cron).
 *
 * 본인 프로젝트의 사진만 허용. active(=null) 사진은 거부 (먼저 trash 호출 필요).
 * 응답: { deleted, skipped } (Storage 정리 결과는 서버 로그로만).
 */
export async function POST(req: Request) {
  try {
    const user = await requireActiveUser();

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

    const supabase = await createServerSupabase();

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

    // 결제 후 편집 잠금(DEBT-2)은 걸지 않는다 — 휴지통 사진은 PDF 사진 resolver(deleted_at IS NULL)가
    // 이미 제외하므로 영구 삭제해도 인쇄물이 바뀌지 않는다. 막으면 결제한 포토북의 휴지통 사진을 지울 수 없다.
    const admin = createAdminSupabase();

    // 2) DB 행 삭제 — Storage 보다 먼저: 참조 확인에서 방금 지울 행이 참조로 잡히지 않게 하고,
    //    행 삭제가 실패하면 원본을 건드리지 않는다(예전 순서는 원본만 지우고 행이 남을 수 있었다).
    const idsToDelete = found.map((r) => r.id);
    const { error: delErr, data: deleted } = await admin
      .from("photos")
      .delete()
      .in("id", idsToDelete)
      .select("id");
    if (delErr) return fail("PHOTO_PURGE_FAILED", delErr.message, 500);

    // 3) Storage 정리 (best-effort) — 실제로 지운 행만, 본인 폴더 키 + 남은 참조 없는 키만.
    const deletedIds = new Set((deleted ?? []).map((r) => r.id));
    const cleanup = await removeUnreferencedPhotoObjects(
      admin,
      user.id,
      found.filter((r) => deletedIds.has(r.id)),
    );
    if (cleanup.keptKeys > 0 || cleanup.deferred) {
      console.info("[photos/purge] Storage 정리:", cleanup);
    }

    return ok({
      deleted: deleted?.length ?? 0,
      skipped: photoIds.length - (deleted?.length ?? 0),
    });
  } catch (err) {
    return failFromError(err);
  }
}

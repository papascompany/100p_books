import "server-only";

import { z } from "zod";

import { fail, failFromError, ok } from "@/app/api/_lib/response";
import { requireActiveUser } from "@/lib/auth/session";
import { createAdminSupabase } from "@/lib/db/admin";
import { createServerSupabase } from "@/lib/db/server";
import { excludeLockedProjectRows } from "@/lib/orders/edit-lock";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const BodySchema = z.object({
  photoIds: z.array(z.string().uuid()).min(1).max(200),
});

/**
 * POST /api/photos/trash
 *   body: { photoIds: uuid[] }
 *
 * 동작: 본인 프로젝트의 사진들에 대해 deleted_at = now() (소프트 삭제).
 *
 * 결제 후 편집 잠금 (DEBT-2): 결제 이후 주문이 있는 포토북의 사진은 건너뛰고 skippedLocked 로 센다.
 *   요청 사진이 전부 잠긴 포토북 소속이면 409 PROJECT_LOCKED.
 *
 * 페이지/표지 fabric_json 에서 해당 photoId 가 남아있으면 PDF 빌드 시
 * createPhotoResolver 가 deleted_at 필터로 photo not found 를 throw —
 * 빌드 잡 측 try/catch 가 placeholder 처리해야 한다 (이미 render-page 폴백 존재).
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

    const supabase = createServerSupabase();

    // 1) 사진 + 프로젝트 소유권 확인
    const { data: rows, error: selErr } = await supabase
      .from("photos")
      .select("id, project_id, deleted_at")
      .in("id", photoIds)
      .is("deleted_at", null);
    if (selErr) return fail("PHOTOS_QUERY_FAILED", selErr.message, 500);

    const found = rows ?? [];
    if (found.length === 0) {
      return ok({ updated: 0, skipped: photoIds.length });
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

    // 휴지통 사진은 PDF 빌드에서 빠진다 → 결제 이후 포토북의 사진은 옮기지 않는다 (DEBT-2).
    // 라이브러리 전체 선택처럼 여러 포토북이 섞인 배치는 잠긴 포토북 사진만 빼고 처리한다.
    const admin = createAdminSupabase();
    const { editable, skippedLocked } = await excludeLockedProjectRows(admin, found);

    const idsToTrash = editable.map((r) => r.id);

    const { error: upErr, data: updated } = await admin
      .from("photos")
      .update({ deleted_at: new Date().toISOString() })
      .in("id", idsToTrash)
      .select("id");

    if (upErr) return fail("PHOTO_TRASH_FAILED", upErr.message, 500);

    return ok({
      updated: updated?.length ?? 0,
      skipped: photoIds.length - (updated?.length ?? 0),
      skippedLocked,
    });
  } catch (err) {
    return failFromError(err);
  }
}

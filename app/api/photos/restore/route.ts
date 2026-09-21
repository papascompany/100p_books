import "server-only";

import { z } from "zod";

import { fail, failFromError, ok } from "@/app/api/_lib/response";
import { requireActiveUser } from "@/lib/auth/session";
import { createAdminSupabase } from "@/lib/db/admin";
import { createServerSupabase } from "@/lib/db/server";
import { MAX_PHOTOS_PER_PROJECT } from "@/lib/image/constants";
import { excludeLockedProjectRows } from "@/lib/orders/edit-lock";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const BodySchema = z.object({
  photoIds: z.array(z.string().uuid()).min(1).max(200),
});

/**
 * POST /api/photos/restore
 *   body: { photoIds: uuid[] }
 *
 * 동작: 휴지통에서 photoIds 의 deleted_at 을 NULL 로 되돌림.
 *
 * 제약:
 *   - 복원 대상 프로젝트의 active 사진 수가 100장을 넘지 않도록 — 넘는 분은 skip.
 *   - 결제 후 편집 잠금 (DEBT-2): 결제 이후 주문이 있는 포토북의 사진은 skip(skippedLocked).
 *     요청 사진이 전부 잠긴 포토북 소속이면 409 PROJECT_LOCKED.
 *
 * 응답(모든 성공 경로에서 같은 모양): { restored, skipped, skippedQuota, skippedLocked, reason? }
 *   - skipped = 요청 수 - restored. 그 밖의 skipped 는 휴지통에 없거나 없는 사진.
 *   - reason: NOT_IN_TRASH(휴지통 사진 없음) · QUOTA_EXCEEDED(복원 가능한 사진이 모두 한도 초과).
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

    // 1) 휴지통 사진 + 소유권
    const { data: rows, error: selErr } = await supabase
      .from("photos")
      .select("id, project_id, deleted_at")
      .in("id", photoIds)
      .not("deleted_at", "is", null);
    if (selErr) return fail("PHOTOS_QUERY_FAILED", selErr.message, 500);

    const found = rows ?? [];
    if (found.length === 0) {
      return ok({
        restored: 0,
        skipped: photoIds.length,
        skippedQuota: 0,
        skippedLocked: 0,
        reason: "NOT_IN_TRASH",
      });
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

    // 복원하면 PDF 빌드의 사진 resolver(deleted_at IS NULL)가 다시 찾게 돼 인쇄물이 바뀐다 → 잠금 (DEBT-2).
    // 휴지통 전체 선택처럼 여러 포토북이 섞인 배치는 잠긴 포토북 사진만 빼고 처리한다.
    const admin = createAdminSupabase();
    const { editable, skippedLocked } = await excludeLockedProjectRows(admin, found);
    const editableProjectIds = Array.from(new Set(editable.map((r) => r.project_id)));

    // 2) 프로젝트별 quota 검사
    const counts = new Map<string, number>();
    for (const pid of editableProjectIds) {
      const { count } = await supabase
        .from("photos")
        .select("id", { count: "exact", head: true })
        .eq("project_id", pid)
        .is("deleted_at", null);
      counts.set(pid, count ?? 0);
    }

    const idsToRestore: string[] = [];
    let skippedQuota = 0;
    // 결정성 위해 photoIds 입력 순서 유지
    const foundById = new Map(editable.map((r) => [r.id, r]));
    for (const pid of photoIds) {
      const r = foundById.get(pid);
      if (!r) continue;
      const cur = counts.get(r.project_id) ?? 0;
      if (cur >= MAX_PHOTOS_PER_PROJECT) {
        skippedQuota++;
        continue;
      }
      idsToRestore.push(r.id);
      counts.set(r.project_id, cur + 1);
    }

    if (idsToRestore.length === 0) {
      return ok({
        restored: 0,
        skipped: photoIds.length,
        skippedQuota,
        skippedLocked,
        reason: "QUOTA_EXCEEDED",
      });
    }

    const { error: upErr, data: updated } = await admin
      .from("photos")
      .update({ deleted_at: null })
      .in("id", idsToRestore)
      .select("id");
    if (upErr) return fail("PHOTO_RESTORE_FAILED", upErr.message, 500);

    return ok({
      restored: updated?.length ?? 0,
      skipped: photoIds.length - (updated?.length ?? 0),
      skippedQuota,
      skippedLocked,
    });
  } catch (err) {
    return failFromError(err);
  }
}

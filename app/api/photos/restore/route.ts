import "server-only";

import { z } from "zod";

import { fail, failFromError, ok } from "@/app/api/_lib/response";
import { requireUser } from "@/lib/auth/session";
import { createAdminSupabase } from "@/lib/db/admin";
import { createServerSupabase } from "@/lib/db/server";
import { MAX_PHOTOS_PER_PROJECT } from "@/lib/image/constants";

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
      .select("id, project_id, deleted_at")
      .in("id", photoIds)
      .not("deleted_at", "is", null);
    if (selErr) return fail("PHOTOS_QUERY_FAILED", selErr.message, 500);

    const found = rows ?? [];
    if (found.length === 0) {
      return ok({ restored: 0, skipped: photoIds.length, reason: "NOT_IN_TRASH" });
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

    // 2) 프로젝트별 quota 검사
    const counts = new Map<string, number>();
    for (const pid of projectIds) {
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
    const foundById = new Map(found.map((r) => [r.id, r]));
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
        reason: "QUOTA_EXCEEDED",
      });
    }

    const admin = createAdminSupabase();
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
    });
  } catch (err) {
    return failFromError(err);
  }
}

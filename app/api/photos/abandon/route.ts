import "server-only";

import { z } from "zod";

import { fail, failFromError, ok } from "@/app/api/_lib/response";
import { requireUser } from "@/lib/auth/session";
import { createAdminSupabase } from "@/lib/db/admin";
import { createServerSupabase } from "@/lib/db/server";
import { ORIGINALS_BUCKET, THUMBS_BUCKET } from "@/lib/image/constants";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

const BodySchema = z.object({
  projectId: z.string().uuid(),
  storageKeys: z.array(z.string().min(1).max(512)).min(1).max(200),
});

/**
 * POST /api/photos/abandon
 *   body: { projectId, storageKeys[] }
 *
 * 업로드(PUT)는 끝났지만 `/api/photos/complete` 로 확정되지 않은 storage 객체를 지운다.
 * 사용자가 업로드 도중 사진을 삭제하거나 업로드를 취소하면, 그 객체는 참조하는
 * photos 행이 없어 영구히 남는다(= 고아). 그 즉시 회수하는 경로다.
 *
 * 안전장치:
 *  - 프로젝트 소유권 확인.
 *  - key 가 `${userId}/${projectId}/` 접두사인지 재검증 — 남의 파일 삭제 차단.
 *  - **photos 행이 존재하는 key 는 건드리지 않는다.** 확정된 사진 삭제는 휴지통 경로의 몫이고,
 *    여기서 지우면 DB 행만 남고 파일이 사라지는 더 나쁜 상태가 된다.
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
    const { projectId, storageKeys } = parsed.data;

    const supabase = createServerSupabase();
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

    const expectedPrefix = `${user.id}/${projectId}/`;
    const candidates = Array.from(
      new Set(storageKeys.filter((k) => k.startsWith(expectedPrefix))),
    );
    if (candidates.length === 0) {
      return ok({ deleted: 0, skipped: storageKeys.length });
    }

    // 확정된 사진의 key 는 제외
    const { data: existing, error: exErr } = await supabase
      .from("photos")
      .select("storage_key")
      .in("storage_key", candidates);
    if (exErr) return fail("PHOTOS_QUERY_FAILED", exErr.message, 500);
    const committed = new Set((existing ?? []).map((r) => r.storage_key));

    const keys = candidates.filter((k) => !committed.has(k));
    if (keys.length === 0) {
      return ok({ deleted: 0, skipped: storageKeys.length });
    }

    const admin = createAdminSupabase();
    // 썸네일 key 는 complete 단계에서 `.webp` 로 만들어진다 (아직 없을 수도 있음 — 무해).
    const thumbKeys = keys.map((k) => k.replace(/\.[^.]+$/, ".webp"));

    await admin.storage.from(ORIGINALS_BUCKET).remove(keys);
    await admin.storage.from(THUMBS_BUCKET).remove(thumbKeys);

    return ok({ deleted: keys.length, skipped: storageKeys.length - keys.length });
  } catch (err) {
    return failFromError(err);
  }
}

import { randomUUID } from "node:crypto";

import { z } from "zod";

import { fail, failFromError, ok } from "@/app/api/_lib/response";
import { requireUser } from "@/lib/auth/session";
import { createAdminSupabase } from "@/lib/db/admin";
import { createServerSupabase } from "@/lib/db/server";
import {
  MAX_FILE_BYTES,
  MAX_PHOTOS_PER_PROJECT,
  ORIGINALS_BUCKET,
  extForMime,
} from "@/lib/image/constants";
import { validateFile } from "@/lib/image/validate";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const FileMetaSchema = z.object({
  filename: z.string().min(1).max(255),
  mime: z.string().min(1).max(80),
  size: z.number().int().positive().max(MAX_FILE_BYTES),
});

const BodySchema = z.object({
  projectId: z.string().uuid(),
  files: z
    .array(FileMetaSchema)
    .min(1, "파일이 없습니다.")
    .max(MAX_PHOTOS_PER_PROJECT, `한 번에 최대 ${MAX_PHOTOS_PER_PROJECT}장까지 업로드할 수 있습니다.`),
});

/**
 * POST /api/photos/sign-upload
 *   body: { projectId, files: [{ filename, mime, size }] }
 *   각 파일마다 Storage 서명 업로드 URL 생성.
 *   DB INSERT 는 /api/photos/complete 에서 처리.
 */
export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const raw = (await req.json().catch(() => ({}))) as unknown;
    const parsed = BodySchema.safeParse(raw);
    if (!parsed.success) {
      return fail("INVALID_BODY", "요청 본문이 올바르지 않습니다.", 400, parsed.error.flatten());
    }

    const { projectId, files } = parsed.data;

    // 각 파일 기본 검증 (MIME / 크기)
    for (const f of files) {
      const msg = validateFile({ name: f.filename, type: f.mime, size: f.size });
      if (msg) {
        return fail("INVALID_FILE", `${f.filename}: ${msg}`, 400);
      }
    }

    // 프로젝트 소유권 확인
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

    // 현재 사진 수 + 요청 배치가 100장 넘지 않는지 (active 만 카운트)
    const { count: existingCount, error: countErr } = await supabase
      .from("photos")
      .select("id", { count: "exact", head: true })
      .eq("project_id", projectId)
      .is("deleted_at", null);

    if (countErr) return fail("PHOTO_COUNT_FAILED", countErr.message, 500);

    if ((existingCount ?? 0) + files.length > MAX_PHOTOS_PER_PROJECT) {
      return fail(
        "QUOTA_EXCEEDED",
        `한 프로젝트에는 최대 ${MAX_PHOTOS_PER_PROJECT}장까지 업로드할 수 있습니다.`,
        400,
      );
    }

    // 서명 URL 생성은 service_role 사용 (createSignedUploadUrl)
    const admin = createAdminSupabase();

    const results: Array<{ photoId: string; uploadUrl: string; storageKey: string; token: string }> = [];

    for (const f of files) {
      const photoId = randomUUID();
      // HEIC 는 클라에서 JPEG 변환 후 업로드되지만, 현 MIME 기준으로 ext 를 정함.
      // (클라가 변환했다면 mime=image/jpeg 로 바뀌어 호출)
      const ext = extForMime(f.mime.toLowerCase());
      const storageKey = `${user.id}/${projectId}/${photoId}.${ext}`;

      const { data, error } = await admin.storage
        .from(ORIGINALS_BUCKET)
        .createSignedUploadUrl(storageKey);

      if (error || !data) {
        return fail("SIGN_URL_FAILED", error?.message ?? "서명 URL 생성 실패", 500);
      }

      results.push({
        photoId,
        uploadUrl: data.signedUrl,
        storageKey,
        token: data.token,
      });
    }

    return ok(results);
  } catch (err) {
    return failFromError(err);
  }
}

import "server-only";

import { z } from "zod";

import { fail, failFromError, ok } from "@/app/api/_lib/response";
import { requireUser } from "@/lib/auth/session";
import { createAdminSupabase } from "@/lib/db/admin";
import { createServerSupabase } from "@/lib/db/server";
import { THUMBS_BUCKET } from "@/lib/image/constants";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const THUMB_SIGNED_TTL_SEC = 3600;

const QuerySchema = z.object({
  /** scope=project — 해당 projectId 의 active 사진만. */
  /** scope=library — 사용자의 모든 active 사진 (전 프로젝트). */
  scope: z.enum(["project", "library"]).default("project"),
  projectId: z.string().uuid().optional(),
});

interface PhotoListItem {
  id: string;
  projectId: string;
  projectTitle: string;
  filename: string | null;
  thumbUrl: string | null;
  exifTakenAt: string | null;
  createdAt: string;
}

/**
 * GET /api/photos/list?scope=project&projectId=...
 * GET /api/photos/list?scope=library
 *
 * 사용처: 편집기 PhotoPickerDialog (현재 프로젝트 / 라이브러리 전체).
 *
 * 응답: { photos: PhotoListItem[] }
 */
export async function GET(req: Request) {
  try {
    const user = await requireUser();
    const url = new URL(req.url);
    const parsed = QuerySchema.safeParse({
      scope: url.searchParams.get("scope") ?? undefined,
      projectId: url.searchParams.get("projectId") ?? undefined,
    });
    if (!parsed.success) {
      return fail(
        "INVALID_QUERY",
        "쿼리 파라미터가 올바르지 않습니다.",
        400,
        parsed.error.flatten(),
      );
    }
    const { scope, projectId } = parsed.data;

    const supabase = createServerSupabase();

    let projectIds: string[];
    const projectMap = new Map<string, string>();

    if (scope === "project") {
      if (!projectId) {
        return fail(
          "PROJECT_REQUIRED",
          "scope=project 일 때 projectId 가 필요합니다.",
          400,
        );
      }
      const { data: proj } = await supabase
        .from("projects")
        .select("id, user_id, title")
        .eq("id", projectId)
        .maybeSingle();
      if (!proj) return fail("NOT_FOUND", "프로젝트를 찾을 수 없습니다.", 404);
      if (proj.user_id !== user.id) {
        return fail("FORBIDDEN", "프로젝트 권한이 없습니다.", 403);
      }
      projectIds = [proj.id];
      projectMap.set(proj.id, proj.title ?? "Untitled");
    } else {
      const { data: rows } = await supabase
        .from("projects")
        .select("id, title")
        .eq("user_id", user.id);
      const projects = rows ?? [];
      projectIds = projects.map((p) => p.id);
      for (const p of projects) {
        projectMap.set(p.id, p.title ?? "Untitled");
      }
    }

    if (projectIds.length === 0) {
      return ok({ photos: [] });
    }

    const { data: rows, error } = await supabase
      .from("photos")
      .select(
        "id, project_id, thumb_key, filename, exif_taken_at, created_at, order_idx",
      )
      .in("project_id", projectIds)
      .is("deleted_at", null)
      .order("order_idx", { ascending: true });

    if (error) return fail("PHOTOS_QUERY_FAILED", error.message, 500);

    const photoRows = rows ?? [];

    // signed URLs
    const paths: string[] = [];
    const idByKey = new Map<string, string>();
    for (const r of photoRows) {
      if (r.thumb_key) {
        paths.push(r.thumb_key);
        idByKey.set(r.thumb_key, r.id);
      }
    }
    const urlByPhotoId: Record<string, string> = {};
    if (paths.length > 0) {
      const admin = createAdminSupabase();
      const CHUNK = 200;
      for (let i = 0; i < paths.length; i += CHUNK) {
        const slice = paths.slice(i, i + CHUNK);
        const { data: signed, error: signErr } = await admin.storage
          .from(THUMBS_BUCKET)
          .createSignedUrls(slice, THUMB_SIGNED_TTL_SEC);
        if (signErr) return fail("SIGN_URL_FAILED", signErr.message, 500);
        for (const item of signed ?? []) {
          if (item.path && item.signedUrl) {
            const pid = idByKey.get(item.path);
            if (pid) urlByPhotoId[pid] = item.signedUrl;
          }
        }
      }
    }

    const photos: PhotoListItem[] = photoRows.map((r) => ({
      id: r.id,
      projectId: r.project_id,
      projectTitle: projectMap.get(r.project_id) ?? "Untitled",
      filename: r.filename,
      thumbUrl: urlByPhotoId[r.id] ?? null,
      exifTakenAt: r.exif_taken_at,
      createdAt: r.created_at,
    }));

    return ok({ photos });
  } catch (err) {
    return failFromError(err);
  }
}

import "server-only";

import { z } from "zod";

import { fail, failFromError, ok } from "@/app/api/_lib/response";
import { requireUser } from "@/lib/auth/session";
import { createAdminSupabase } from "@/lib/db/admin";
import { createServerSupabase } from "@/lib/db/server";
import { THUMBS_BUCKET } from "@/lib/image/constants";
import type { PageDoc } from "@/lib/layout/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const QuerySchema = z.object({
  projectId: z.string().uuid(),
});

/** 썸네일 signed URL TTL — 1시간. 프리뷰용이므로 충분. */
const THUMB_SIGNED_TTL_SEC = 3600;

interface PageRow {
  id: string;
  page_no: number;
  layout_mode: "polaroid" | "collage";
  fabric_json: Record<string, unknown> | null;
}

/**
 * GET /api/pages?projectId=
 *   응답: { pages: [{id, pageNo, layoutMode, fabricJson: PageDoc}], photoUrls: {[photoId]: signedUrl} }
 *
 * photoUrls: 전 페이지에서 참조되는 photo id 집합을 수집해 thumb_key 의 signed URL 을
 *            배치(createSignedUrls) 단일 호출로 생성.
 */
export async function GET(req: Request) {
  try {
    const user = await requireUser();

    const url = new URL(req.url);
    const parsed = QuerySchema.safeParse({
      projectId: url.searchParams.get("projectId"),
    });
    if (!parsed.success) {
      return fail("INVALID_QUERY", "projectId 쿼리 파라미터가 필요합니다.", 400);
    }
    const { projectId } = parsed.data;

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

    // 페이지 목록
    const { data: rows, error: pagesErr } = await supabase
      .from("pages")
      .select("id, page_no, layout_mode, fabric_json")
      .eq("project_id", projectId)
      .order("page_no", { ascending: true });
    if (pagesErr) return fail("PAGES_QUERY_FAILED", pagesErr.message, 500);

    const pageRows = (rows ?? []) as PageRow[];

    // 참조된 photoId 수집
    const photoIdSet = new Set<string>();
    for (const r of pageRows) {
      const doc = r.fabric_json as PageDoc | null;
      if (!doc || !Array.isArray(doc.objects)) continue;
      for (const obj of doc.objects) {
        if (obj && typeof obj === "object" && "type" in obj && obj.type === "photo") {
          photoIdSet.add((obj as { photoId: string }).photoId);
        }
      }
    }

    // photos.thumb_key 매핑
    const photoUrls: Record<string, string> = {};
    if (photoIdSet.size > 0) {
      const { data: photos, error: photosErr } = await supabase
        .from("photos")
        .select("id, thumb_key, storage_key")
        .eq("project_id", projectId)
        .in("id", Array.from(photoIdSet));
      if (photosErr) return fail("PHOTOS_QUERY_FAILED", photosErr.message, 500);

      const idByKey = new Map<string, string>(); // path → photoId
      const paths: string[] = [];
      for (const p of photos ?? []) {
        const key = p.thumb_key;
        if (key) {
          idByKey.set(key, p.id);
          paths.push(key);
        }
      }

      if (paths.length > 0) {
        const admin = createAdminSupabase();
        const { data: signed, error: signErr } = await admin.storage
          .from(THUMBS_BUCKET)
          .createSignedUrls(paths, THUMB_SIGNED_TTL_SEC);
        if (signErr) return fail("SIGN_URL_FAILED", signErr.message, 500);

        for (const item of signed ?? []) {
          if (item.path && item.signedUrl) {
            const pid = idByKey.get(item.path);
            if (pid) photoUrls[pid] = item.signedUrl;
          }
        }
      }
    }

    return ok({
      pages: pageRows.map((r) => ({
        id: r.id,
        pageNo: r.page_no,
        layoutMode: r.layout_mode,
        fabricJson: r.fabric_json as PageDoc | null,
      })),
      photoUrls,
    });
  } catch (err) {
    return failFromError(err);
  }
}

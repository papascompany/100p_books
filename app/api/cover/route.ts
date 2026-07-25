import "server-only";

import { z } from "zod";

import { fail, failFromError, ok } from "@/app/api/_lib/response";
import { trackFunnelEvent } from "@/lib/analytics/funnel";
import { requireUser } from "@/lib/auth/session";
import { createAdminSupabase } from "@/lib/db/admin";
import { createServerSupabase } from "@/lib/db/server";
import type { BookSize } from "@/lib/db/types";
import { THUMBS_BUCKET } from "@/lib/image/constants";
import { buildDefaultCoverDoc } from "@/lib/layout/cover";
import { isPageDoc, type PageDoc } from "@/lib/layout/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const THUMB_SIGNED_TTL_SEC = 3600;

const QuerySchema = z.object({
  projectId: z.string().uuid(),
});

const PatchSchema = z.object({
  projectId: z.string().uuid(),
  fabricJson: z.unknown(),
});

/**
 * GET /api/cover?projectId=
 *   응답:
 *     {
 *       coverJson: PageDoc | null,    // 저장된 cover_json (없으면 default 빌드 결과)
 *       isDefault: boolean,           // true 면 위 coverJson 은 즉시 만든 기본값(아직 저장 안 됨)
 *       bookSize: BookSize,
 *       pageCount: number,
 *       photoUrls: { [photoId]: signedUrl }
 *     }
 *
 * cover_json 이 비어있으면 buildDefaultCoverDoc() 결과를 즉시 반환 (DB 저장은 안 함).
 * 사용자가 저장 시 PATCH 로 INSERT 된다.
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

    const { data: project, error: projErr } = await supabase
      .from("projects")
      .select("id, user_id, book_size_id, title, cover_json")
      .eq("id", projectId)
      .maybeSingle();
    if (projErr) return fail("PROJECT_QUERY_FAILED", projErr.message, 500);
    if (!project) return fail("NOT_FOUND", "프로젝트를 찾을 수 없습니다.", 404);
    if (project.user_id !== user.id) {
      return fail("FORBIDDEN", "해당 프로젝트에 대한 권한이 없습니다.", 403);
    }

    const { data: size, error: sizeErr } = await supabase
      .from("book_sizes")
      .select(
        "id, name, width_mm, height_mm, cover_width_mm, cover_height_mm, spine_formula_per_page, active, display_order, created_at",
      )
      .eq("id", project.book_size_id)
      .maybeSingle();
    if (sizeErr) return fail("BOOK_SIZE_QUERY_FAILED", sizeErr.message, 500);
    if (!size) return fail("NOT_FOUND", "책 사이즈를 찾을 수 없습니다.", 404);
    const bookSize: BookSize = size;

    const { count: pageCount } = await supabase
      .from("pages")
      .select("id", { count: "exact", head: true })
      .eq("project_id", projectId);

    let coverJson = project.cover_json as PageDoc | null;
    let isDefault = false;
    if (!coverJson || !isPageDoc(coverJson) || coverJson.layoutMode !== "cover") {
      coverJson = buildDefaultCoverDoc({
        bookSize,
        pageCount: pageCount ?? 0,
        title: project.title ?? "Untitled",
      });
      isDefault = true;
    }

    // 참조 photoId → thumb signed URL
    const photoIdSet = new Set<string>();
    if (coverJson.backgroundImage?.photoId) {
      photoIdSet.add(coverJson.backgroundImage.photoId);
    }
    for (const obj of coverJson.objects) {
      if (obj.type === "photo" && obj.photoId) photoIdSet.add(obj.photoId);
    }

    // 추가로 프로젝트의 사진 일부 (사용자가 표지에 추가할 수 있도록 — 최근 12장).
    const { data: morePhotos } = await supabase
      .from("photos")
      .select("id, thumb_key")
      .eq("project_id", projectId)
      .is("deleted_at", null)
      .order("order_idx", { ascending: true })
      .limit(48);
    for (const p of morePhotos ?? []) {
      photoIdSet.add(p.id);
    }

    const photoUrls: Record<string, string> = {};
    if (photoIdSet.size > 0) {
      const { data: photos, error: photosErr } = await supabase
        .from("photos")
        .select("id, thumb_key")
        .eq("project_id", projectId)
        .is("deleted_at", null)
        .in("id", Array.from(photoIdSet));
      if (photosErr) return fail("PHOTOS_QUERY_FAILED", photosErr.message, 500);

      const idByKey = new Map<string, string>();
      const paths: string[] = [];
      for (const p of photos ?? []) {
        if (p.thumb_key) {
          idByKey.set(p.thumb_key, p.id);
          paths.push(p.thumb_key);
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
      coverJson,
      isDefault,
      bookSize,
      pageCount: pageCount ?? 0,
      photoUrls,
    });
  } catch (err) {
    return failFromError(err);
  }
}

/**
 * PATCH /api/cover
 *   body: { projectId, fabricJson: PageDoc }
 *
 * 검증:
 *   1. 로그인 + 소유권.
 *   2. isPageDoc + layoutMode === "cover".
 *   3. bookSizeId 일치.
 */
export async function PATCH(req: Request) {
  try {
    const user = await requireUser();

    const raw = (await req.json().catch(() => ({}))) as unknown;
    const parsed = PatchSchema.safeParse(raw ?? {});
    if (!parsed.success) {
      return fail(
        "INVALID_BODY",
        "요청 본문이 올바르지 않습니다.",
        400,
        parsed.error.flatten(),
      );
    }
    const { projectId, fabricJson } = parsed.data;

    if (!isPageDoc(fabricJson)) {
      return fail(
        "INVALID_BODY",
        "fabricJson 이 PageDoc 스키마를 만족하지 않습니다.",
        400,
      );
    }
    if (fabricJson.layoutMode !== "cover") {
      return fail(
        "INVALID_LAYOUT_MODE",
        "표지 PageDoc 은 layoutMode === 'cover' 이어야 합니다.",
        400,
      );
    }

    const supabase = createServerSupabase();

    const { data: project, error: projErr } = await supabase
      .from("projects")
      .select("id, user_id, book_size_id")
      .eq("id", projectId)
      .maybeSingle();
    if (projErr) return fail("PROJECT_QUERY_FAILED", projErr.message, 500);
    if (!project) return fail("NOT_FOUND", "프로젝트를 찾을 수 없습니다.", 404);
    if (project.user_id !== user.id) {
      return fail("FORBIDDEN", "해당 프로젝트에 대한 권한이 없습니다.", 403);
    }
    if (fabricJson.bookSizeId !== project.book_size_id) {
      return fail(
        "BOOK_SIZE_MISMATCH",
        "PageDoc.bookSizeId 가 프로젝트의 책 사이즈와 일치하지 않습니다.",
        400,
      );
    }

    // photoId 일관성 — cover_json 이 참조하는 photo 가 모두 active 인지 확인.
    const referencedPhotoIds = new Set<string>();
    for (const obj of fabricJson.objects) {
      if (obj.type === "photo" && obj.photoId) {
        referencedPhotoIds.add(obj.photoId);
      }
    }
    if (fabricJson.backgroundImage?.photoId) {
      referencedPhotoIds.add(fabricJson.backgroundImage.photoId);
    }
    if (referencedPhotoIds.size > 0) {
      const { data: validPhotos, error: phErr } = await supabase
        .from("photos")
        .select("id")
        .eq("project_id", projectId)
        .is("deleted_at", null)
        .in("id", Array.from(referencedPhotoIds));
      if (phErr) return fail("PHOTOS_QUERY_FAILED", phErr.message, 500);
      const validSet = new Set((validPhotos ?? []).map((p) => p.id));
      const missing = Array.from(referencedPhotoIds).filter(
        (id) => !validSet.has(id),
      );
      if (missing.length > 0) {
        return fail(
          "INVALID_PHOTO_REF",
          `cover_json 이 참조하는 사진이 프로젝트에 없거나 휴지통입니다: ${missing.join(", ")}`,
          400,
          { missing },
        );
      }
    }

    const { data: updated, error: upErr } = await supabase
      .from("projects")
      .update({
        cover_json: fabricJson as unknown as Record<string, unknown>,
      })
      .eq("id", projectId)
      .select("id, cover_json, updated_at")
      .single();
    if (upErr || !updated) {
      return fail(
        "COVER_UPDATE_FAILED",
        upErr?.message ?? "표지 저장에 실패했습니다.",
        500,
      );
    }

    // 퍼널 계측: 표지 저장 = 책 완성 시점 (S1-2).
    await trackFunnelEvent({
      event: "book_completed",
      userId: user.id,
      projectId,
    });

    return ok({
      id: updated.id,
      coverJson: updated.cover_json,
      updatedAt: updated.updated_at,
    });
  } catch (err) {
    return failFromError(err);
  }
}

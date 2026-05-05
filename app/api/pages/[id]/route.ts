import "server-only";

import { fail, failFromError, ok } from "@/app/api/_lib/response";
import { requireUser } from "@/lib/auth/session";
import { createAdminSupabase } from "@/lib/db/admin";
import { createServerSupabase } from "@/lib/db/server";
import { THUMBS_BUCKET } from "@/lib/image/constants";
import { isPageDoc, type PageDoc } from "@/lib/layout/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const THUMB_SIGNED_TTL_SEC = 3600;

interface Params {
  params: { id: string };
}

/**
 * GET /api/pages/[id]
 *   응답: { id, pageNo, layoutMode, fabricJson, photoUrls }
 *
 *   해당 페이지가 참조하는 photoId 들의 thumb signed URL 을 일괄 발급한다
 *   (signedUrl 만료 시 클라가 재요청하는 url-refresher 의 백엔드).
 */
export async function GET(_req: Request, { params }: Params) {
  try {
    const user = await requireUser();
    const pageId = params.id;
    if (!pageId) return fail("INVALID_PARAM", "잘못된 페이지 ID 입니다.", 400);

    const supabase = createServerSupabase();

    const { data: row, error } = await supabase
      .from("pages")
      .select("id, project_id, page_no, layout_mode, fabric_json, updated_at")
      .eq("id", pageId)
      .maybeSingle();
    if (error) return fail("PAGE_QUERY_FAILED", error.message, 500);
    if (!row) return fail("NOT_FOUND", "페이지를 찾을 수 없습니다.", 404);

    // 소유권: project.user_id 확인
    const { data: project, error: projErr } = await supabase
      .from("projects")
      .select("id, user_id")
      .eq("id", row.project_id)
      .maybeSingle();
    if (projErr) return fail("PROJECT_QUERY_FAILED", projErr.message, 500);
    if (!project) return fail("NOT_FOUND", "프로젝트를 찾을 수 없습니다.", 404);
    if (project.user_id !== user.id) {
      return fail("FORBIDDEN", "해당 페이지에 대한 권한이 없습니다.", 403);
    }

    // 참조된 photoId 수집 → thumb signed URL
    const doc = (row.fabric_json as PageDoc | null) ?? null;
    const photoIdSet = new Set<string>();
    if (doc && Array.isArray(doc.objects)) {
      for (const obj of doc.objects) {
        if (
          obj &&
          typeof obj === "object" &&
          "type" in obj &&
          obj.type === "photo"
        ) {
          photoIdSet.add((obj as { photoId: string }).photoId);
        }
      }
    }

    const photoUrls: Record<string, string> = {};
    if (photoIdSet.size > 0) {
      const { data: photos, error: photosErr } = await supabase
        .from("photos")
        .select("id, thumb_key")
        .eq("project_id", row.project_id)
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
      id: row.id,
      projectId: row.project_id,
      pageNo: row.page_no,
      layoutMode: row.layout_mode,
      fabricJson: doc,
      updatedAt: row.updated_at,
      photoUrls,
    });
  } catch (err) {
    return failFromError(err);
  }
}

interface PatchBody {
  fabricJson?: unknown;
}

/**
 * PATCH /api/pages/[id]
 *   body: { fabricJson: PageDoc }
 *
 * 검증:
 *   1. 로그인.
 *   2. page → project 소유권 확인.
 *   3. isPageDoc() 가드 통과.
 *   4. fabricJson.bookSizeId / pageNo 가 DB 와 일치하는지 확인 (실수 방지).
 */
export async function PATCH(req: Request, { params }: Params) {
  try {
    const user = await requireUser();
    const pageId = params.id;
    if (!pageId) return fail("INVALID_PARAM", "잘못된 페이지 ID 입니다.", 400);

    const raw = (await req.json().catch(() => ({}))) as PatchBody;
    if (!isPageDoc(raw.fabricJson)) {
      return fail(
        "INVALID_BODY",
        "fabricJson 이 PageDoc 스키마를 만족하지 않습니다.",
        400,
      );
    }
    const doc = raw.fabricJson;

    const supabase = createServerSupabase();
    const { data: row, error } = await supabase
      .from("pages")
      .select("id, project_id, page_no")
      .eq("id", pageId)
      .maybeSingle();
    if (error) return fail("PAGE_QUERY_FAILED", error.message, 500);
    if (!row) return fail("NOT_FOUND", "페이지를 찾을 수 없습니다.", 404);

    const { data: project, error: projErr } = await supabase
      .from("projects")
      .select("id, user_id, book_size_id")
      .eq("id", row.project_id)
      .maybeSingle();
    if (projErr) return fail("PROJECT_QUERY_FAILED", projErr.message, 500);
    if (!project) return fail("NOT_FOUND", "프로젝트를 찾을 수 없습니다.", 404);
    if (project.user_id !== user.id) {
      return fail("FORBIDDEN", "해당 페이지에 대한 권한이 없습니다.", 403);
    }

    if (doc.bookSizeId !== project.book_size_id) {
      return fail(
        "BOOK_SIZE_MISMATCH",
        "PageDoc.bookSizeId 가 프로젝트의 책 사이즈와 일치하지 않습니다.",
        400,
      );
    }
    if (doc.pageNo !== row.page_no) {
      return fail(
        "PAGE_NO_MISMATCH",
        "PageDoc.pageNo 가 DB pages.page_no 와 일치하지 않습니다.",
        400,
      );
    }

    // photoId 일관성 — PageDoc 가 참조하는 photo 가 모두 같은 프로젝트 + 휴지통 아닌지 확인.
    const referencedPhotoIds = new Set<string>();
    for (const obj of doc.objects) {
      if (obj.type === "photo" && obj.photoId) {
        referencedPhotoIds.add(obj.photoId);
      }
    }
    if (doc.backgroundImage?.photoId) {
      referencedPhotoIds.add(doc.backgroundImage.photoId);
    }
    if (referencedPhotoIds.size > 0) {
      const { data: validPhotos, error: phErr } = await supabase
        .from("photos")
        .select("id")
        .eq("project_id", row.project_id)
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
          `PageDoc 가 참조하는 사진이 프로젝트에 없거나 휴지통입니다: ${missing.join(", ")}`,
          400,
          { missing },
        );
      }
    }

    const { data: updated, error: upErr } = await supabase
      .from("pages")
      .update({
        fabric_json: doc as unknown as Record<string, unknown>,
      })
      .eq("id", pageId)
      .select("id, page_no, fabric_json, updated_at")
      .single();
    if (upErr || !updated) {
      return fail(
        "PAGE_UPDATE_FAILED",
        upErr?.message ?? "페이지 저장에 실패했습니다.",
        500,
      );
    }

    return ok({
      id: updated.id,
      pageNo: updated.page_no,
      fabricJson: updated.fabric_json,
      updatedAt: updated.updated_at,
    });
  } catch (err) {
    return failFromError(err);
  }
}

/**
 * DELETE /api/pages/[id]
 *
 * 검증:
 *   1. 로그인.
 *   2. page → project 소유권 확인.
 *
 * 처리:
 *   - DELETE FROM pages WHERE id = ?
 *   - 후속 페이지들 page_no -= 1 (shift_pages_after RPC, p_shift=-1)
 *
 * 응답: { ok, pageCount }
 */
export async function DELETE(_req: Request, { params }: Params) {
  try {
    const user = await requireUser();
    const pageId = params.id;
    if (!pageId) return fail("INVALID_PARAM", "잘못된 페이지 ID 입니다.", 400);

    const supabase = createServerSupabase();

    const { data: row, error } = await supabase
      .from("pages")
      .select("id, project_id, page_no")
      .eq("id", pageId)
      .maybeSingle();
    if (error) return fail("PAGE_QUERY_FAILED", error.message, 500);
    if (!row) return fail("NOT_FOUND", "페이지를 찾을 수 없습니다.", 404);

    const { data: project, error: projErr } = await supabase
      .from("projects")
      .select("id, user_id")
      .eq("id", row.project_id)
      .maybeSingle();
    if (projErr) return fail("PROJECT_QUERY_FAILED", projErr.message, 500);
    if (!project) return fail("NOT_FOUND", "프로젝트를 찾을 수 없습니다.", 404);
    if (project.user_id !== user.id) {
      return fail("FORBIDDEN", "해당 페이지에 대한 권한이 없습니다.", 403);
    }

    const admin = createAdminSupabase();

    // 1) 페이지 삭제
    const { error: delErr } = await admin
      .from("pages")
      .delete()
      .eq("id", pageId);
    if (delErr) return fail("PAGE_DELETE_FAILED", delErr.message, 500);

    // 2) 후속 페이지들 page_no 압축
    const { error: shiftErr } = await admin.rpc("shift_pages_after", {
      p_project_id: row.project_id,
      p_after_page_no: row.page_no,
      p_shift: -1,
    });
    if (shiftErr) {
      // 압축 실패는 데이터 정합성 이슈지만 삭제는 성공 — 경고만.
      console.warn("[pages/delete] shift_pages_after failed:", shiftErr.message);
    }

    // 남은 페이지 수
    const { count: remainCount } = await supabase
      .from("pages")
      .select("id", { count: "exact", head: true })
      .eq("project_id", row.project_id);

    return ok({ ok: true, pageCount: remainCount ?? 0 });
  } catch (err) {
    return failFromError(err);
  }
}

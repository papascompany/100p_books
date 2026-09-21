import "server-only";

import { fail, failFromError, ok } from "@/app/api/_lib/response";
import { requireActiveUser, requireUser } from "@/lib/auth/session";
import { createAdminSupabase } from "@/lib/db/admin";
import { createServerSupabase } from "@/lib/db/server";
import { computeDocVersion, parseBaseVersion } from "@/lib/editor/doc-version";
import {
  EDIT_CONFLICT_CODE,
  EDIT_CONFLICT_MESSAGE,
} from "@/lib/editor/edit-conflict";
import {
  guardFailureResponse,
  isStaleBase,
  writeWithVersionGuard,
} from "@/lib/editor/version-guard";
import { THUMBS_BUCKET } from "@/lib/image/constants";
import { isPageDoc, type PageDoc } from "@/lib/layout/types";
import { assertProjectsEditable } from "@/lib/orders/edit-lock";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const THUMB_SIGNED_TTL_SEC = 3600;

interface Params {
  params: { id: string };
}

/**
 * GET /api/pages/[id]
 *   응답: { id, projectId, pageNo, layoutMode, fabricJson, updatedAt, version, photoUrls }
 *   version: fabric_json 내용 해시 — PATCH baseVersion 으로 되돌려 보낸다.
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
      version: computeDocVersion(row.fabric_json),
      photoUrls,
    });
  } catch (err) {
    return failFromError(err);
  }
}

interface PatchBody {
  fabricJson?: unknown;
  baseVersion?: unknown;
}

/**
 * PATCH /api/pages/[id]
 *   body: { fabricJson: PageDoc, baseVersion?: string }
 *   응답: { id, pageNo, fabricJson, updatedAt, version }
 *
 * 검증:
 *   1. 로그인 + 탈퇴 가드(requireActiveUser, 410 ACCOUNT_DELETED).
 *   2. page → project 소유권 확인.
 *   3. isPageDoc() 가드 통과.
 *   4. 결제 후 편집 잠금(DEBT-2) — 결제 이후 주문이 있는 포토북이면 409 PROJECT_LOCKED, 쓰기 0건.
 *   5. baseVersion 이 있으면 stale-write 방어 — 서버 fabric_json 해시가 다르면
 *      409 EDIT_CONFLICT { details: { currentVersion } }. 저장 이전 화면(라우터 캐시 재생·
 *      다른 탭)이 최신 저장본을 덮어쓰지 못하게 한다. 없으면(구 클라이언트) 기존 동작.
 *   6. fabricJson.bookSizeId / pageNo 가 DB 와 일치하는지 확인 (실수 방지).
 *
 * 판정 순서: 소유권 → 잠금 → 버전.
 *   - 잠금은 소유권 **뒤** — 남의 포토북 결제 여부가 403/409 차이로 새지 않게.
 *   - 잠금은 버전 **앞** — 잠금은 종착 상태다. stale 기준으로 먼저 409 EDIT_CONFLICT 를 주면
 *     에디터가 최신본을 다시 불러와 로컬 변경을 버리고("저장되지 않았어요" 안내) 재저장한 뒤에야
 *     PROJECT_LOCKED 를 받는다. 잠금을 먼저 알려 한 번에 읽기 전용으로 전환시킨다.
 */
export async function PATCH(req: Request, { params }: Params) {
  try {
    const user = await requireActiveUser();
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
    const base = parseBaseVersion(raw.baseVersion);
    if (!base.ok) {
      return fail(
        "INVALID_BODY",
        "baseVersion 은 비어있지 않은 문자열이어야 합니다.",
        400,
      );
    }
    const baseVersion = base.value;
    // 보내온 문서의 내용 버전 — 서버 문서와 같으면 base 가 옛것이어도 충돌이 아니다(멱등 재시도).
    const incomingVersion =
      baseVersion !== null ? computeDocVersion(doc) : undefined;

    const supabase = createServerSupabase();
    const { data: row, error } = await supabase
      .from("pages")
      .select("id, project_id, page_no, fabric_json, updated_at")
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

    // 결제 후 편집 잠금 — 소유권 뒤, 버전 판정 앞(근거는 위 주석). 잠겨 있으면 409 PROJECT_LOCKED.
    await assertProjectsEditable(createAdminSupabase(), row.project_id);

    // stale 기준이면 다른 검증보다 먼저 409 — 클라이언트가 최신본을 다시 불러와야 한다.
    if (baseVersion !== null) {
      const stale = isStaleBase(baseVersion, row.fabric_json, {
        incomingVersion,
      });
      if (stale.stale) {
        return fail(EDIT_CONFLICT_CODE, EDIT_CONFLICT_MESSAGE, 409, {
          currentVersion: stale.currentVersion,
        });
      }
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

    const fabricJson = doc as unknown as Record<string, unknown>;

    if (baseVersion === null) {
      // 구 클라이언트 — 기준 버전 없이 기존처럼 무조건 저장.
      const { data: updated, error: upErr } = await supabase
        .from("pages")
        .update({ fabric_json: fabricJson })
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
        version: computeDocVersion(updated.fabric_json),
      });
    }

    const guarded = await writeWithVersionGuard({
      baseVersion,
      incomingVersion,
      initial: { content: row.fabric_json, updatedAt: row.updated_at },
      reread: async () => {
        const { data, error: reErr } = await supabase
          .from("pages")
          .select("fabric_json, updated_at")
          .eq("id", pageId)
          .maybeSingle();
        if (reErr) return { ok: false, message: reErr.message };
        return {
          ok: true,
          row: data
            ? { content: data.fabric_json, updatedAt: data.updated_at }
            : null,
        };
      },
      write: async (expectedUpdatedAt) => {
        let query = supabase
          .from("pages")
          .update({ fabric_json: fabricJson })
          .eq("id", pageId);
        if (expectedUpdatedAt !== null) {
          query = query.eq("updated_at", expectedUpdatedAt);
        }
        const { data, error: upErr } = await query
          .select("id, page_no, fabric_json, updated_at")
          .maybeSingle();
        if (upErr) return { ok: false, message: upErr.message };
        return { ok: true, row: data };
      },
    });

    if (guarded.kind !== "written") {
      // 0행(RLS 거부·동시 삭제)도 기존 경로와 같은 500 PAGE_UPDATE_FAILED — 근거는 guardFailureResponse.
      const f = guardFailureResponse(guarded, {
        code: "PAGE_UPDATE_FAILED",
        fallbackMessage: "페이지 저장에 실패했습니다.",
      });
      return fail(f.code, f.message, f.status, f.details);
    }
    const updated = guarded.row;
    return ok({
      id: updated.id,
      pageNo: updated.page_no,
      fabricJson: updated.fabric_json,
      updatedAt: updated.updated_at,
      version: computeDocVersion(updated.fabric_json),
    });
  } catch (err) {
    return failFromError(err);
  }
}

/**
 * DELETE /api/pages/[id]
 *
 * 검증:
 *   1. 로그인 + 탈퇴 가드(requireActiveUser).
 *   2. page → project 소유권 확인.
 *   3. 결제 후 편집 잠금(DEBT-2) — 페이지 삭제는 인쇄 페이지 수를 바꾼다 → 409 PROJECT_LOCKED.
 *
 * 처리:
 *   - DELETE FROM pages WHERE id = ?
 *   - 후속 페이지들 page_no -= 1 (shift_pages_after RPC, p_shift=-1)
 *
 * 응답: { ok, pageCount }
 */
export async function DELETE(_req: Request, { params }: Params) {
  try {
    const user = await requireActiveUser();
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
    // 결제 후 편집 잠금 — 소유권 검증 뒤, 삭제 전에.
    await assertProjectsEditable(admin, row.project_id);

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

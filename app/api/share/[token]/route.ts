import "server-only";

import { z } from "zod";

import { fail, failFromError, ok } from "@/app/api/_lib/response";
import { createAdminSupabase } from "@/lib/db/admin";
import { THUMBS_BUCKET } from "@/lib/image/constants";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteCtx = { params: Promise<{ token: string }> };

const TokenSchema = z.string().uuid();

const THUMB_SIGNED_TTL_SEC = 3600;

interface SharePhoto {
  id: string;
  filename: string | null;
  thumbUrl: string | null;
  width: number | null;
  height: number | null;
  exifTakenAt: string | null;
  orderIdx: number;
}

interface SharePage {
  id: string;
  pageNo: number;
  layoutMode: string;
  fabricJson: Record<string, unknown> | null;
}

interface ShareProject {
  id: string;
  title: string;
  layoutMode: string;
  bookSizeId: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * GET /api/share/[token]
 *
 * anon 접근 가능 — 토큰 자체가 capability.
 * 토큰 검증 후 RLS 우회(admin client)로 project + pages + photos 데이터를 모은다.
 *
 * 동작:
 *   1. token 유효성/만료 검사
 *   2. project 조회 + 소유자 탈퇴 여부 확인 — profiles.deleted_at 이 있으면 404 (DEBT-3)
 *      탈퇴는 익명화 → 콘텐츠 정리(공유 링크 폐기) → auth 순서라, 정리 단계가 실패하면
 *      익명화된 회원의 공유 링크가 남는다. 그 사이에도 사진이 공개되지 않게 여기서 막는다.
 *      토큰 없음과 같은 응답을 줘서 탈퇴 사실을 드러내지 않는다.
 *   3. pages, photos 조회 (deleted_at IS NULL)
 *   4. photos 의 thumb_key → signed URL 변환
 *   5. view_count atomic 증가 (실패해도 응답엔 영향 없음)
 *
 * 응답: { project, pages, coverJson, photos, expiresAt, viewCount }
 */
export async function GET(_req: Request, props: RouteCtx) {
  const params = await props.params;
  try {
    const tokenParse = TokenSchema.safeParse(params.token);
    if (!tokenParse.success) {
      return fail("INVALID_TOKEN", "토큰 형식이 올바르지 않습니다.", 400);
    }
    const tokenVal = tokenParse.data;

    const admin = createAdminSupabase();

    // 1. 토큰 조회 — admin 으로 RLS 우회 (RLS public read 가 있더라도 admin 으로 확실하게)
    const { data: tokenRow, error: tokenErr } = await admin
      .from("share_tokens")
      .select("id, project_id, token, expires_at, view_count, created_at")
      .eq("token", tokenVal)
      .maybeSingle();

    if (tokenErr) return fail("SHARE_TOKEN_QUERY_FAILED", tokenErr.message, 500);
    if (!tokenRow) return fail("NOT_FOUND", "유효하지 않은 공유 링크입니다.", 404);

    if (tokenRow.expires_at && new Date(tokenRow.expires_at).getTime() < Date.now()) {
      return fail("TOKEN_EXPIRED", "만료된 공유 링크입니다.", 410);
    }

    // 2. project 조회
    const { data: project, error: projErr } = await admin
      .from("projects")
      .select(
        "id, user_id, title, layout_mode, book_size_id, cover_json, created_at, updated_at",
      )
      .eq("id", tokenRow.project_id)
      .maybeSingle();

    if (projErr) return fail("PROJECT_QUERY_FAILED", projErr.message, 500);
    if (!project) return fail("NOT_FOUND", "프로젝트를 찾을 수 없습니다.", 404);

    // 2-1. 소유자 탈퇴 여부 — 조회 실패·프로필 없음도 노출하지 않는다 (fail-closed)
    const { data: owner, error: ownerErr } = await admin
      .from("profiles")
      .select("deleted_at")
      .eq("id", project.user_id)
      .maybeSingle();

    if (ownerErr) return fail("OWNER_QUERY_FAILED", "공유 링크를 확인하지 못했습니다.", 500);
    if (!owner || owner.deleted_at) {
      return fail("NOT_FOUND", "유효하지 않은 공유 링크입니다.", 404);
    }

    // 3. pages
    const { data: pageRows, error: pageErr } = await admin
      .from("pages")
      .select("id, page_no, layout_mode, fabric_json")
      .eq("project_id", project.id)
      .order("page_no", { ascending: true });

    if (pageErr) return fail("PAGES_QUERY_FAILED", pageErr.message, 500);

    const pages: SharePage[] = (pageRows ?? []).map((r) => ({
      id: r.id,
      pageNo: r.page_no,
      layoutMode: r.layout_mode,
      fabricJson: r.fabric_json,
    }));

    // 4. photos (active only) — fabric_json 이 photo id 를 참조하므로 함께 노출
    const { data: photoRows, error: photoErr } = await admin
      .from("photos")
      .select(
        "id, thumb_key, filename, width, height, exif_taken_at, order_idx, deleted_at",
      )
      .eq("project_id", project.id)
      .is("deleted_at", null)
      .order("order_idx", { ascending: true });

    if (photoErr) return fail("PHOTOS_QUERY_FAILED", photoErr.message, 500);

    const activePhotos = photoRows ?? [];

    // signed URLs (썸네일만 — 공유는 미리보기 용도)
    const paths: string[] = [];
    const idByKey = new Map<string, string>();
    for (const p of activePhotos) {
      if (p.thumb_key) {
        paths.push(p.thumb_key);
        idByKey.set(p.thumb_key, p.id);
      }
    }

    const urlByPhotoId: Record<string, string> = {};
    if (paths.length > 0) {
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

    const photos: SharePhoto[] = activePhotos.map((p) => ({
      id: p.id,
      filename: p.filename,
      thumbUrl: urlByPhotoId[p.id] ?? null,
      width: p.width,
      height: p.height,
      exifTakenAt: p.exif_taken_at,
      orderIdx: p.order_idx,
    }));

    // 5. view_count atomic 증가 — 실패는 무시 (응답 우선)
    let nextCount: number = tokenRow.view_count + 1;
    try {
      const { data: cnt, error: rpcErr } = await admin.rpc("increment_share_view", {
        token_val: tokenVal,
      });
      if (!rpcErr && typeof cnt === "number") {
        nextCount = cnt;
      }
    } catch {
      // 카운터 실패는 응답에 영향을 주지 않음
    }

    const projectOut: ShareProject = {
      id: project.id,
      title: project.title,
      layoutMode: project.layout_mode,
      bookSizeId: project.book_size_id,
      createdAt: project.created_at,
      updatedAt: project.updated_at,
    };

    return ok({
      project: projectOut,
      coverJson: project.cover_json,
      pages,
      photos,
      expiresAt: tokenRow.expires_at,
      viewCount: nextCount,
    });
  } catch (err) {
    return failFromError(err);
  }
}

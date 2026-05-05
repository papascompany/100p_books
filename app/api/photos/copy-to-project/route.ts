import "server-only";

import { randomUUID } from "node:crypto";

import { z } from "zod";

import { fail, failFromError, ok } from "@/app/api/_lib/response";
import { requireUser } from "@/lib/auth/session";
import { createAdminSupabase } from "@/lib/db/admin";
import { createServerSupabase } from "@/lib/db/server";
import type { Photo } from "@/lib/db/types";
import {
  MAX_PHOTOS_PER_PROJECT,
  ORIGINALS_BUCKET,
  THUMBS_BUCKET,
} from "@/lib/image/constants";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const BodySchema = z.object({
  photoIds: z.array(z.string().uuid()).min(1).max(100),
  targetProjectId: z.string().uuid(),
});

/**
 * POST /api/photos/copy-to-project
 *   body: { photoIds: uuid[], targetProjectId: uuid }
 *
 * 동작:
 *   1. requireUser
 *   2. 모든 photoIds 의 project + targetProjectId 의 소유권 검증
 *   3. Storage 객체 복사 (admin.storage.copy) — user_id 폴더 prefix 동일
 *   4. photos 테이블 새 행 INSERT (target project_id + 새 storage_key + 새 thumb_key)
 *   5. 응답: { inserted: Photo[], skipped: number }
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
    const { photoIds, targetProjectId } = parsed.data;

    const supabase = createServerSupabase();

    // 1) target project 소유권
    const { data: target, error: targetErr } = await supabase
      .from("projects")
      .select("id, user_id")
      .eq("id", targetProjectId)
      .maybeSingle();
    if (targetErr) return fail("PROJECT_QUERY_FAILED", targetErr.message, 500);
    if (!target) {
      return fail("NOT_FOUND", "대상 프로젝트를 찾을 수 없습니다.", 404);
    }
    if (target.user_id !== user.id) {
      return fail("FORBIDDEN", "대상 프로젝트에 권한이 없습니다.", 403);
    }

    // 2) 원본 사진 로드 (소유권 확인 — project.user_id = user.id)
    const { data: photos, error: photosErr } = await supabase
      .from("photos")
      .select(
        "id, project_id, storage_key, thumb_key, filename, mime, size_bytes, width, height, exif_taken_at, exif_camera",
      )
      .in("id", photoIds)
      .is("deleted_at", null);
    if (photosErr) return fail("PHOTOS_QUERY_FAILED", photosErr.message, 500);

    const photoRows = photos ?? [];
    if (photoRows.length === 0) {
      return fail("NOT_FOUND", "원본 사진을 찾을 수 없습니다.", 404);
    }

    // 모든 원본 photo 의 project 가 본인 소유인지 확인
    const sourceProjectIds = Array.from(
      new Set(photoRows.map((p) => p.project_id)),
    );
    const { data: ownerCheck, error: ocErr } = await supabase
      .from("projects")
      .select("id, user_id")
      .in("id", sourceProjectIds);
    if (ocErr) return fail("PROJECT_QUERY_FAILED", ocErr.message, 500);
    const allOwned = (ownerCheck ?? []).every((p) => p.user_id === user.id);
    if (!allOwned || (ownerCheck ?? []).length !== sourceProjectIds.length) {
      return fail("FORBIDDEN", "원본 사진에 대한 권한이 없습니다.", 403);
    }

    // 3) target 프로젝트의 active 사진 수 확인
    const { count: existingCount, error: cntErr } = await supabase
      .from("photos")
      .select("id", { count: "exact", head: true })
      .eq("project_id", targetProjectId)
      .is("deleted_at", null);
    if (cntErr) return fail("PHOTO_COUNT_FAILED", cntErr.message, 500);

    const remainSlots =
      MAX_PHOTOS_PER_PROJECT - (existingCount ?? 0);
    if (remainSlots <= 0) {
      return fail(
        "QUOTA_EXCEEDED",
        `대상 프로젝트에는 이미 최대 ${MAX_PHOTOS_PER_PROJECT}장이 있어요.`,
        400,
      );
    }

    const toCopy = photoRows.slice(0, remainSlots);
    const skipped = photoRows.length - toCopy.length;

    // 4) target 프로젝트 max order_idx 조회
    const { data: maxRow } = await supabase
      .from("photos")
      .select("order_idx")
      .eq("project_id", targetProjectId)
      .is("deleted_at", null)
      .order("order_idx", { ascending: false })
      .limit(1)
      .maybeSingle();
    let nextOrderIdx = (maxRow?.order_idx ?? -1) + 1;

    const admin = createAdminSupabase();

    // 5) Storage copy + photos insert
    const insertedRows: Photo[] = [];
    for (const src of toCopy) {
      const newPhotoId = randomUUID();

      // 원본 storage_key 의 확장자 유지
      const origExtMatch = src.storage_key.match(/\.([^.]+)$/);
      const ext = origExtMatch ? origExtMatch[1] : "jpg";

      const newStorageKey = `${user.id}/${targetProjectId}/${newPhotoId}.${ext}`;

      const { error: copyErr } = await admin.storage
        .from(ORIGINALS_BUCKET)
        .copy(src.storage_key, newStorageKey);
      if (copyErr) {
        return fail(
          "STORAGE_COPY_FAILED",
          `원본 사진 복사 실패: ${copyErr.message}`,
          500,
        );
      }

      let newThumbKey: string | null = null;
      if (src.thumb_key) {
        newThumbKey = `${user.id}/${targetProjectId}/${newPhotoId}.webp`;
        const { error: thumbErr } = await admin.storage
          .from(THUMBS_BUCKET)
          .copy(src.thumb_key, newThumbKey);
        if (thumbErr) {
          // 썸네일 복사 실패는 치명적이지 않음 — 원본은 이미 복사됨, thumb_key=null 로 둠
          newThumbKey = null;
        }
      }

      const { data: insertedRow, error: insErr } = await admin
        .from("photos")
        .insert({
          id: newPhotoId,
          project_id: targetProjectId,
          storage_key: newStorageKey,
          thumb_key: newThumbKey,
          filename: src.filename,
          mime: src.mime,
          size_bytes: src.size_bytes,
          width: src.width,
          height: src.height,
          exif_taken_at: src.exif_taken_at,
          exif_camera: src.exif_camera,
          order_idx: nextOrderIdx,
        })
        .select(
          "id, project_id, storage_key, thumb_key, filename, mime, size_bytes, width, height, exif_taken_at, exif_camera, order_idx, created_at, deleted_at",
        )
        .single();

      if (insErr || !insertedRow) {
        // 롤백: 방금 복사한 storage 객체 삭제
        await admin.storage.from(ORIGINALS_BUCKET).remove([newStorageKey]);
        if (newThumbKey) {
          await admin.storage.from(THUMBS_BUCKET).remove([newThumbKey]);
        }
        return fail(
          "PHOTO_INSERT_FAILED",
          insErr?.message ?? "사진 메타 저장에 실패했습니다.",
          500,
        );
      }

      insertedRows.push(insertedRow as Photo);
      nextOrderIdx++;
    }

    return ok({ inserted: insertedRows, skipped });
  } catch (err) {
    return failFromError(err);
  }
}

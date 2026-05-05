import "server-only";

import { z } from "zod";

import { fail, failFromError, ok } from "@/app/api/_lib/response";
import { requireUser } from "@/lib/auth/session";
import { createAdminSupabase } from "@/lib/db/admin";
import { createServerSupabase } from "@/lib/db/server";
import type { Photo } from "@/lib/db/types";
import {
  MAX_FILE_BYTES,
  MAX_PHOTOS_PER_PROJECT,
  ORIGINALS_BUCKET,
  THUMBS_BUCKET,
  THUMB_LONG_EDGE,
  THUMB_WEBP_QUALITY,
} from "@/lib/image/constants";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// sharp 는 native. serverExternalPackages 에 이미 포함됨 (next.config.ts).
export const maxDuration = 60;

const PhotoItemSchema = z.object({
  photoId: z.string().uuid(),
  storageKey: z.string().min(1).max(512),
  filename: z.string().min(1).max(255),
  mime: z.string().min(1).max(80),
  sizeBytes: z.number().int().positive().max(MAX_FILE_BYTES),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  exifTakenAt: z.string().datetime().nullable().optional(),
  exifCamera: z.string().max(200).nullable().optional(),
  orderIdx: z.number().int().min(0),
});

const BodySchema = z.object({
  projectId: z.string().uuid(),
  photos: z
    .array(PhotoItemSchema)
    .min(1)
    .max(MAX_PHOTOS_PER_PROJECT),
});

type CompleteResult = {
  photo: Photo | null;
  photoId: string;
  error?: string;
};

/**
 * POST /api/photos/complete
 *   body: { projectId, photos: [{ photoId, storageKey, filename, mime, sizeBytes, width?, height?, exifTakenAt?, exifCamera?, orderIdx }] }
 *
 * 각 사진마다:
 *   1. Storage 원본 다운로드
 *   2. sharp 로 rotate() (EXIF orientation 정규화) + metadata 확인
 *   3. 정규화된 원본을 Storage 에 재업로드 (동일 키 upsert)
 *   4. 썸네일(480px webp) 생성 후 photo-thumbs 버킷에 업로드
 *   5. exifr 로 서버 재추출 (gps=false)
 *   6. photos 테이블 INSERT
 */
export async function POST(req: Request) {
  try {
    const user = await requireUser();

    const raw = (await req.json().catch(() => ({}))) as unknown;
    const parsed = BodySchema.safeParse(raw);
    if (!parsed.success) {
      return fail("INVALID_BODY", "요청 본문이 올바르지 않습니다.", 400, parsed.error.flatten());
    }

    const { projectId, photos } = parsed.data;

    // 1) 프로젝트 소유권
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

    // 2) storageKey 가 이 유저/프로젝트 경로인지 재검증
    const expectedPrefix = `${user.id}/${projectId}/`;
    for (const p of photos) {
      if (!p.storageKey.startsWith(expectedPrefix)) {
        return fail("INVALID_STORAGE_KEY", `storageKey 경로 규약 위반: ${p.storageKey}`, 400);
      }
    }

    const admin = createAdminSupabase();
    const sharpMod = (await import("sharp")).default;
    const exifrMod = (await import("exifr")).default;

    const results: CompleteResult[] = [];
    const toInsert: Array<{
      id: string;
      project_id: string;
      storage_key: string;
      thumb_key: string | null;
      filename: string;
      mime: string;
      size_bytes: number;
      width: number | null;
      height: number | null;
      exif_taken_at: string | null;
      exif_camera: string | null;
      order_idx: number;
    }> = [];

    for (const p of photos) {
      try {
        // 원본 다운로드
        const { data: blob, error: dlErr } = await admin.storage
          .from(ORIGINALS_BUCKET)
          .download(p.storageKey);

        if (dlErr || !blob) {
          results.push({
            photoId: p.photoId,
            photo: null,
            error: `원본 다운로드 실패: ${dlErr?.message ?? "unknown"}`,
          });
          continue;
        }

        // 실제 객체 크기 재검증 (signed URL은 서버측 size 제한이 없어 클라 위조 가능)
        if (blob.size > MAX_FILE_BYTES) {
          await admin.storage.from(ORIGINALS_BUCKET).remove([p.storageKey]);
          results.push({
            photoId: p.photoId,
            photo: null,
            error: `파일 크기 초과 (${blob.size} > ${MAX_FILE_BYTES})`,
          });
          continue;
        }

        const arrayBuf = await blob.arrayBuffer();
        const originalBuffer = Buffer.from(arrayBuf);

        // EXIF 재추출 (GPS 절대 금지)
        let takenAt: string | null = null;
        let camera: string | null = null;
        try {
          const exif = (await exifrMod.parse(originalBuffer, {
            gps: false,
            pick: ["DateTimeOriginal", "CreateDate", "Make", "Model"],
          })) as
            | {
                DateTimeOriginal?: Date;
                CreateDate?: Date;
                Make?: string;
                Model?: string;
              }
            | undefined;
          const d = exif?.DateTimeOriginal ?? exif?.CreateDate ?? null;
          if (d instanceof Date && !Number.isNaN(d.getTime())) {
            takenAt = d.toISOString();
          }
          const makeModel = [exif?.Make?.trim(), exif?.Model?.trim()]
            .filter(Boolean)
            .join(" ");
          camera = makeModel.length > 0 ? makeModel.slice(0, 200) : null;
        } catch {
          // 메타 파싱 실패는 치명적이지 않음
        }

        // orientation 정규화: rotate() 는 EXIF orientation 을 해석해 방향 적용 후 태그 제거
        const normalized = sharpMod(originalBuffer, { failOn: "none" }).rotate();
        const normalizedMeta = await normalized.metadata();

        const width = normalizedMeta.width ?? p.width ?? null;
        const height = normalizedMeta.height ?? p.height ?? null;

        // orientation 정규화된 원본 버퍼 (같은 포맷 유지 — 재인코딩 최소화 위해 toBuffer 만)
        // sharp 는 rotate() 이후 별도 포맷 지정 없이 toBuffer() 시 입력 포맷 그대로 출력.
        const rewrittenBuffer = await normalized.toBuffer();

        const { error: upErr } = await admin.storage
          .from(ORIGINALS_BUCKET)
          .upload(p.storageKey, rewrittenBuffer, {
            contentType: p.mime,
            upsert: true,
          });

        if (upErr) {
          results.push({
            photoId: p.photoId,
            photo: null,
            error: `원본 재업로드 실패: ${upErr.message}`,
          });
          continue;
        }

        // 썸네일 (480px webp, q80)
        const thumbKey = p.storageKey.replace(/\.[^.]+$/, ".webp");
        let thumbStoredKey: string | null = null;
        try {
          const thumbBuffer = await sharpMod(rewrittenBuffer)
            .resize({
              width: THUMB_LONG_EDGE,
              height: THUMB_LONG_EDGE,
              fit: "inside",
              withoutEnlargement: true,
            })
            .webp({ quality: THUMB_WEBP_QUALITY })
            .toBuffer();

          const { error: thumbErr } = await admin.storage
            .from(THUMBS_BUCKET)
            .upload(thumbKey, thumbBuffer, {
              contentType: "image/webp",
              upsert: true,
            });

          if (!thumbErr) {
            thumbStoredKey = thumbKey;
          }
          // 썸네일 실패는 원본 보존하고 계속
        } catch {
          // swallow — 원본은 이미 저장됨
        }

        toInsert.push({
          id: p.photoId,
          project_id: projectId,
          storage_key: p.storageKey,
          thumb_key: thumbStoredKey,
          filename: p.filename,
          mime: p.mime,
          size_bytes: p.sizeBytes,
          width,
          height,
          exif_taken_at: takenAt ?? p.exifTakenAt ?? null,
          exif_camera: camera ?? p.exifCamera ?? null,
          order_idx: p.orderIdx,
        });

        results.push({ photoId: p.photoId, photo: null });
      } catch (e) {
        const msg = e instanceof Error ? e.message : "알 수 없는 오류";
        results.push({ photoId: p.photoId, photo: null, error: `처리 실패: ${msg}` });
      }
    }

    // 일괄 INSERT (RLS 대신 소유권을 이미 검증했으므로 admin 사용)
    let inserted: Photo[] = [];
    if (toInsert.length > 0) {
      const { data, error } = await admin
        .from("photos")
        .insert(toInsert)
        .select();

      if (error) {
        return fail("PHOTO_INSERT_FAILED", error.message, 500, { results });
      }
      inserted = (data ?? []) as Photo[];
    }

    // 개별 실패 개수
    const failed = results.filter((r) => r.error);

    return ok({
      inserted,
      failed: failed.map((f) => ({ photoId: f.photoId, error: f.error })),
    });
  } catch (err) {
    return failFromError(err);
  }
}

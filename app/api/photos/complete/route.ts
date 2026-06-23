import "server-only";

import { z } from "zod";

import { fail, failFromError, ok } from "@/app/api/_lib/response";
import { requireUser } from "@/lib/auth/session";
import { createAdminSupabase } from "@/lib/db/admin";
import { createServerSupabase } from "@/lib/db/server";
import type { Photo } from "@/lib/db/types";
import {
  ALLOWED_MIME_TYPES,
  MAX_FILE_BYTES,
  MAX_PHOTOS_PER_PROJECT,
  ORIGINALS_BUCKET,
  THUMBS_BUCKET,
  THUMB_LONG_EDGE,
  THUMB_WEBP_QUALITY,
} from "@/lib/image/constants";
import { enforceRateLimit } from "@/lib/security/rate-limit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// sharp 는 native. serverComponentsExternalPackages 에 포함 (next.config.mjs).
export const maxDuration = 60;

/** sharp metadata.format → 저장 contentType. 화이트리스트 밖이면 null. */
function mimeFromSharpFormat(format: string | undefined): string | null {
  switch (format) {
    case "jpeg":
    case "jpg":
      return "image/jpeg";
    case "png":
      return "image/png";
    case "webp":
      return "image/webp";
    case "heic":
      return "image/heic";
    case "heif":
      return "image/heif";
    default:
      return null;
  }
}

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

    // 🛡 Rate limit — sharp 회전/재업로드/썸네일 등 무거운 동기 파이프라인 보호 (sign-upload 와 동일 프리셋)
    const rl = await enforceRateLimit("photo-upload", req, user.id);
    if (!rl.success) {
      return fail(
        "RATE_LIMITED",
        "업로드 요청이 너무 잦습니다. 잠시 후 다시 시도해 주세요.",
        429,
        { resetAt: rl.reset, limit: rl.limit },
      );
    }

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

    // 2) storageKey 가 이 유저/프로젝트 경로인지 + MIME 화이트리스트 재검증
    //    (sign-upload 를 우회한 직접 complete 호출 방어 — sign-upload 와 동일한 검증)
    const expectedPrefix = `${user.id}/${projectId}/`;
    for (const p of photos) {
      if (!p.storageKey.startsWith(expectedPrefix)) {
        return fail("INVALID_STORAGE_KEY", `storageKey 경로 규약 위반: ${p.storageKey}`, 400);
      }
      if (!(ALLOWED_MIME_TYPES as readonly string[]).includes(p.mime.toLowerCase())) {
        return fail("INVALID_FILE", `허용되지 않는 MIME: ${p.mime}`, 400);
      }
    }

    const admin = createAdminSupabase();

    // 3) 멱등성 — 이미 존재하는 photoId 는 재처리 skip (재시도/PK 충돌 방어)
    const requestedIds = photos.map((p) => p.photoId);
    const { data: existingRows, error: existErr } = await admin
      .from("photos")
      .select("id")
      .in("id", requestedIds);
    if (existErr) return fail("PHOTO_COUNT_FAILED", existErr.message, 500);
    const existingIds = new Set((existingRows ?? []).map((r) => r.id as string));
    const pending = photos.filter((p) => !existingIds.has(p.photoId));

    // 4) 100장 한도 재검증 (TOCTOU 방어) — active 사진 수 + 신규 처리분 합산
    const { count: activeCount, error: countErr } = await admin
      .from("photos")
      .select("id", { count: "exact", head: true })
      .eq("project_id", projectId)
      .is("deleted_at", null);
    if (countErr) return fail("PHOTO_COUNT_FAILED", countErr.message, 500);
    if ((activeCount ?? 0) + pending.length > MAX_PHOTOS_PER_PROJECT) {
      return fail(
        "QUOTA_EXCEEDED",
        `한 프로젝트에는 최대 ${MAX_PHOTOS_PER_PROJECT}장까지 업로드할 수 있습니다.`,
        400,
      );
    }

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

    for (const p of pending) {
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

        // contentType/mime 은 클라 값이 아니라 sharp 가 판정한 실제 포맷에서 도출 (위조 방어).
        // 화이트리스트 밖 포맷이면 거부.
        const detectedMime = mimeFromSharpFormat(normalizedMeta.format);
        if (!detectedMime) {
          results.push({
            photoId: p.photoId,
            photo: null,
            error: `허용되지 않는 이미지 포맷: ${normalizedMeta.format ?? "unknown"}`,
          });
          continue;
        }

        const { error: upErr } = await admin.storage
          .from(ORIGINALS_BUCKET)
          .upload(p.storageKey, rewrittenBuffer, {
            contentType: detectedMime,
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
          // mime/size_bytes 는 클라 값이 아니라 sharp 산출 포맷 + 실제 바이트로 기록 (위조 방어).
          mime: detectedMime,
          size_bytes: rewrittenBuffer.length,
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

    // 일괄 UPSERT (RLS 대신 소유권을 이미 검증했으므로 admin 사용)
    // 멱등성: 재시도로 동일 photoId 가 중복돼도 PK 충돌(23505)로 배치 전체가 실패하지 않도록
    //         onConflict=id, ignoreDuplicates 로 안전 처리.
    let inserted: Photo[] = [];
    if (toInsert.length > 0) {
      const { data, error } = await admin
        .from("photos")
        .upsert(toInsert, { onConflict: "id", ignoreDuplicates: true })
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

import "server-only";

import { randomUUID } from "node:crypto";

import { fail, failFromError, ok } from "@/app/api/_lib/response";
import { requireUser } from "@/lib/auth/session";
import { createAdminSupabase } from "@/lib/db/admin";
import {
  ALLOWED_MIME_TYPES,
  MAX_FILE_BYTES,
  extForMime,
} from "@/lib/image/constants";
import { enforceRateLimit } from "@/lib/security/rate-limit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const REVIEWS_BUCKET = "reviews";
const REVIEW_MAX_IMAGES = 3;

const ALLOWED_MIME_SET = new Set<string>(ALLOWED_MIME_TYPES);

/**
 * POST /api/reviews/upload
 *   Content-Type: multipart/form-data
 *   field name: "files" (최대 3개)
 *
 *   응답: { imageKeys: string[] }
 *
 *   파일명: reviews 버킷 내부 경로 = {userId}/{groupId}/{uuid}.{ext}
 *   - groupId 는 후기 생성 전 임시 그룹 (이후 review id 와 매핑되지 않아도 됨)
 *   - 정책상 storage.foldername(name)[1] === auth.uid() 만 통과
 *
 *   주의:
 *     이 라우트는 클라가 보낸 파일 바이트를 직접 admin 클라이언트로 업로드한다.
 *     (서명 URL 방식이 아닌 직접 업로드 — 후기 첨부는 작은 수량이라 단순화 우선.)
 */
export async function POST(req: Request) {
  try {
    const user = await requireUser();

    // 🛡 Rate limit — 시간당 20회 (남용 차단)
    const rl = await enforceRateLimit("review-upload", req, user.id);
    if (!rl.success) {
      return fail(
        "RATE_LIMITED",
        "후기 이미지 업로드 요청이 너무 잦습니다. 잠시 후 다시 시도해 주세요.",
        429,
        { resetAt: rl.reset, limit: rl.limit },
      );
    }

    const contentType = req.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().startsWith("multipart/form-data")) {
      return fail(
        "INVALID_CONTENT_TYPE",
        "multipart/form-data 형식이어야 합니다.",
        400,
      );
    }

    const form = await req.formData().catch(() => null);
    if (!form) {
      return fail("INVALID_FORM", "폼 데이터를 읽을 수 없습니다.", 400);
    }

    // "files" 필드를 다중 수집
    const raw = form.getAll("files");
    const files: File[] = [];
    for (const v of raw) {
      if (v instanceof File) files.push(v);
    }
    if (files.length === 0) {
      return fail("NO_FILES", "업로드할 파일이 없습니다.", 400);
    }
    if (files.length > REVIEW_MAX_IMAGES) {
      return fail(
        "TOO_MANY_FILES",
        `사진은 최대 ${REVIEW_MAX_IMAGES}장까지 첨부할 수 있어요.`,
        400,
      );
    }

    // 파일별 검증
    for (const f of files) {
      if (!f.size || f.size <= 0) {
        return fail("EMPTY_FILE", `${f.name}: 빈 파일은 업로드할 수 없어요.`, 400);
      }
      if (f.size > MAX_FILE_BYTES) {
        return fail(
          "FILE_TOO_LARGE",
          `${f.name}: 파일 크기가 너무 큽니다 (최대 ${Math.floor(MAX_FILE_BYTES / 1024 / 1024)}MB).`,
          400,
        );
      }
      const mime = (f.type || "").toLowerCase();
      if (!ALLOWED_MIME_SET.has(mime)) {
        return fail(
          "INVALID_MIME",
          `${f.name}: 지원하지 않는 형식입니다.`,
          400,
        );
      }
    }

    const admin = createAdminSupabase();

    // 후기당 그룹 prefix — 후기 INSERT 전이라 reviewId 가 없으므로 임시 uuid 사용.
    // RLS 정책상 첫 segment 가 auth.uid() 이기만 하면 통과.
    const groupId = randomUUID();
    const imageKeys: string[] = [];

    for (const f of files) {
      const mime = (f.type || "").toLowerCase();
      const ext = extForMime(mime);
      const key = `${user.id}/${groupId}/${randomUUID()}.${ext}`;

      const buf = Buffer.from(await f.arrayBuffer());
      const { error: upErr } = await admin.storage
        .from(REVIEWS_BUCKET)
        .upload(key, buf, {
          contentType: mime,
          upsert: false,
        });
      if (upErr) {
        // 부분 업로드 정리 (best-effort)
        if (imageKeys.length > 0) {
          await admin.storage
            .from(REVIEWS_BUCKET)
            .remove(imageKeys)
            .catch(() => undefined);
        }
        return fail(
          "UPLOAD_FAILED",
          upErr.message ?? "이미지 업로드에 실패했어요.",
          500,
        );
      }
      imageKeys.push(key);
    }

    return ok({ imageKeys });
  } catch (err) {
    return failFromError(err);
  }
}

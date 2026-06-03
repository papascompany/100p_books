import "server-only";

import { randomUUID } from "node:crypto";

import { fail, ok } from "@/app/api/_lib/response";
import { withAdmin } from "@/lib/admin/auth";
import { createAdminSupabase } from "@/lib/db/admin";
import {
  ALLOWED_MIME_TYPES,
  MAX_FILE_BYTES,
  extForMime,
} from "@/lib/image/constants";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SITE_ASSETS_BUCKET = "site-assets";
const ALLOWED_MIME_SET = new Set<string>(ALLOWED_MIME_TYPES);

/** section 정규화 — [a-z0-9_-]+ 만 허용, 아니면 "misc". */
function safeSection(raw: unknown): string {
  if (typeof raw !== "string") return "misc";
  const s = raw.trim().toLowerCase();
  return /^[a-z0-9_-]+$/.test(s) ? s : "misc";
}

/**
 * POST /api/admin/content/upload
 *   Content-Type: multipart/form-data
 *   field "file"    : 단일 이미지
 *   field "section" : 자산 분류 prefix (예: "hero", "features"). 미지정/부적합 시 "misc".
 *
 *   응답: { url, path }
 *
 *   site-assets 는 public 버킷이므로 getPublicUrl 로 공개 URL 반환.
 *   withAdmin 보호 (관리자만).
 */
export const POST = withAdmin(async (req) => {
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

  const file = form.get("file");
  if (!(file instanceof File)) {
    return fail("NO_FILE", "업로드할 파일이 없습니다.", 400);
  }

  if (!file.size || file.size <= 0) {
    return fail("EMPTY_FILE", "빈 파일은 업로드할 수 없습니다.", 400);
  }
  if (file.size > MAX_FILE_BYTES) {
    return fail(
      "FILE_TOO_LARGE",
      `파일 크기가 너무 큽니다 (최대 ${Math.floor(MAX_FILE_BYTES / 1024 / 1024)}MB).`,
      400,
    );
  }

  const mime = (file.type || "").toLowerCase();
  if (!ALLOWED_MIME_SET.has(mime)) {
    return fail("INVALID_MIME", "지원하지 않는 이미지 형식입니다.", 400);
  }

  const section = safeSection(form.get("section"));
  const ext = extForMime(mime);
  const path = `${section}/${randomUUID()}.${ext}`;

  const admin = createAdminSupabase();

  const buf = Buffer.from(await file.arrayBuffer());
  const { error: upErr } = await admin.storage
    .from(SITE_ASSETS_BUCKET)
    .upload(path, buf, {
      contentType: mime,
      upsert: false,
    });

  if (upErr) {
    return fail(
      "UPLOAD_FAILED",
      upErr.message ?? "이미지 업로드에 실패했습니다.",
      500,
    );
  }

  const {
    data: { publicUrl },
  } = admin.storage.from(SITE_ASSETS_BUCKET).getPublicUrl(path);

  return ok({ url: publicUrl, path });
});

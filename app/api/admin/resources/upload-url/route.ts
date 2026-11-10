import "server-only";

import { randomUUID } from "node:crypto";

import { z } from "zod";

import { fail, ok } from "@/app/api/_lib/response";
import { withAdmin } from "@/lib/admin/auth";
import {
  RESOURCES_BUCKET,
  RESOURCE_CONSTRAINTS,
  issueUploadTarget,
  validateUploadDeclaration,
} from "@/lib/admin/resources";
import { createAdminSupabase } from "@/lib/db/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z.object({
  type: z.enum(["font", "clipart", "background"]),
  filename: z.string().min(1).max(255),
  size: z.number().int().positive(),
  mime: z.string().max(100).optional().default(""),
});

/**
 * POST /api/admin/resources/upload-url
 *   body: { type, filename, size, mime }
 *   검증 후 resourceId + 서버 생성 path 에 대한 Storage 서명 업로드 토큰을 발급한다.
 *   DB row 는 만들지 않는다 — 업로드 후 POST /api/admin/resources 에서 finalize.
 */
export const POST = withAdmin(async (req) => {
  const raw = (await req.json().catch(() => ({}))) as unknown;
  const parsed = BodySchema.safeParse(raw);
  if (!parsed.success) {
    return fail("INVALID_BODY", "요청 본문이 올바르지 않습니다.", 400, parsed.error.flatten());
  }
  const { type, filename, size, mime } = parsed.data;

  const v = validateUploadDeclaration(type, { name: filename, size, type: mime });
  if (!v.ok) return fail("INVALID_FILE", v.error ?? "파일 검증 실패", 400);

  const { resourceId, path } = issueUploadTarget(type, filename, randomUUID());

  const admin = createAdminSupabase();
  const { data, error } = await admin.storage
    .from(RESOURCES_BUCKET)
    .createSignedUploadUrl(path);
  if (error || !data) {
    return fail("SIGN_URL_FAILED", error?.message ?? "서명 URL 생성 실패", 500);
  }

  return ok({
    resourceId,
    storageKey: path,
    uploadUrl: data.signedUrl,
    token: data.token,
    constraint: RESOURCE_CONSTRAINTS[type],
  });
});

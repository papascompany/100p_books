import "server-only";

import { z } from "zod";

import { fail, ok } from "@/app/api/_lib/response";
import { withAdmin } from "@/lib/admin/auth";
import { logAdminAction } from "@/lib/admin/audit";
import {
  RESOURCE_CONSTRAINTS,
  finalizeResourceUpload,
  isResourceId,
  validateResourceMeta,
} from "@/lib/admin/resources";
import { createAdminSupabase } from "@/lib/db/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TYPE_VALUES = ["font", "clipart", "background"] as const;
const QuerySchema = z.object({
  type: z.enum(TYPE_VALUES),
});

/** GET — 모든 (active 무관) 리소스 리스트. */
export const GET = withAdmin(async (req) => {
  const url = new URL(req.url);
  const parsed = QuerySchema.safeParse({ type: url.searchParams.get("type") });
  if (!parsed.success) return fail("INVALID_QUERY", "type 가 누락되었습니다.", 400);
  const { type } = parsed.data;

  const admin = createAdminSupabase();
  const { data, error } = await admin
    .from("resources")
    .select("id, type, name, storage_key, meta, active, created_at")
    .eq("type", type)
    .order("created_at", { ascending: false });
  if (error) return fail("RESOURCES_QUERY_FAILED", error.message, 500);
  return ok({ items: data ?? [] });
});


const FinalizeSchema = z.object({
  type: z.enum(TYPE_VALUES),
  resourceId: z.string().refine(isResourceId, "resourceId 가 올바르지 않습니다."),
  filename: z.string().min(1).max(255),
  name: z.string().trim().min(1, "name 을 입력하세요.").max(80),
  meta: z.record(z.string(), z.unknown()).nullable().optional(),
});

/**
 * POST — 직접 업로드 finalize (JSON).
 *
 * 흐름 (파일 본문은 이 라우트를 거치지 않는다 — Vercel 4.5MB 본문 제한):
 *   1. POST /api/admin/resources/upload-url 로 서명 토큰 발급
 *   2. 브라우저가 Storage 로 직접 PUT
 *   3. 이 라우트: { type, resourceId, filename, name, meta } — path 는 서버가
 *      type+resourceId+ext 로 재계산하고, 객체 존재·실제 크기·매직 바이트(·배경 2400px)를
 *      재검증한 뒤 resources INSERT. 실패 시 업로드된 객체를 삭제한다.
 */
export const POST = withAdmin(async (req, _ctx, user) => {
  const raw = (await req.json().catch(() => null)) as unknown;
  if (!raw || typeof raw !== "object") {
    return fail("INVALID_BODY", "application/json 본문이 필요합니다.", 400);
  }
  const parsed = FinalizeSchema.safeParse(raw);
  if (!parsed.success) {
    return fail("INVALID_BODY", "요청 본문이 올바르지 않습니다.", 400, parsed.error.flatten());
  }
  const { type, resourceId, filename, name } = parsed.data;
  const meta = parsed.data.meta ?? null;

  const metaErr = validateResourceMeta(type, meta);
  if (metaErr) return fail("INVALID_META", metaErr, 400);

  const admin = createAdminSupabase();
  const r = await finalizeResourceUpload(admin, { type, resourceId, filename, name, meta });
  if (!r.ok) return fail(r.code, r.message, r.status, r.details);

  await logAdminAction({
    actor: { id: user.id, email: user.email },
    action: "resource.create",
    targetType: "resource",
    targetId: r.item.id,
    details: { type: r.item.type, name: r.item.name, storage_key: r.item.storage_key },
    request: req,
  });

  return ok({ item: r.item, constraint: RESOURCE_CONSTRAINTS[type] }, { status: 201 });
});

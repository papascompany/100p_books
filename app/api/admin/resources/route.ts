import "server-only";

import { z } from "zod";

import { fail, ok } from "@/app/api/_lib/response";
import { withAdmin } from "@/lib/admin/auth";
import { logAdminAction } from "@/lib/admin/audit";
import {
  RESOURCES_BUCKET,
  extOf,
  pathFor,
  validateUpload,
  RESOURCE_CONSTRAINTS,
} from "@/lib/admin/resources";
import { createAdminSupabase } from "@/lib/db/admin";
import type { ResourceType } from "@/lib/db/types";

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

/**
 * POST — multipart/form-data 업로드.
 *
 * 필드:
 *   type: ResourceType
 *   name: string
 *   file: File
 *   meta: JSON string (optional)
 *
 * 흐름:
 *   1. validate (size/ext)
 *   2. resources INSERT (storage_key 는 pathFor 로 계산)
 *   3. storage upload (실패 시 row 삭제)
 *   4. (배경 한정) sharp probe — width >= 2400px 검증, 실패 시 삭제
 */
export const POST = withAdmin(async (req, _ctx, user) => {
  const form = await req.formData().catch(() => null);
  if (!form) return fail("INVALID_BODY", "multipart/form-data 가 필요합니다.", 400);

  const type = form.get("type");
  const name = form.get("name");
  const file = form.get("file");
  const metaRaw = form.get("meta");

  if (typeof type !== "string" || !TYPE_VALUES.includes(type as ResourceType)) {
    return fail("INVALID_TYPE", "type 이 유효하지 않습니다.", 400);
  }
  if (typeof name !== "string" || !name.trim()) {
    return fail("INVALID_NAME", "name 을 입력하세요.", 400);
  }
  if (!(file instanceof File)) {
    return fail("INVALID_FILE", "file 이 누락되었습니다.", 400);
  }
  const t = type as ResourceType;
  const v = validateUpload(t, file);
  if (!v.ok) return fail("INVALID_FILE", v.error ?? "파일 검증 실패", 400);

  let meta: Record<string, unknown> | null = null;
  if (typeof metaRaw === "string" && metaRaw.length > 0) {
    try {
      const parsed = JSON.parse(metaRaw);
      if (parsed && typeof parsed === "object") {
        meta = parsed as Record<string, unknown>;
      }
    } catch {
      return fail("INVALID_META", "meta 가 올바른 JSON 이 아닙니다.", 400);
    }
  }

  // type 별 메타 필수 필드 체크
  if (t === "font") {
    const m = meta ?? {};
    const required = ["family", "licenseName"] as const;
    for (const k of required) {
      if (!m[k] || typeof m[k] !== "string") {
        return fail(
          "INVALID_META",
          `폰트 메타 필수: ${required.join(", ")}`,
          400,
        );
      }
    }
  }

  const admin = createAdminSupabase();

  // 1) DB row INSERT (storage_key 는 row id 가 필요하므로 placeholder 후 update)
  const ext = extOf(file.name);
  const { data: inserted, error: insErr } = await admin
    .from("resources")
    .insert({
      type: t,
      name: name.trim(),
      storage_key: "pending",
      meta,
      active: true,
    })
    .select("id, type, name, storage_key, meta, active, created_at")
    .single();
  if (insErr || !inserted) {
    return fail("INSERT_FAILED", insErr?.message ?? "DB 등록 실패", 500);
  }

  const storageKey = pathFor(t, inserted.id, ext);

  // 2) Storage 업로드
  const buf = Buffer.from(await file.arrayBuffer());
  const { error: upErr } = await admin.storage
    .from(RESOURCES_BUCKET)
    .upload(storageKey, buf, {
      contentType: file.type || undefined,
      upsert: true,
    });
  if (upErr) {
    await admin.from("resources").delete().eq("id", inserted.id);
    return fail("UPLOAD_FAILED", upErr.message, 500);
  }

  // 3) 배경 — sharp 로 width 검증
  if (t === "background") {
    try {
      const sharp = (await import("sharp")).default;
      const meta2 = await sharp(buf).metadata();
      if (!meta2.width || meta2.width < 2400) {
        await admin.storage.from(RESOURCES_BUCKET).remove([storageKey]);
        await admin.from("resources").delete().eq("id", inserted.id);
        return fail(
          "BACKGROUND_TOO_SMALL",
          `배경 이미지는 가로 2400px 이상이어야 합니다 (현재: ${meta2.width ?? "?"}px).`,
          400,
        );
      }
    } catch (err) {
      // probe 실패는 차단하지 않고 그대로 진행 (sharp 미설치/포맷 미지원).
      console.warn("[admin/resources] sharp probe 실패", err);
    }
  }

  // 4) storage_key 갱신
  const { data: final, error: updErr } = await admin
    .from("resources")
    .update({ storage_key: storageKey })
    .eq("id", inserted.id)
    .select("id, type, name, storage_key, meta, active, created_at")
    .single();
  if (updErr || !final) {
    await admin.storage.from(RESOURCES_BUCKET).remove([storageKey]);
    await admin.from("resources").delete().eq("id", inserted.id);
    return fail("UPDATE_FAILED", updErr?.message ?? "메타 갱신 실패", 500);
  }

  await logAdminAction({
    actor: { id: user.id, email: user.email },
    action: "resource.create",
    targetType: "resource",
    targetId: final.id,
    details: { type: final.type, name: final.name, storage_key: final.storage_key },
    request: req,
  });

  return ok(
    { item: final, constraint: RESOURCE_CONSTRAINTS[t] },
    { status: 201 },
  );
});

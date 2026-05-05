import "server-only";

import { z } from "zod";

import { fail, ok } from "@/app/api/_lib/response";
import { withAdmin } from "@/lib/admin/auth";
import { RESOURCES_BUCKET } from "@/lib/admin/resources";
import { findResourceUsage } from "@/lib/admin/resource-usage";
import { createAdminSupabase } from "@/lib/db/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PatchSchema = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    active: z.boolean().optional(),
    meta: z.record(z.unknown()).nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "변경할 필드가 없습니다.");

export const PATCH = withAdmin<{ id: string }>(async (req, ctx) => {
  const raw = (await req.json().catch(() => ({}))) as unknown;
  const parsed = PatchSchema.safeParse(raw);
  if (!parsed.success) {
    return fail(
      "INVALID_BODY",
      "요청 본문이 올바르지 않습니다.",
      400,
      parsed.error.flatten(),
    );
  }
  const admin = createAdminSupabase();
  const { data, error } = await admin
    .from("resources")
    .update(parsed.data)
    .eq("id", ctx.params.id)
    .select("id, type, name, storage_key, meta, active, created_at")
    .maybeSingle();
  if (error) return fail("RESOURCE_UPDATE_FAILED", error.message, 500);
  if (!data) return fail("NOT_FOUND", "리소스를 찾을 수 없습니다.", 404);
  return ok({ item: data });
});

export const DELETE = withAdmin<{ id: string }>(async (req, ctx) => {
  const admin = createAdminSupabase();
  const url = new URL(req.url);
  const force = url.searchParams.get("force") === "true";

  const { data: row, error: fetchErr } = await admin
    .from("resources")
    .select("storage_key")
    .eq("id", ctx.params.id)
    .maybeSingle();
  if (fetchErr) return fail("FETCH_FAILED", fetchErr.message, 500);
  if (!row) return fail("NOT_FOUND", "리소스를 찾을 수 없습니다.", 404);

  // 사용중 검사 — force=true 가 아닐 때만 실시
  if (!force) {
    let usage;
    try {
      usage = await findResourceUsage(ctx.params.id);
    } catch (e) {
      // 사용중 검사 실패는 차단 사유 X — 경고 로그만
      console.warn(
        "[admin/resources] usage check failed:",
        e instanceof Error ? e.message : String(e),
      );
      usage = { usedInPages: 0, usedInCovers: 0, keywords: [] as string[] };
    }
    if (usage.usedInPages + usage.usedInCovers > 0) {
      return fail(
        "RESOURCE_IN_USE",
        "이 리소스는 다른 곳에서 사용 중입니다.",
        409,
        {
          usedInPages: usage.usedInPages,
          usedInCovers: usage.usedInCovers,
          keywords: usage.keywords,
        },
      );
    }
  }

  if (row.storage_key && row.storage_key !== "pending") {
    const { error: rmErr } = await admin.storage
      .from(RESOURCES_BUCKET)
      .remove([row.storage_key]);
    if (rmErr) {
      // 객체가 이미 없을 수도 있으므로 경고만 — DB row 는 그래도 정리
      console.warn("[admin/resources] storage remove warn:", rmErr.message);
    }
  }

  const { error: delErr } = await admin
    .from("resources")
    .delete()
    .eq("id", ctx.params.id);
  if (delErr) return fail("RESOURCE_DELETE_FAILED", delErr.message, 500);
  return ok({ deleted: true, forced: force });
});

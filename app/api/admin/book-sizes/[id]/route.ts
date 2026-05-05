import "server-only";

import { z } from "zod";

import { ok, fail } from "@/app/api/_lib/response";
import { withAdmin } from "@/lib/admin/auth";
import { createAdminSupabase } from "@/lib/db/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PatchSchema = z
  .object({
    name: z.string().trim().min(1).max(40).optional(),
    width_mm: z.number().int().min(50).max(500).optional(),
    height_mm: z.number().int().min(50).max(500).optional(),
    cover_width_mm: z.number().int().min(50).max(1000).optional(),
    cover_height_mm: z.number().int().min(50).max(1000).optional(),
    spine_formula_per_page: z.number().min(0).max(1).optional(),
    active: z.boolean().optional(),
    display_order: z.number().int().min(0).max(9999).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "변경할 필드가 없습니다.");

export const GET = withAdmin<{ id: string }>(async (_req, ctx) => {
  const admin = createAdminSupabase();
  const { data, error } = await admin
    .from("book_sizes")
    .select(
      "id, name, width_mm, height_mm, cover_width_mm, cover_height_mm, spine_formula_per_page, active, display_order, created_at",
    )
    .eq("id", ctx.params.id)
    .maybeSingle();
  if (error) return fail("BOOK_SIZE_QUERY_FAILED", error.message, 500);
  if (!data) return fail("NOT_FOUND", "책 사이즈를 찾을 수 없습니다.", 404);
  return ok({ item: data });
});

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
    .from("book_sizes")
    .update(parsed.data)
    .eq("id", ctx.params.id)
    .select(
      "id, name, width_mm, height_mm, cover_width_mm, cover_height_mm, spine_formula_per_page, active, display_order, created_at",
    )
    .maybeSingle();
  if (error) return fail("BOOK_SIZE_UPDATE_FAILED", error.message, 500);
  if (!data) return fail("NOT_FOUND", "책 사이즈를 찾을 수 없습니다.", 404);
  return ok({ item: data });
});

export const DELETE = withAdmin<{ id: string }>(async (_req, ctx) => {
  const admin = createAdminSupabase();
  // FK (projects.book_size_id) 가 있는 경우 삭제 차단 — 안전하게 active=false 권장.
  const { count, error: refErr } = await admin
    .from("projects")
    .select("id", { count: "exact", head: true })
    .eq("book_size_id", ctx.params.id);
  if (refErr) return fail("REF_CHECK_FAILED", refErr.message, 500);
  if ((count ?? 0) > 0) {
    return fail(
      "IN_USE",
      "이 사이즈를 사용하는 프로젝트가 있어 삭제할 수 없습니다. 비활성화(active=false) 하세요.",
      409,
    );
  }
  const { error } = await admin
    .from("book_sizes")
    .delete()
    .eq("id", ctx.params.id);
  if (error) return fail("BOOK_SIZE_DELETE_FAILED", error.message, 500);
  return ok({ deleted: true });
});

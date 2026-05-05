import "server-only";

import { z } from "zod";

import { ok, fail } from "@/app/api/_lib/response";
import { withAdmin } from "@/lib/admin/auth";
import { logAdminAction } from "@/lib/admin/audit";
import { createAdminSupabase } from "@/lib/db/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SizeSchema = z.object({
  name: z.string().trim().min(1).max(40),
  width_mm: z.number().int().min(50).max(500),
  height_mm: z.number().int().min(50).max(500),
  cover_width_mm: z.number().int().min(50).max(1000),
  cover_height_mm: z.number().int().min(50).max(1000),
  spine_formula_per_page: z.number().min(0).max(1).default(0.09),
  active: z.boolean().default(true),
  display_order: z.number().int().min(0).max(9999).default(0),
});

/** GET — 모든 책 사이즈 (active 무관). */
export const GET = withAdmin(async () => {
  const admin = createAdminSupabase();
  const { data, error } = await admin
    .from("book_sizes")
    .select(
      "id, name, width_mm, height_mm, cover_width_mm, cover_height_mm, spine_formula_per_page, active, display_order, created_at",
    )
    .order("display_order", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) return fail("BOOK_SIZE_QUERY_FAILED", error.message, 500);
  return ok({ items: data ?? [] });
});

/** POST — 신규 등록. */
export const POST = withAdmin(async (req, _ctx, user) => {
  const raw = (await req.json().catch(() => ({}))) as unknown;
  const parsed = SizeSchema.safeParse(raw);
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
    .insert(parsed.data)
    .select(
      "id, name, width_mm, height_mm, cover_width_mm, cover_height_mm, spine_formula_per_page, active, display_order, created_at",
    )
    .single();
  if (error || !data) {
    return fail("BOOK_SIZE_INSERT_FAILED", error?.message ?? "실패", 500);
  }

  await logAdminAction({
    actor: { id: user.id, email: user.email },
    action: "book_size.create",
    targetType: "book_size",
    targetId: data.id,
    details: { name: data.name },
    request: req,
  });

  return ok({ item: data }, { status: 201 });
});

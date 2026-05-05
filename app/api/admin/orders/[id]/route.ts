import "server-only";

import { fail, ok } from "@/app/api/_lib/response";
import { withAdmin } from "@/lib/admin/auth";
import { createAdminSupabase } from "@/lib/db/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withAdmin<{ id: string }>(async (_req, ctx) => {
  const admin = createAdminSupabase();
  const { data, error } = await admin
    .from("orders")
    .select(
      "id, project_id, user_id, qty, amount, address, status, toss_payment_key, toss_order_id, cover_pdf_key, interior_pdf_key, paid_at, shipped_at, delivered_at, tracking_no, tracking_carrier, created_at, updated_at, projects(id, title, book_sizes(id, name, width_mm, height_mm)), profiles(id, email, display_name)",
    )
    .eq("id", ctx.params.id)
    .maybeSingle();
  if (error) return fail("ORDER_QUERY_FAILED", error.message, 500);
  if (!data) return fail("NOT_FOUND", "주문을 찾을 수 없습니다.", 404);
  return ok({ item: data });
});

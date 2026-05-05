import "server-only";

import { z } from "zod";

import { fail, ok } from "@/app/api/_lib/response";
import { withAdmin } from "@/lib/admin/auth";
import { createAdminSupabase } from "@/lib/db/admin";
import { ALL_ORDER_STATUSES } from "@/lib/orders/state";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const QuerySchema = z.object({
  status: z.enum(ALL_ORDER_STATUSES as [string, ...string[]]).optional(),
  q: z.string().trim().max(120).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  page: z.coerce.number().int().min(1).max(10000).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

/**
 * GET /api/admin/orders
 *
 *   ?status=...&q=...&from=ISO&to=ISO&page=1&pageSize=50
 *
 *   q 는 주문번호(id prefix) 또는 사용자 이메일 부분 일치.
 */
export const GET = withAdmin(async (req) => {
  const url = new URL(req.url);
  const parsed = QuerySchema.safeParse({
    status: url.searchParams.get("status") ?? undefined,
    q: url.searchParams.get("q") ?? undefined,
    from: url.searchParams.get("from") ?? undefined,
    to: url.searchParams.get("to") ?? undefined,
    page: url.searchParams.get("page") ?? undefined,
    pageSize: url.searchParams.get("pageSize") ?? undefined,
  });
  if (!parsed.success) {
    return fail(
      "INVALID_QUERY",
      "쿼리 파라미터가 올바르지 않습니다.",
      400,
      parsed.error.flatten(),
    );
  }
  const { status, q, from, to, page, pageSize } = parsed.data;

  const admin = createAdminSupabase();

  // q (이메일) 가 있으면 먼저 profiles 에서 user_id 들을 찾는다.
  let userIdFilter: string[] | null = null;
  if (q && q.length > 0 && q.includes("@")) {
    const { data: profs } = await admin
      .from("profiles")
      .select("id")
      .ilike("email", `%${q}%`)
      .limit(50);
    userIdFilter = (profs ?? []).map((p) => p.id);
    if (userIdFilter.length === 0) {
      return ok({ items: [], total: 0, page, pageSize });
    }
  }

  let query = admin
    .from("orders")
    .select(
      "id, qty, amount, status, created_at, paid_at, shipped_at, delivered_at, tracking_no, tracking_carrier, user_id, project_id, projects(title, book_sizes(name)), profiles(email)",
      { count: "exact" },
    )
    .order("created_at", { ascending: false });

  if (status) query = query.eq("status", status);
  if (from) query = query.gte("created_at", from);
  if (to) query = query.lte("created_at", to);
  if (userIdFilter) query = query.in("user_id", userIdFilter);
  // q 가 이메일 형식이 아니면 주문 id prefix 매치
  if (q && !q.includes("@")) {
    query = query.ilike("id", `${q}%`);
  }

  const fromIdx = (page - 1) * pageSize;
  query = query.range(fromIdx, fromIdx + pageSize - 1);

  const { data, count, error } = await query;
  if (error) return fail("ORDERS_QUERY_FAILED", error.message, 500);

  return ok({
    items: data ?? [],
    total: count ?? 0,
    page,
    pageSize,
  });
});

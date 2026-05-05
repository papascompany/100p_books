import "server-only";

import { z } from "zod";

import { fail, ok } from "@/app/api/_lib/response";
import { withAdmin } from "@/lib/admin/auth";
import { createAdminSupabase } from "@/lib/db/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const QuerySchema = z.object({
  actor: z.string().trim().max(120).optional(),
  action: z.string().trim().max(80).optional(),
  targetType: z.string().trim().max(40).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  page: z.coerce.number().int().min(1).max(10000).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

/**
 * GET /api/admin/audit
 *
 *  ?actor=email-substring&action=order.transition&targetType=order
 *  &from=ISO&to=ISO&page=1&pageSize=50
 */
export const GET = withAdmin(async (req) => {
  const url = new URL(req.url);
  const parsed = QuerySchema.safeParse({
    actor: url.searchParams.get("actor") ?? undefined,
    action: url.searchParams.get("action") ?? undefined,
    targetType: url.searchParams.get("targetType") ?? undefined,
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
  const { actor, action, targetType, from, to, page, pageSize } = parsed.data;

  const admin = createAdminSupabase();

  let query = (
    admin as unknown as {
      from: (t: string) => {
        select: (
          cols: string,
          opts?: Record<string, unknown>,
        ) => Record<string, unknown>;
      };
    }
  )
    .from("audit_logs")
    .select(
      "id, actor_id, actor_email, action, target_type, target_id, details, ip_address, user_agent, created_at",
      { count: "exact" },
    ) as unknown as {
    order: (
      c: string,
      o: { ascending: boolean },
    ) => unknown;
  };
  query = query.order("created_at", { ascending: false }) as typeof query;

  const filterable = query as unknown as {
    eq: (k: string, v: string) => typeof filterable;
    ilike: (k: string, v: string) => typeof filterable;
    gte: (k: string, v: string) => typeof filterable;
    lte: (k: string, v: string) => typeof filterable;
    range: (from: number, to: number) => Promise<{
      data: unknown[];
      count: number | null;
      error: { message: string } | null;
    }>;
  };

  let q2 = filterable;
  if (actor) q2 = q2.ilike("actor_email", `%${actor}%`);
  if (action) q2 = q2.eq("action", action);
  if (targetType) q2 = q2.eq("target_type", targetType);
  if (from) q2 = q2.gte("created_at", from);
  if (to) q2 = q2.lte("created_at", to);

  const fromIdx = (page - 1) * pageSize;
  const { data, count, error } = await q2.range(
    fromIdx,
    fromIdx + pageSize - 1,
  );
  if (error) return fail("AUDIT_QUERY_FAILED", error.message, 500);

  return ok({
    items: data ?? [],
    total: count ?? 0,
    page,
    pageSize,
  });
});

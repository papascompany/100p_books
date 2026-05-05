import "server-only";

import { z } from "zod";

import { fail, ok } from "@/app/api/_lib/response";
import { withAdmin } from "@/lib/admin/auth";
import { createAdminSupabase } from "@/lib/db/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATUS_VALUES = [
  "pending",
  "sending",
  "sent",
  "failed",
  "cancelled",
] as const;

const QuerySchema = z.object({
  status: z.enum(STATUS_VALUES).optional(),
  q: z.string().trim().max(120).optional(), // to_email partial 검색
  template: z.string().trim().max(60).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  page: z.coerce.number().int().min(1).max(10000).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

/**
 * GET /api/admin/emails
 *
 *   ?status=&q=&template=&from=ISO&to=ISO&page=1&pageSize=50
 *
 *   email_jobs 리스트 + 검색/필터.
 */
export const GET = withAdmin(async (req) => {
  const url = new URL(req.url);
  const parsed = QuerySchema.safeParse({
    status: url.searchParams.get("status") ?? undefined,
    q: url.searchParams.get("q") ?? undefined,
    template: url.searchParams.get("template") ?? undefined,
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
  const { status, q, template, from, to, page, pageSize } = parsed.data;

  const admin = createAdminSupabase();
  let query = admin
    .from("email_jobs")
    .select(
      "id, template, to_email, to_name, subject, status, attempt, max_attempts, last_error, related_type, related_id, scheduled_at, sent_at, created_at, updated_at",
      { count: "exact" },
    )
    .order("created_at", { ascending: false });

  if (status) query = query.eq("status", status);
  if (template) query = query.eq("template", template);
  if (q) query = query.ilike("to_email", `%${q}%`);
  if (from) query = query.gte("created_at", from);
  if (to) query = query.lte("created_at", to);

  const fromIdx = (page - 1) * pageSize;
  const { data, count, error } = await query.range(
    fromIdx,
    fromIdx + pageSize - 1,
  );
  if (error) return fail("EMAILS_QUERY_FAILED", error.message, 500);

  return ok({
    items: data ?? [],
    total: count ?? 0,
    page,
    pageSize,
  });
});

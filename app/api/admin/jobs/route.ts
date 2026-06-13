import "server-only";

import { z } from "zod";

import { fail, ok } from "@/app/api/_lib/response";
import { withAdmin } from "@/lib/admin/auth";
import { logAdminAction } from "@/lib/admin/audit";
import { createAdminSupabase } from "@/lib/db/admin";
import { retryFailedJob } from "@/lib/pdf/job-runner";
import { storigeOrderPatch } from "@/lib/storige/order-fields";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const STATUS_VALUES = ["pending", "running", "success", "failed"] as const;

const QuerySchema = z.object({
  status: z.enum(STATUS_VALUES).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  page: z.coerce.number().int().min(1).max(10000).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

/**
 * GET /api/admin/jobs — pdf_build_jobs 리스트.
 *  ?status=&from=ISO&to=ISO&page=1&pageSize=50
 */
export const GET = withAdmin(async (req) => {
  const url = new URL(req.url);
  const parsed = QuerySchema.safeParse({
    status: url.searchParams.get("status") ?? undefined,
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
  const { status, from, to, page, pageSize } = parsed.data;

  const admin = createAdminSupabase();

  // 미인덱스/미생성 마이그레이션 환경에서도 안전하게 동작하도록 try-catch.
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
    .from("pdf_build_jobs")
    .select(
      "id, order_id, project_id, user_id, target, status, attempt, max_attempts, last_error, cover_pdf_key, interior_pdf_key, created_at, started_at, finished_at, projects(title), profiles(email)",
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
    gte: (k: string, v: string) => typeof filterable;
    lte: (k: string, v: string) => typeof filterable;
    range: (from: number, to: number) => Promise<{
      data: unknown[];
      count: number | null;
      error: { message: string } | null;
    }>;
  };

  let q2 = filterable;
  if (status) q2 = q2.eq("status", status);
  if (from) q2 = q2.gte("created_at", from);
  if (to) q2 = q2.lte("created_at", to);

  const fromIdx = (page - 1) * pageSize;
  const { data, count, error } = await q2.range(fromIdx, fromIdx + pageSize - 1);
  if (error) return fail("JOBS_QUERY_FAILED", error.message, 500);

  return ok({
    items: data ?? [],
    total: count ?? 0,
    page,
    pageSize,
  });
});

const PostBodySchema = z.object({
  jobId: z.string().uuid(),
});

/**
 * POST /api/admin/jobs — body { jobId } : 실패 잡 재시도.
 */
export const POST = withAdmin(async (req, _ctx, user) => {
  const raw = (await req.json().catch(() => ({}))) as unknown;
  const parsed = PostBodySchema.safeParse(raw);
  if (!parsed.success) {
    return fail(
      "INVALID_BODY",
      "jobId 가 누락되었습니다.",
      400,
      parsed.error.flatten(),
    );
  }
  const { jobId } = parsed.data;

  const admin = createAdminSupabase();
  // order_id 추적 — uploadPath 빌드용
  const { data: jobRow } = await (
    admin as unknown as {
      from: (t: string) => {
        select: (cols: string) => {
          eq: (
            k: string,
            v: string,
          ) => {
            maybeSingle: () => Promise<{
              data: {
                id: string;
                order_id: string | null;
                user_id: string | null;
              } | null;
            }>;
          };
        };
      };
    }
  )
    .from("pdf_build_jobs")
    .select("id, order_id, user_id")
    .eq("id", jobId)
    .maybeSingle();
  if (!jobRow) return fail("NOT_FOUND", "잡을 찾을 수 없습니다.", 404);

  try {
    const result = await retryFailedJob(jobId, {
      signUrls: false,
      uploadPath: jobRow.order_id
        ? (key) =>
            `${jobRow.user_id ?? "anonymous"}/${jobRow.order_id}/${key}`
        : undefined,
      meta: { author: "100p_books" },
      onSuccess: async (r) => {
        if (!jobRow.order_id) return;
        const patch = storigeOrderPatch(r, new Date().toISOString());
        if (Object.keys(patch).length === 0) return;
        const { error: upErr } = await admin
          .from("orders")
          .update(patch)
          .eq("id", jobRow.order_id);
        if (upErr) {
          throw new Error(`orders storige update failed: ${upErr.message}`);
        }
      },
    });

    await logAdminAction({
      actor: { id: user.id, email: user.email },
      action: "pdf.retry",
      targetType: jobRow.order_id ? "order" : "project",
      targetId: jobRow.order_id ?? jobId,
      details: { jobId, attempt: result.attempt },
      request: req,
    });

    return ok({
      retried: true,
      jobId: result.id,
      status: result.status,
      attempt: result.attempt,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await logAdminAction({
      actor: { id: user.id, email: user.email },
      action: "pdf.retry_failed",
      targetType: jobRow.order_id ? "order" : "project",
      targetId: jobRow.order_id ?? jobId,
      details: { jobId, error: msg },
      request: req,
    });
    return fail("RETRY_FAILED", msg, 500);
  }
});

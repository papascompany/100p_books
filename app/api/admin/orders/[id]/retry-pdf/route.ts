import "server-only";

import { fail, ok } from "@/app/api/_lib/response";
import { withAdmin } from "@/lib/admin/auth";
import { logAdminAction } from "@/lib/admin/audit";
import { createAdminSupabase } from "@/lib/db/admin";
import { retryFailedJob } from "@/lib/pdf/job-runner";
import { storigeOrderPatch } from "@/lib/storige/order-fields";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * POST /api/admin/orders/:id/retry-pdf
 *
 *   - 해당 order_id 의 가장 최근 pdf_build_jobs 행이 'failed' 면 재시도.
 *   - 성공 시 onSuccess 에서 orders.cover_pdf_key/interior_pdf_key 갱신.
 *   - 감사 로그 기록.
 */
export const POST = withAdmin<{ id: string }>(async (req, ctx, user) => {
  const orderId = ctx.params.id;
  const admin = createAdminSupabase();

  // 가장 최근 잡 (failed 가 우선이지만 일반화)
  const { data: rows, error } = await (
    admin as unknown as {
      from: (t: string) => {
        select: (cols: string) => {
          eq: (
            k: string,
            v: string,
          ) => {
            order: (
              c: string,
              o: { ascending: boolean },
            ) => {
              limit: (
                n: number,
              ) => Promise<{
                data: Array<{
                  id: string;
                  status: string;
                  user_id: string | null;
                }> | null;
                error: unknown;
              }>;
            };
          };
        };
      };
    }
  )
    .from("pdf_build_jobs")
    .select("id, status, user_id")
    .eq("order_id", orderId)
    .order("created_at", { ascending: false })
    .limit(1);
  if (error) {
    const msg =
      error && typeof error === "object" && "message" in error
        ? String((error as { message: string }).message)
        : "잡 조회 실패";
    return fail("JOB_QUERY_FAILED", msg, 500);
  }
  const latest = rows?.[0];
  if (!latest) {
    return fail("NOT_FOUND", "이 주문의 PDF 빌드 잡이 없습니다.", 404);
  }
  if (latest.status === "success") {
    return fail(
      "ALREADY_SUCCESS",
      "이미 성공한 잡입니다. PDF 재생성은 '/rebuild-pdf' 를 사용하세요.",
      409,
    );
  }
  if (latest.status === "running") {
    return fail("ALREADY_RUNNING", "잡이 실행 중입니다.", 409);
  }

  // 주문 정보 (uploadPath 빌드용)
  const { data: order } = await admin
    .from("orders")
    .select("id, user_id, project_id")
    .eq("id", orderId)
    .maybeSingle();
  if (!order) return fail("NOT_FOUND", "주문을 찾을 수 없습니다.", 404);

  try {
    const result = await retryFailedJob(latest.id, {
      signUrls: false,
      uploadPath: (key) => `${order.user_id}/${order.id}/${key}`,
      meta: { author: "100p_books" },
      onSuccess: async (r) => {
        const patch = storigeOrderPatch(r, new Date().toISOString());
        if (Object.keys(patch).length === 0) return;
        const { error: upErr } = await admin
          .from("orders")
          .update(patch)
          .eq("id", order.id);
        if (upErr) {
          throw new Error(`orders storige update failed: ${upErr.message}`);
        }
      },
    });

    await logAdminAction({
      actor: { id: user.id, email: user.email },
      action: "pdf.retry",
      targetType: "order",
      targetId: orderId,
      details: { jobId: latest.id, attempt: result.attempt },
      request: req,
    });

    return ok({
      retried: true,
      jobId: result.id,
      attempt: result.attempt,
      status: result.status,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await logAdminAction({
      actor: { id: user.id, email: user.email },
      action: "pdf.retry_failed",
      targetType: "order",
      targetId: orderId,
      details: { jobId: latest.id, error: msg },
      request: req,
    });
    return fail("RETRY_FAILED", msg, 500);
  }
});

import "server-only";

import { fail, ok } from "@/app/api/_lib/response";
import { withAdmin } from "@/lib/admin/auth";
import { logAdminAction } from "@/lib/admin/audit";
import { createAdminSupabase } from "@/lib/db/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/admin/emails/[id]/retry
 *
 *   - status='failed' 또는 'cancelled' 잡을 'pending' 으로 reset.
 *   - attempt 도 0으로 리셋 (운영자 의도 = 새로 시도).
 *   - 다음 워커 사이클에서 재발송 시도.
 *
 *   감사 로그: action='email.retry'.
 */
export const POST = withAdmin<{ id: string }>(async (req, ctx, user) => {
  const id = ctx.params.id;
  if (!id) return fail("INVALID_PARAM", "잘못된 잡 ID 입니다.", 400);

  const admin = createAdminSupabase();

  const { data: row, error: getErr } = await admin
    .from("email_jobs")
    .select("id, status, template, to_email")
    .eq("id", id)
    .maybeSingle();
  if (getErr) return fail("EMAIL_JOB_QUERY_FAILED", getErr.message, 500);
  if (!row) return fail("NOT_FOUND", "이메일 잡을 찾을 수 없습니다.", 404);

  if (row.status === "sent") {
    return fail(
      "ALREADY_SENT",
      "이미 발송 완료된 잡입니다.",
      409,
    );
  }
  if (row.status === "sending") {
    return fail(
      "IN_PROGRESS",
      "현재 발송 중인 잡입니다. 잠시 후 다시 시도하세요.",
      409,
    );
  }

  const { error: upErr } = await admin
    .from("email_jobs")
    .update({
      status: "pending",
      attempt: 0,
      last_error: null,
      scheduled_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (upErr) return fail("EMAIL_RETRY_FAILED", upErr.message, 500);

  await logAdminAction({
    actor: { id: user.id, email: user.email },
    action: "email.retry",
    targetType: "email_job",
    targetId: id,
    details: {
      template: row.template,
      to_email: row.to_email,
      previousStatus: row.status,
    },
    request: req,
  });

  return ok({ retried: true, id });
});

import "server-only";

import { fail, ok } from "@/app/api/_lib/response";
import { withAdmin } from "@/lib/admin/auth";
import { logAdminAction } from "@/lib/admin/audit";
import { createAdminSupabase } from "@/lib/db/admin";
import {
  decideAdminEmailRetry,
  staleSendingCutoffIso,
} from "@/lib/email/retry-policy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/admin/emails/[id]/retry
 *
 *   - status='failed'·'cancelled'(·'pending') 잡을 'pending' 으로 reset.
 *   - 'sending' 은 진행 중이면 409 IN_PROGRESS. 다만 STALE_SENDING_MS(10분) 넘게 머문 것은
 *     발송 호출이 강제 종료돼 갇힌 잡이라 재시도를 허용한다(lib/email/retry-policy.ts).
 *     그 사이 Resend 에 실제로 도달했더라도 워커 재발송은 같은 Idempotency-Key 라 중복되지 않는다.
 *     워커도 진입 시 같은 기준으로 자동 복구하므로, 이 경로는 cron 이 멈췄거나 키가 빠진 때의 수동 수단이다.
 *   - attempt 도 0으로 리셋 (운영자 의도 = 새로 시도).
 *   - 다음 워커 사이클에서 재발송 시도.
 *   - reset 은 조회한 상태가 그대로일 때만 적용한다(조건부 UPDATE). 그 사이 워커가 claim·발송했으면
 *     409 EMAIL_JOB_STATE_CHANGED — 발송 중인 잡을 pending 으로 덮어써 두 번 집히게 하지 않는다.
 *
 *   감사 로그: action='email.retry'.
 */
export const POST = withAdmin<{ id: string }>(async (req, ctx, user) => {
  const id = ctx.params.id;
  if (!id) return fail("INVALID_PARAM", "잘못된 잡 ID 입니다.", 400);

  const admin = createAdminSupabase();

  const { data: row, error: getErr } = await admin
    .from("email_jobs")
    .select("id, status, template, to_email, updated_at")
    .eq("id", id)
    .maybeSingle();
  if (getErr) return fail("EMAIL_JOB_QUERY_FAILED", getErr.message, 500);
  if (!row) return fail("NOT_FOUND", "이메일 잡을 찾을 수 없습니다.", 404);

  const nowMs = Date.now();
  const decision = decideAdminEmailRetry(row, nowMs);
  if (!decision.ok) return fail(decision.code, decision.message, 409);

  let reset = admin
    .from("email_jobs")
    .update({
      status: "pending",
      attempt: 0,
      last_error: null,
      scheduled_at: new Date(nowMs).toISOString(),
    })
    .eq("id", id)
    .eq("status", row.status);
  if (decision.staleSending) {
    // 조회 뒤 워커가 복구·재claim 했다면 updated_at 이 새로워져 매칭되지 않는다.
    reset = reset.lt("updated_at", staleSendingCutoffIso(nowMs));
  }
  const { data: resetRows, error: upErr } = await reset.select("id");
  if (upErr) return fail("EMAIL_RETRY_FAILED", upErr.message, 500);
  if (!resetRows || resetRows.length === 0) {
    return fail(
      "EMAIL_JOB_STATE_CHANGED",
      "잡 상태가 방금 바뀌었습니다. 새로고침 후 다시 시도하세요.",
      409,
    );
  }

  await logAdminAction({
    actor: { id: user.id, email: user.email },
    action: "email.retry",
    targetType: "email_job",
    targetId: id,
    details: {
      template: row.template,
      to_email: row.to_email,
      previousStatus: row.status,
      ...(decision.staleSending ? { staleSending: true } : {}),
    },
    request: req,
  });

  return ok({ retried: true, id });
});

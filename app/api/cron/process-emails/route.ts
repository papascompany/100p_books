import "server-only";

import { fail, failFromError, ok } from "@/app/api/_lib/response";
import { processEmailQueue } from "@/lib/email/worker";
import { verifyCronRequest } from "@/lib/security/cron-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * GET /api/cron/process-emails
 *
 * Vercel Cron 으로 5분마다 호출(vercel.json `crons`). Pro 플랜 최소 주기는 분당 1회라
 * 허용 범위다(Hobby 는 하루 1회 — 예전 daily 스케줄은 그 제약 우회였다).
 *
 * 한 번 호출에 워커가 시간 예산(기본 40s — maxDuration 60s 보다 충분히 짧게) 안에서
 * 배치를 반복 소진하고, Resend 기본 rate limit(팀당 10 req/s)의 절반 속도로 발송한다.
 * 다 못 비운 잡은 다음 5분 호출이 이어받는다. 상세는 lib/email/worker.ts.
 *
 * 중복 발송 방지: enqueueEmail 의 즉시 발송이 진행 중일 수 있는 생성 6분 이내 잡은 건너뛰고
 * (IMMEDIATE_SEND_GRACE_MS), 발송마다 잡 id + payload 기반 Resend Idempotency-Key 를 붙인다.
 * 그래서 즉시 발송에 실패한 잡은 생성 후 6분 + 최대 5분 뒤에 재시도된다.
 *
 * 인증: `Authorization: Bearer <CRON_SECRET>` 만 인정 — CRON_SECRET 이 있으면 Vercel 이
 *   자동으로 붙인다. 규칙 상세는 lib/security/cron-auth.ts (SEC-14).
 *
 * 응답: { processed, sent, failed, skipped, batches, stopReason, recovered, durationMs }
 *   - recovered: 10분 넘게 'sending' 에 갇혀 있다가 이번 호출에서 'failed' 로 되돌린 잡 수(reaper).
 *   - 실패한 잡은 백오프(5분 → 30분 → 2시간) 뒤에 재시도된다(lib/email/retry-policy.ts).
 *   - stopReason: 적체 신호는 max_jobs(상한을 넘는 대상이 실제로 더 있음)·time_budget 뿐.
 *     rate_limited·consecutive_failures 는 Resend 한도·장애·설정 오류, drained 는 지금 대상 없음.
 *   - RESEND_API_KEY 미설정이면 { …, deferred: true, queued } — 큐는 보존된다.
 */
export async function GET(req: Request) {
  try {
    const cronAuth = verifyCronRequest(req);
    if (!cronAuth.ok) {
      return fail(cronAuth.code, cronAuth.message, cronAuth.status);
    }

    const start = Date.now();
    const result = await processEmailQueue();
    return ok({
      ...result,
      durationMs: Date.now() - start,
    });
  } catch (err) {
    return failFromError(err);
  }
}

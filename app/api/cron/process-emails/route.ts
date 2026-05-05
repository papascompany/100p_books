import "server-only";

import { fail, failFromError, ok } from "@/app/api/_lib/response";
import { processEmailQueue } from "@/lib/email/worker";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * GET /api/cron/process-emails
 *
 * Vercel Cron 으로 5분마다 호출. 인증:
 *   - `Authorization: Bearer <CRON_SECRET>` 검증.
 *   - Vercel 자체 cron 은 `x-vercel-cron: 1` 헤더 + 자동 Authorization 부여.
 *
 * 응답: { processed, sent, failed, skipped, durationMs }
 */
export async function GET(req: Request) {
  try {
    const auth = req.headers.get("authorization") ?? "";
    const expected = `Bearer ${process.env.CRON_SECRET ?? ""}`;
    const isVercelCron = req.headers.get("x-vercel-cron") === "1";

    // CRON_SECRET 미설정이면 외부 호출 거부 (Vercel Cron 만 통과).
    if (!process.env.CRON_SECRET && !isVercelCron) {
      return fail(
        "CRON_NOT_CONFIGURED",
        "CRON_SECRET 이 설정되지 않았습니다.",
        500,
      );
    }
    if (!isVercelCron && process.env.CRON_SECRET && auth !== expected) {
      return fail("UNAUTHORIZED", "인증 헤더가 올바르지 않습니다.", 401);
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

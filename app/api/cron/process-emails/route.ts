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
    // CRON_SECRET 이 설정되면 항상 Bearer 검증을 강제한다 (x-vercel-cron 헤더
    // 단독 신뢰 회피 — 방어 심화). Vercel Cron 은 CRON_SECRET 존재 시
    // Authorization: Bearer 를 자동 부여하므로 실제 cron 은 그대로 통과.
    // CRON_SECRET 미설정 시에만 x-vercel-cron 으로 fallback (수동 호출 차단).
    const auth = req.headers.get("authorization") ?? "";
    const secret = process.env.CRON_SECRET;
    const isVercelCron = req.headers.get("x-vercel-cron") === "1";
    if (secret) {
      if (auth !== `Bearer ${secret}`) {
        return fail("UNAUTHORIZED", "인증 헤더가 올바르지 않습니다.", 401);
      }
    } else if (!isVercelCron) {
      return fail("CRON_NOT_CONFIGURED", "CRON_SECRET 이 설정되지 않았습니다.", 500);
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

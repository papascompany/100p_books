import "server-only";

import { fail, failFromError, ok } from "@/app/api/_lib/response";
import { createAdminSupabase } from "@/lib/db/admin";
import {
  PDF_JOB_REAP_BATCH_DEFAULT,
  reapStalePdfJobs,
  STALE_TIME_COLUMN,
  type PdfJobCandidate,
  type PdfJobReaperPort,
} from "@/lib/pdf/job-reaper";
import { verifyCronRequest } from "@/lib/security/cron-auth";

export const dynamic = "force-dynamic";
/** ⚠️ 필수 — orphan-photos 선례. 캐시된 조회 스냅샷으로 막 재시도된 잡을 되돌리지 않게. */
export const fetchCache = "force-no-store";
export const runtime = "nodejs";
export const maxDuration = 60;

const ID_CHUNK = 100;

/**
 * GET /api/cron/reap-pdf-jobs
 *
 * 고착된 PDF 빌드 잡 정리 (DEBT-8) — 함수 강제 종료로 running/pending 에 남은 pdf_build_jobs 를
 * failed 로 되돌려 관리자 주문 화면에서 'PDF 빌드 재시도'·'PDF 재생성'으로 복구할 수 있게 한다.
 * 규칙·임계(maxDuration 300초 × 3 = 15분) 근거는 lib/pdf/job-reaper.ts.
 *
 *   - 결제 주문(order_id 있음)의 잡을 되돌리면 console.error 로 주문 id 와 복구 경로를 남긴다
 *     (결제된 주문의 인쇄 PDF 가 빠졌다는 뜻 — 로그 알림 대상).
 *   - 사용자 직접 빌드(order_id 없음)는 되돌리기만 한다(사용자가 에디터에서 다시 빌드).
 *
 * 인증: `Authorization: Bearer <CRON_SECRET>` 만 인정 (lib/security/cron-auth.ts).
 * `?dryRun=1` — 상태를 바꾸지 않고 되돌릴 예정인 잡만 반환한다.
 */
export async function GET(req: Request) {
  try {
    const cronAuth = verifyCronRequest(req);
    if (!cronAuth.ok) {
      return fail(cronAuth.code, cronAuth.message, cronAuth.status);
    }

    const dryRun = new URL(req.url).searchParams.get("dryRun") === "1";
    const start = Date.now();
    const limit = parsePositiveInt(
      process.env.PDF_JOB_REAP_BATCH,
      PDF_JOB_REAP_BATCH_DEFAULT,
    );

    const result = await reapStalePdfJobs(supabasePort(), {
      now: new Date(),
      dryRun,
      limit,
    });

    if (!dryRun) {
      for (const job of result.jobs) {
        if (!job.orderId) continue;
        console.error(
          "[cron/reap-pdf-jobs] 결제 주문의 PDF 빌드 잡이 고착돼 failed 로 되돌림 — 관리자 확인 필요",
          {
            orderId: job.orderId,
            jobId: job.id,
            previousStatus: job.previousStatus,
            attempt: `${job.attempt}/${job.maxAttempts}`,
            recovery: job.retryable ? "PDF 빌드 재시도 또는 PDF 재생성" : "PDF 재생성",
          },
        );
      }
    }

    return ok({
      dryRun: result.dryRun,
      staleAfterSec: result.staleAfterSec,
      cutoff: result.cutoff,
      scanned: result.scanned,
      ...(result.dryRun ? { wouldReap: result.jobs.length } : { reaped: result.jobs.length }),
      jobs: result.jobs,
      truncated: result.truncated,
      durationMs: Date.now() - start,
    });
  } catch (err) {
    return failFromError(err);
  }
}

function dbError(code: string, message: string): Error {
  return Object.assign(new Error(message), { status: 500, code });
}

type PgError = { message: string } | null;

/**
 * pdf_build_jobs 는 lib/db/types.ts 의 Database 에 없어(lib/pdf/job-runner.ts 와 같은 사정)
 * 이 라우트가 쓰는 쿼리 모양만 구조 타입으로 좁혀 쓴다.
 */
interface JobsFilter<R> extends PromiseLike<R> {
  eq(column: string, value: string): JobsFilter<R>;
  lt(column: string, value: string): JobsFilter<R>;
  in(column: string, values: string[]): JobsFilter<R>;
  order(column: string, opts: { ascending: boolean }): JobsFilter<R>;
  limit(n: number): JobsFilter<R>;
}

interface JobsTable {
  select(columns: string): JobsFilter<{ data: PdfJobCandidate[] | null; error: PgError }>;
  update(values: Record<string, unknown>): {
    in(column: string, values: string[]): {
      eq(column: string, value: string): {
        lt(column: string, value: string): {
          select(columns: string): PromiseLike<{
            data: Array<{ id: string }> | null;
            error: PgError;
          }>;
        };
      };
    };
  };
}

function jobsTable(): JobsTable {
  const admin = createAdminSupabase() as unknown as {
    from: (table: "pdf_build_jobs") => JobsTable;
  };
  return admin.from("pdf_build_jobs");
}

function supabasePort(): PdfJobReaperPort {
  return {
    async listStale({ status, before, limit }) {
      const column = STALE_TIME_COLUMN[status];
      const { data, error } = await jobsTable()
        .select("id, order_id, status, attempt, max_attempts, created_at, started_at")
        .eq("status", status)
        .lt(column, before)
        .order(column, { ascending: true })
        .limit(limit);
      if (error) throw dbError("JOBS_QUERY_FAILED", error.message);
      return data ?? [];
    },

    async markFailed({ ids, status, before, lastError, finishedAt }) {
      const column = STALE_TIME_COLUMN[status];
      const changed: string[] = [];
      for (let i = 0; i < ids.length; i += ID_CHUNK) {
        const slice = ids.slice(i, i + ID_CHUNK);
        // WHERE 에 상태·기준 시각을 다시 건다 — 조회 뒤 관리자가 재시도해 새로 running 이 된 잡은 빗나간다.
        const { data, error } = await jobsTable()
          .update({ status: "failed", last_error: lastError, finished_at: finishedAt })
          .in("id", slice)
          .eq("status", status)
          .lt(column, before)
          .select("id");
        if (error) throw dbError("JOBS_UPDATE_FAILED", error.message);
        for (const row of data ?? []) changed.push(row.id);
      }
      return changed;
    },
  };
}

function parsePositiveInt(v: string | undefined, fallback: number): number {
  const n = v ? Number.parseInt(v, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

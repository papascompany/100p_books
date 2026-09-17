/**
 * PDF 빌드 잡 고착 정리(reaper) 규칙 (DEBT-8).
 *
 * 문제: runPdfJob(lib/pdf/job-runner.ts)은 빌드 전에 status='running' 을 찍고, 'failed' 로 바꾸는
 * 코드는 JS catch 안에만 있다. 결제 confirm 의 waitUntil 백그라운드 빌드가 maxDuration 초과나
 * 메모리 부족으로 **함수째 종료**되면 catch 가 돌지 않아 잡이 running 에 영구히 남는다.
 * 관리자 주문 화면은 running 잡에 재시도 버튼을 보여 주지 않고(retry-pdf 도 409 ALREADY_RUNNING),
 * 운영자는 PDF 가 조용히 빠진 결제 주문을 알아채기 어렵다.
 *
 * 규칙:
 *   - running 이 started_at 기준 PDF_JOB_STALE_AFTER_SEC 를 넘기면 failed 로 되돌린다.
 *   - pending 이 created_at 기준 같은 시간을 넘기면 failed 로 되돌린다.
 *     (enqueue 직후 곧바로 runPdfJob 이 running 을 찍으므로, 오래된 pending 은
 *      빌드 시작 전에 함수가 종료된 흔적이다 — 현재 pending 을 나중에 집어 가는 워커는 없다.)
 *   - failed 가 되면 관리자 주문 화면에 '마지막 빌드 에러' 와 'PDF 빌드 재시도'(시도 횟수가 남은 경우)
 *     버튼이 뜨고, 'PDF 재생성'(rebuild-pdf, paid·in_production)은 잡과 무관하게 항상 쓸 수 있다.
 *
 * 임계값 근거: 잡을 실행하는 라우트의 maxDuration 은 모두 300초다
 *   (payments/confirm·pdf/build 는 vercel.json functions 와 route export,
 *    admin/jobs·admin/orders/[id]/retry-pdf 는 route export). Vercel 은 maxDuration 에서
 *   함수를 강제 종료하므로 300초를 넘긴 running 은 살아 있을 수 없다. 시계 오차·DB 쓰기 지연을
 *   넉넉히 덮으려고 3배(15분)를 기다린다. lib/pdf/job-reaper.test.ts 가 maxDuration 드리프트를 막는다.
 *
 * 이 파일은 DB 를 직접 부르지 않는다 — 조회·갱신은 포트로 주입받는다(라우트가 Supabase 어댑터 제공).
 */

/** 잡을 실행하는 라우트 중 가장 긴 maxDuration(초). */
export const PDF_JOB_MAX_RUNTIME_SEC = 300;

/** maxDuration 의 몇 배를 넘기면 고착으로 판정하는가. */
export const PDF_JOB_STALE_MULTIPLIER = 3;

/** 고착 판정 시간(초) = 15분. */
export const PDF_JOB_STALE_AFTER_SEC =
  PDF_JOB_MAX_RUNTIME_SEC * PDF_JOB_STALE_MULTIPLIER;

/** 한 번 실행에서 상태별로 볼 최대 건수 기본값. */
export const PDF_JOB_REAP_BATCH_DEFAULT = 100;

export type ReapableJobStatus = "running" | "pending";

/** 상태별 고착 판정 기준 시각 컬럼 — 조회와 조건부 UPDATE 가 같은 컬럼을 써야 한다. */
export const STALE_TIME_COLUMN: Record<ReapableJobStatus, "started_at" | "created_at"> = {
  running: "started_at",
  pending: "created_at",
};

export interface PdfJobCandidate {
  id: string;
  order_id: string | null;
  status: "pending" | "running" | "success" | "failed";
  attempt: number;
  max_attempts: number;
  created_at: string;
  started_at: string | null;
}

export function pdfJobStaleCutoff(
  now: Date,
  staleAfterSec: number = PDF_JOB_STALE_AFTER_SEC,
): Date {
  return new Date(now.getTime() - staleAfterSec * 1000);
}

/** 판정 기준 시각 — running 인데 started_at 이 비어 있으면(비정상) created_at 으로 대신한다. */
function referenceTime(job: PdfJobCandidate): number {
  const iso =
    job.status === "running" ? (job.started_at ?? job.created_at) : job.created_at;
  return Date.parse(iso);
}

export interface PdfJobReapPlan {
  running: PdfJobCandidate[];
  pending: PdfJobCandidate[];
  /** 아직 임계 전·시각 해석 불가·이미 종결(success/failed) 이라 건너뛴 건수. */
  skipped: number;
}

/**
 * 조회된 후보를 규칙으로 다시 거른다 — DB 필터가 바뀌어도 살아 있을 수 있는 잡을
 * failed 로 덮지 않게 하는 이중 방어.
 */
export function planPdfJobReap(
  rows: readonly PdfJobCandidate[],
  now: Date,
  staleAfterSec: number = PDF_JOB_STALE_AFTER_SEC,
): PdfJobReapPlan {
  const cutoffMs = pdfJobStaleCutoff(now, staleAfterSec).getTime();
  const plan: PdfJobReapPlan = { running: [], pending: [], skipped: 0 };
  for (const job of rows) {
    if (job.status !== "running" && job.status !== "pending") {
      plan.skipped += 1;
      continue;
    }
    const t = referenceTime(job);
    // 해석 불가·경계값은 건너뛴다 — 애매하면 다음 실행으로 미룬다.
    if (!Number.isFinite(t) || t >= cutoffMs) {
      plan.skipped += 1;
      continue;
    }
    plan[job.status].push(job);
  }
  return plan;
}

/** failed 로 되돌릴 때 last_error 에 남기는 문구 — 관리자 주문 화면에 그대로 보인다. */
export function reapedJobError(
  status: ReapableJobStatus,
  staleAfterSec: number = PDF_JOB_STALE_AFTER_SEC,
): string {
  const minutes = Math.round(staleAfterSec / 60);
  const cause =
    status === "running"
      ? `시작 후 ${minutes}분이 지나도록 끝나지 않았습니다 — 함수 강제 종료(실행 시간 ${PDF_JOB_MAX_RUNTIME_SEC}초 초과·메모리 부족 등)로 판정했습니다.`
      : `등록 후 ${minutes}분이 지나도록 시작되지 않았습니다 — 빌드 시작 전에 함수가 종료된 것으로 판정했습니다.`;
  return (
    `[reaper] ${cause} ` +
    "관리자 주문 화면에서 'PDF 빌드 재시도'(시도 횟수가 남은 경우) 또는 'PDF 재생성'으로 복구하세요."
  );
}

export interface PdfJobReaperPort {
  /** status 가 같고 STALE_TIME_COLUMN[status] < before 인 잡을 오래된 순으로 limit 건. */
  listStale(args: {
    status: ReapableJobStatus;
    before: string;
    limit: number;
  }): Promise<PdfJobCandidate[]>;
  /**
   * 조건부 UPDATE → failed. `status` 와 `STALE_TIME_COLUMN[status] < before` 를 WHERE 에 다시 건다
   * (조회 뒤 관리자가 재시도해 새로 running 이 된 잡은 started_at 이 새로워 빗나간다).
   * 실제로 바뀐 id 를 돌려준다.
   */
  markFailed(args: {
    ids: string[];
    status: ReapableJobStatus;
    before: string;
    lastError: string;
    finishedAt: string;
  }): Promise<string[]>;
}

export interface ReapedJobSummary {
  id: string;
  orderId: string | null;
  previousStatus: ReapableJobStatus;
  attempt: number;
  maxAttempts: number;
  /** 관리자 'PDF 빌드 재시도' 가 가능한가(아니면 'PDF 재생성'). */
  retryable: boolean;
}

export interface PdfJobReapResult {
  dryRun: boolean;
  staleAfterSec: number;
  cutoff: string;
  scanned: number;
  /** dryRun 이면 되돌릴 예정, 아니면 실제로 되돌린 잡. */
  jobs: ReapedJobSummary[];
  /** 상태별 조회가 limit 에 걸렸는가 — true 면 다음 실행에서 이어서 처리된다. */
  truncated: boolean;
}

function summarize(job: PdfJobCandidate, status: ReapableJobStatus): ReapedJobSummary {
  return {
    id: job.id,
    orderId: job.order_id,
    previousStatus: status,
    attempt: job.attempt,
    maxAttempts: job.max_attempts,
    retryable: job.attempt < job.max_attempts,
  };
}

export async function reapStalePdfJobs(
  port: PdfJobReaperPort,
  opts: {
    now: Date;
    dryRun: boolean;
    limit?: number;
    staleAfterSec?: number;
  },
): Promise<PdfJobReapResult> {
  const staleAfterSec = opts.staleAfterSec ?? PDF_JOB_STALE_AFTER_SEC;
  const limit = opts.limit ?? PDF_JOB_REAP_BATCH_DEFAULT;
  const cutoff = pdfJobStaleCutoff(opts.now, staleAfterSec).toISOString();

  const running = await port.listStale({ status: "running", before: cutoff, limit });
  const pending = await port.listStale({ status: "pending", before: cutoff, limit });
  const plan = planPdfJobReap([...running, ...pending], opts.now, staleAfterSec);
  const base = {
    staleAfterSec,
    cutoff,
    scanned: running.length + pending.length,
    truncated: running.length >= limit || pending.length >= limit,
  };

  if (opts.dryRun) {
    return {
      ...base,
      dryRun: true,
      jobs: [
        ...plan.running.map((j) => summarize(j, "running")),
        ...plan.pending.map((j) => summarize(j, "pending")),
      ],
    };
  }

  const finishedAt = opts.now.toISOString();
  const jobs: ReapedJobSummary[] = [];
  for (const status of ["running", "pending"] as const) {
    const targets = plan[status];
    if (targets.length === 0) continue;
    const changed = new Set(
      await port.markFailed({
        ids: targets.map((j) => j.id),
        status,
        before: cutoff,
        lastError: reapedJobError(status, staleAfterSec),
        finishedAt,
      }),
    );
    for (const job of targets) {
      if (changed.has(job.id)) jobs.push(summarize(job, status));
    }
  }
  return { ...base, dryRun: false, jobs };
}

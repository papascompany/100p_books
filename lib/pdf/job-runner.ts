import "server-only";

import { createAdminSupabase } from "@/lib/db/admin";

import { runProjectPdfBuild, PdfBuildError, type BuildTarget } from "./build-job";

/**
 * pdf_build_jobs 영속 큐 매니저.
 *
 *   - enqueuePdfJob: row INSERT (status=pending).
 *   - runPdfJob:     status=running → runProjectPdfBuild → success/failed 갱신.
 *   - retryFailedJob: attempt < max_attempts 일 때 다시 runPdfJob.
 *
 * 운영 환경에서는 별도 워커가 필요하지만, 현재는 인라인 호출 + Vercel cron 패턴으로
 * 시작 (cron 으로 status='pending' 또는 'failed' 잡을 주기적으로 재시도하도록 확장 가능).
 *
 * 모든 storage 쓰기는 admin (service_role) 으로 수행.
 */

export interface EnqueuePdfJobArgs {
  orderId?: string | null;
  projectId: string;
  userId: string;
  target: BuildTarget;
  maxAttempts?: number;
}

export interface PdfBuildJobRow {
  id: string;
  order_id: string | null;
  project_id: string;
  user_id: string | null;
  target: BuildTarget;
  status: "pending" | "running" | "success" | "failed";
  attempt: number;
  max_attempts: number;
  last_error: string | null;
  cover_pdf_key: string | null;
  interior_pdf_key: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}

interface RunOptions {
  /** 결제 confirm 등에서 결과 키를 orders 에 반영하기 위한 콜백. */
  onSuccess?: (result: {
    coverKey?: string;
    interiorKey?: string;
  }) => Promise<void>;
  /** PDF 메타. */
  meta?: { title?: string; author?: string };
  /** uploadPath 빌더. */
  uploadPath?: (key: "cover.pdf" | "interior.pdf") => string;
  /** signed URL 발급 여부 (기본 false — 빌드 잡은 키만 보존). */
  signUrls?: boolean;
}

/** 새 빌드 잡 등록. */
export async function enqueuePdfJob(
  args: EnqueuePdfJobArgs,
): Promise<{ jobId: string }> {
  const admin = createAdminSupabase();
  const insertRow: Record<string, unknown> = {
    order_id: args.orderId ?? null,
    project_id: args.projectId,
    user_id: args.userId,
    target: args.target,
    status: "pending",
    attempt: 0,
    max_attempts: args.maxAttempts ?? 3,
  };
  // pdf_build_jobs 테이블은 0011 에서 생성됨 — 마이그레이션 미적용 환경 보호:
  const { data, error } = await (
    admin as unknown as {
      from: (t: string) => {
        insert: (v: Record<string, unknown>) => {
          select: (
            cols: string,
          ) => { single: () => Promise<{ data: { id: string } | null; error: unknown }> };
        };
      };
    }
  )
    .from("pdf_build_jobs")
    .insert(insertRow)
    .select("id")
    .single();
  if (error || !data) {
    const msg =
      error && typeof error === "object" && "message" in error
        ? String((error as { message: string }).message)
        : "enqueue failed";
    throw new Error(`[pdf/job-runner] ${msg}`);
  }
  return { jobId: data.id };
}

/** 빌드 잡 1건 조회. */
export async function getPdfJob(jobId: string): Promise<PdfBuildJobRow | null> {
  const admin = createAdminSupabase();
  const { data, error } = await (
    admin as unknown as {
      from: (t: string) => {
        select: (cols: string) => {
          eq: (
            k: string,
            v: string,
          ) => {
            maybeSingle: () => Promise<{
              data: PdfBuildJobRow | null;
              error: unknown;
            }>;
          };
        };
      };
    }
  )
    .from("pdf_build_jobs")
    .select(
      "id, order_id, project_id, user_id, target, status, attempt, max_attempts, last_error, cover_pdf_key, interior_pdf_key, created_at, started_at, finished_at",
    )
    .eq("id", jobId)
    .maybeSingle();
  if (error) return null;
  return data;
}

/**
 * 잡 실행 (status=pending|failed → running → success|failed).
 *
 *   - attempt 1 증가, started_at 갱신.
 *   - runProjectPdfBuild 성공 시 cover/interior key 저장 + status=success.
 *   - 실패 시 last_error + status=failed.
 *   - onSuccess 콜백 — 결제 confirm 에서 orders.cover_pdf_key/interior_pdf_key 갱신용.
 */
export async function runPdfJob(
  jobId: string,
  opts: RunOptions = {},
): Promise<PdfBuildJobRow> {
  const admin = createAdminSupabase();
  const job = await getPdfJob(jobId);
  if (!job) throw new Error(`[pdf/job-runner] job not found: ${jobId}`);

  // 상태 가드 — 이미 success 면 노옵.
  if (job.status === "success") return job;

  // attempt 한계
  if (job.status === "failed" && job.attempt >= job.max_attempts) {
    throw new Error(
      `[pdf/job-runner] job ${jobId} 최대 시도 초과 (${job.attempt}/${job.max_attempts})`,
    );
  }

  // running 마킹
  const newAttempt = job.attempt + 1;
  await (admin as unknown as {
    from: (t: string) => {
      update: (
        v: Record<string, unknown>,
      ) => { eq: (k: string, v: string) => Promise<unknown> };
    };
  })
    .from("pdf_build_jobs")
    .update({
      status: "running",
      attempt: newAttempt,
      started_at: new Date().toISOString(),
      last_error: null,
    })
    .eq("id", jobId);

  try {
    const result = await runProjectPdfBuild({
      projectId: job.project_id,
      userId: job.user_id ?? "anonymous",
      target: job.target,
      uploadPath: opts.uploadPath,
      signUrls: opts.signUrls ?? false,
      meta: opts.meta,
    });

    // success 갱신
    const patch: Record<string, unknown> = {
      status: "success",
      finished_at: new Date().toISOString(),
      last_error: null,
    };
    if (result.coverKey) patch.cover_pdf_key = result.coverKey;
    if (result.interiorKey) patch.interior_pdf_key = result.interiorKey;
    await (admin as unknown as {
      from: (t: string) => {
        update: (
          v: Record<string, unknown>,
        ) => { eq: (k: string, v: string) => Promise<unknown> };
      };
    })
      .from("pdf_build_jobs")
      .update(patch)
      .eq("id", jobId);

    if (opts.onSuccess) {
      try {
        await opts.onSuccess({
          coverKey: result.coverKey,
          interiorKey: result.interiorKey,
        });
      } catch (e) {
        console.warn(
          "[pdf/job-runner] onSuccess callback failed:",
          e instanceof Error ? e.message : String(e),
        );
      }
    }

    const updated = await getPdfJob(jobId);
    return updated ?? job;
  } catch (e) {
    const msg =
      e instanceof PdfBuildError
        ? e.message
        : e instanceof Error
          ? e.message
          : String(e);
    await (admin as unknown as {
      from: (t: string) => {
        update: (
          v: Record<string, unknown>,
        ) => { eq: (k: string, v: string) => Promise<unknown> };
      };
    })
      .from("pdf_build_jobs")
      .update({
        status: "failed",
        finished_at: new Date().toISOString(),
        last_error: msg.slice(0, 2000),
      })
      .eq("id", jobId);
    throw e;
  }
}

/**
 * 실패한 잡 재시도. attempt < max_attempts 인 경우에만.
 * 성공 시 PdfBuildJobRow 반환, 한도 초과 시 throw.
 */
export async function retryFailedJob(
  jobId: string,
  opts: RunOptions = {},
): Promise<PdfBuildJobRow> {
  const job = await getPdfJob(jobId);
  if (!job) throw new Error(`[pdf/job-runner] job not found: ${jobId}`);
  if (job.status === "success") return job;
  if (job.attempt >= job.max_attempts) {
    throw new Error(
      `[pdf/job-runner] 최대 재시도 횟수 초과 (${job.attempt}/${job.max_attempts})`,
    );
  }
  return runPdfJob(jobId, opts);
}

/**
 * 결제 confirm 등 "즉시 실행" 시나리오용 통합 헬퍼.
 *  - enqueue + run 을 묶어서 처리.
 *  - 실패해도 throw 하지 않고 jobId + error 반환 (호출자가 결제 자체는 살리도록).
 */
export async function enqueueAndRunPdfJob(
  args: EnqueuePdfJobArgs,
  opts: RunOptions = {},
): Promise<{ jobId: string; ok: boolean; error?: string }> {
  let jobId: string;
  try {
    const enq = await enqueuePdfJob(args);
    jobId = enq.jobId;
  } catch (e) {
    return {
      jobId: "",
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }

  try {
    await runPdfJob(jobId, opts);
    return { jobId, ok: true };
  } catch (e) {
    return {
      jobId,
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

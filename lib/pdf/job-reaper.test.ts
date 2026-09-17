import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import {
  PDF_JOB_MAX_RUNTIME_SEC,
  PDF_JOB_STALE_AFTER_SEC,
  planPdfJobReap,
  reapedJobError,
  reapStalePdfJobs,
  STALE_TIME_COLUMN,
  type PdfJobCandidate,
  type PdfJobReaperPort,
} from "./job-reaper";

const NOW = new Date("2026-09-17T12:00:00.000Z");
const MIN = 60_000;

function iso(msAgo: number): string {
  return new Date(NOW.getTime() - msAgo).toISOString();
}

function job(over: Partial<PdfJobCandidate> & { id: string }): PdfJobCandidate {
  return {
    order_id: "order-1",
    status: "running",
    attempt: 1,
    max_attempts: 3,
    created_at: iso(30 * MIN),
    started_at: iso(30 * MIN),
    ...over,
  };
}

describe("임계값 — 잡을 실행하는 라우트의 maxDuration 드리프트 가드", () => {
  /**
   * pdf_build_jobs 를 running 으로 만드는 라우트 = lib/pdf/job-runner 호출처.
   *   payments/confirm(enqueuePdfJob·runPdfJob), pdf/build(enqueueAndRunPdfJob),
   *   admin/jobs·admin/orders/[id]/retry-pdf(retryFailedJob).
   */
  const JOB_ROUTES = [
    "app/api/payments/confirm/route.ts",
    "app/api/pdf/build/route.ts",
    "app/api/admin/jobs/route.ts",
    "app/api/admin/orders/[id]/retry-pdf/route.ts",
  ];

  it("각 라우트의 maxDuration(route export·vercel.json) ≤ PDF_JOB_MAX_RUNTIME_SEC", () => {
    const vercel = JSON.parse(readFileSync("vercel.json", "utf8")) as {
      functions?: Record<string, { maxDuration?: number }>;
    };
    for (const file of JOB_ROUTES) {
      const src = readFileSync(file, "utf8");
      const m = src.match(/export const maxDuration\s*=\s*(\d+)/);
      // maxDuration 이 없으면 플랫폼 기본값이 적용돼 이 가드가 의미를 잃는다 — 명시를 강제한다.
      expect(m, `${file} 에 maxDuration export 가 없습니다`).not.toBeNull();
      expect(Number(m?.[1]), file).toBeLessThanOrEqual(PDF_JOB_MAX_RUNTIME_SEC);
      const cfg = vercel.functions?.[file]?.maxDuration;
      if (cfg !== undefined) expect(cfg, `vercel.json ${file}`).toBeLessThanOrEqual(PDF_JOB_MAX_RUNTIME_SEC);
    }
  });

  it("고착 판정은 maxDuration 의 2배 이상 여유를 둔다", () => {
    expect(PDF_JOB_STALE_AFTER_SEC).toBeGreaterThanOrEqual(PDF_JOB_MAX_RUNTIME_SEC * 2);
    expect(PDF_JOB_STALE_AFTER_SEC).toBe(900);
  });

  it("reap cron 은 vercel.json crons 에 등록돼 있고 판정 시간보다 자주 돈다", () => {
    const vercel = JSON.parse(readFileSync("vercel.json", "utf8")) as {
      crons?: Array<{ path: string; schedule: string }>;
    };
    const cron = vercel.crons?.find((c) => c.path === "/api/cron/reap-pdf-jobs");
    expect(cron?.schedule).toBe("*/10 * * * *");
  });
});

describe("planPdfJobReap", () => {
  it("running 은 started_at, pending 은 created_at 기준으로 15분 초과만 대상", () => {
    const plan = planPdfJobReap(
      [
        job({ id: "run-old" }),
        job({ id: "run-fresh", started_at: iso(10 * MIN), created_at: iso(40 * MIN) }),
        job({ id: "pend-old", status: "pending", started_at: null, created_at: iso(16 * MIN) }),
        job({ id: "pend-fresh", status: "pending", started_at: null, created_at: iso(5 * MIN) }),
        job({ id: "done", status: "success" }),
        job({ id: "failed", status: "failed" }),
      ],
      NOW,
    );
    expect(plan.running.map((j) => j.id)).toEqual(["run-old"]);
    expect(plan.pending.map((j) => j.id)).toEqual(["pend-old"]);
    expect(plan.skipped).toBe(4);
  });

  it("관리자 재시도로 started_at 이 새로워진 running 은 created_at 이 오래돼도 건드리지 않는다", () => {
    const plan = planPdfJobReap(
      [job({ id: "retried", created_at: iso(3 * 24 * 60 * MIN), started_at: iso(1 * MIN) })],
      NOW,
    );
    expect(plan.running).toEqual([]);
  });

  it("경계값(정확히 15분)·해석 불가 시각은 건너뛰고, started_at 없는 running 은 created_at 으로 판정", () => {
    const plan = planPdfJobReap(
      [
        job({ id: "boundary", started_at: iso(15 * MIN) }),
        job({ id: "garbage", started_at: "nope" }),
        job({ id: "no-start", started_at: null, created_at: iso(20 * MIN) }),
      ],
      NOW,
    );
    expect(plan.running.map((j) => j.id)).toEqual(["no-start"]);
    expect(plan.skipped).toBe(2);
  });
});

describe("reapedJobError — 관리자 화면에 보이는 복구 안내", () => {
  it("원인과 복구 버튼 이름을 함께 남긴다", () => {
    const running = reapedJobError("running");
    expect(running).toContain("15분");
    expect(running).toContain("300초");
    expect(running).toContain("PDF 빌드 재시도");
    expect(running).toContain("PDF 재생성");
    expect(reapedJobError("pending")).toContain("시작되지 않았습니다");
  });
});

function fakePort(byStatus: { running?: PdfJobCandidate[]; pending?: PdfJobCandidate[] }) {
  const listStale = vi.fn(async ({ status }: { status: "running" | "pending" }) =>
    byStatus[status] ?? [],
  );
  const markFailed = vi.fn(async ({ ids }: { ids: string[] }) => ids);
  const port: PdfJobReaperPort = { listStale, markFailed };
  return { port, listStale, markFailed };
}

describe("reapStalePdfJobs — 오케스트레이션", () => {
  it("상태별로 조건부 갱신하고 기준 컬럼·cutoff·안내 문구를 넘긴다", async () => {
    const { port, listStale, markFailed } = fakePort({
      running: [job({ id: "r1" })],
      pending: [job({ id: "p1", status: "pending", started_at: null, order_id: null })],
    });
    const result = await reapStalePdfJobs(port, { now: NOW, dryRun: false, limit: 20 });

    const cutoff = "2026-09-17T11:45:00.000Z";
    expect(listStale).toHaveBeenCalledWith({ status: "running", before: cutoff, limit: 20 });
    expect(listStale).toHaveBeenCalledWith({ status: "pending", before: cutoff, limit: 20 });
    expect(markFailed).toHaveBeenCalledWith({
      ids: ["r1"],
      status: "running",
      before: cutoff,
      lastError: reapedJobError("running"),
      finishedAt: NOW.toISOString(),
    });
    expect(markFailed).toHaveBeenCalledWith(
      expect.objectContaining({ ids: ["p1"], status: "pending" }),
    );
    expect(STALE_TIME_COLUMN).toEqual({ running: "started_at", pending: "created_at" });
    expect(result.jobs).toEqual([
      { id: "r1", orderId: "order-1", previousStatus: "running", attempt: 1, maxAttempts: 3, retryable: true },
      { id: "p1", orderId: null, previousStatus: "pending", attempt: 1, maxAttempts: 3, retryable: true },
    ]);
  });

  it("dryRun 은 갱신하지 않는다", async () => {
    const { port, markFailed } = fakePort({ running: [job({ id: "r1" })] });
    const result = await reapStalePdfJobs(port, { now: NOW, dryRun: true });
    expect(markFailed).not.toHaveBeenCalled();
    expect(result).toMatchObject({ dryRun: true, jobs: [{ id: "r1" }] });
  });

  it("조건부 UPDATE 가 빗나간 잡(그 사이 재시도됨)은 보고하지 않고, 시도 소진 잡은 retryable=false", async () => {
    const { port, markFailed } = fakePort({
      running: [job({ id: "r1" }), job({ id: "r2", attempt: 3, max_attempts: 3 })],
    });
    markFailed.mockResolvedValueOnce(["r2"]);
    const result = await reapStalePdfJobs(port, { now: NOW, dryRun: false });
    expect(result.jobs).toEqual([
      expect.objectContaining({ id: "r2", retryable: false }),
    ]);
  });
});

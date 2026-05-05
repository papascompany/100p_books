import "server-only";

import { nanoid } from "nanoid";

/**
 * 인메모리 PDF 빌드 잡 레지스트리.
 *
 *   - 동일 Node 인스턴스 안에서만 동작. Vercel serverless multi-instance 환경에서는
 *     SSE 가 다른 인스턴스로 라우팅될 가능성 → 추후 Redis 로 교체 필요.
 *   - 본 단계에서는 빌드 잡이 시작 → 같은 함수 인스턴스에서 SSE 가 즉시 수신
 *     (사용자가 build POST 응답을 받기 직전 SSE GET 시작) 시나리오에 한해 유효.
 *
 * 데이터 모델:
 *   { id, projectId, userId, status, progress, createdAt, updatedAt, error? }
 */

export type JobStatus = "queued" | "running" | "done" | "failed";

export interface JobProgress {
  done: number;
  total: number;
  phase: "render" | "compose";
}

export interface PdfJob {
  id: string;
  projectId: string;
  userId: string;
  status: JobStatus;
  progress: JobProgress;
  result?: { coverUrl?: string; interiorUrl?: string };
  error?: string;
  createdAt: number;
  updatedAt: number;
  /** SSE listener queue. push 만 하고, route 가 shift. */
  listeners: Set<(snap: PdfJobSnapshot) => void>;
}

export type PdfJobSnapshot = Omit<PdfJob, "listeners">;

const REGISTRY = new Map<string, PdfJob>();

/** 24시간 지난 잡 GC. */
const TTL_MS = 24 * 60 * 60 * 1000;

function gc() {
  const now = Date.now();
  for (const [id, job] of REGISTRY) {
    if (now - job.updatedAt > TTL_MS) REGISTRY.delete(id);
  }
}

export function createJob(opts: { projectId: string; userId: string }): PdfJob {
  gc();
  const now = Date.now();
  const job: PdfJob = {
    id: nanoid(16),
    projectId: opts.projectId,
    userId: opts.userId,
    status: "queued",
    progress: { done: 0, total: 0, phase: "render" },
    createdAt: now,
    updatedAt: now,
    listeners: new Set(),
  };
  REGISTRY.set(job.id, job);
  return job;
}

export function getJob(id: string): PdfJob | null {
  return REGISTRY.get(id) ?? null;
}

export function snapshot(job: PdfJob): PdfJobSnapshot {
  return {
    id: job.id,
    projectId: job.projectId,
    userId: job.userId,
    status: job.status,
    progress: { ...job.progress },
    result: job.result,
    error: job.error,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  };
}

export function updateJob(
  id: string,
  patch: Partial<Omit<PdfJob, "id" | "createdAt" | "listeners">>,
): PdfJob | null {
  const job = REGISTRY.get(id);
  if (!job) return null;
  Object.assign(job, patch);
  job.updatedAt = Date.now();
  // notify listeners
  const snap = snapshot(job);
  for (const cb of job.listeners) {
    try {
      cb(snap);
    } catch {
      // ignore — broken listener
    }
  }
  return job;
}

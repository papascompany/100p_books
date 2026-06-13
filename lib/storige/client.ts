import "server-only";

import type { StorigeValidationResult } from "@/lib/db/types";

/**
 * Storige 인쇄 백엔드 클라이언트 (서버 전용).
 *
 * papascompany 인쇄 PDF 저장·검증·이행을 Storige 단일 백엔드로 일원화하기 위한
 * 유일한 외부 API 경계. 모든 호출은 서버(Next API route/빌드 잡)에서만 일어나며
 * 인증 헤더는 `X-API-Key`.
 *
 * 보안:
 *   - STORIGE_API_KEY 는 서버 env 전용 — 절대 NEXT_PUBLIC / 브라우저 노출 금지.
 *   - fileId 는 추측 불가하지만, 다운로드는 항상 서버 프록시 경유(클라 노출 최소화).
 *
 * 설계 메모:
 *   - PDF 의 단일 진실원본은 PageDoc(DB). PDF·검증결과는 재생성 가능한 파생물.
 *   - 외부 API 계약(필드명/응답 shape)이 바뀌어도 영향 범위는 이 파일로 한정.
 */

const DEFAULT_BASE = "https://api.papascompany.co.kr/api";

/** 끝 슬래시 제거한 base URL. env 미설정 시 고정 상수 사용. */
const BASE = (process.env.STORIGE_API_URL ?? DEFAULT_BASE).replace(/\/+$/, "");
const KEY = process.env.STORIGE_API_KEY ?? "";

/** 업로드/검증/다운로드가 가능한 상태인지 (API 키 존재 여부). */
export const STORIGE_ENABLED = KEY.length > 0;

/**
 * Storige 업로드 최대 크기 (계약상 기본 100MB). 초과 시 업로드 전 차단.
 * STORIGE_MAX_UPLOAD_MB 로 override 가능 — Storige 가 한도를 올리면 코드 변경 없이 반영.
 * ⚠️ 100p 사진북(q90) PDF 는 ~100MB 를 넘길 수 있어 이 한도에 걸릴 수 있다.
 */
export const STORIGE_MAX_UPLOAD_BYTES =
  (Number.parseInt(process.env.STORIGE_MAX_UPLOAD_MB ?? "", 10) || 100) *
  1024 *
  1024;

export class StorigeError extends Error {
  status: number;
  code = "STORIGE_ERROR";
  constructor(message: string, status = 502) {
    super(message);
    this.name = "StorigeError";
    this.status = status;
  }
}

function assertEnabled(): void {
  if (!STORIGE_ENABLED) {
    throw new StorigeError(
      "STORIGE_API_KEY 가 설정되지 않았습니다. (Storige 비활성)",
      503,
    );
  }
}

function authHeaders(extra?: Record<string, string>): Record<string, string> {
  return { "X-API-Key": KEY, ...(extra ?? {}) };
}

// =====================================================================
// 3.1 업로드 → fileId
// =====================================================================

export type StorigeFileType = "cover" | "content";

export interface StorigeUploadResult {
  /** Storige 파일 ID. */
  id: string;
  fileName?: string;
  fileUrl?: string;
  fileSize?: number;
}

export interface UploadPdfOpts {
  type: StorigeFileType;
  /** 사용자 친화 파일명 (multipart filename). */
  filename: string;
  /** 주문 식별 정수 (선택, 권장). 100p 의 order id 는 UUID 라 보통 미지정. */
  orderSeqno?: number;
}

/**
 * POST {BASE}/files/upload/external — multipart/form-data.
 *   fields: file(application/pdf), type("cover"|"content"), orderSeqno?(int)
 *   → 201 { id, fileName, fileUrl, fileSize, ... }
 *
 * 실패 시 StorigeError throw — 호출자(빌드 잡)가 잡을 failed 로 마킹해 재시도 가능하게.
 */
export async function uploadPdf(
  buf: Buffer,
  opts: UploadPdfOpts,
): Promise<StorigeUploadResult> {
  assertEnabled();

  if (buf.byteLength > STORIGE_MAX_UPLOAD_BYTES) {
    // 계약상 100MB 초과 — 업로드가 413 으로 거부될 가능성이 높음. 명확한 에러로 표면화.
    throw new StorigeError(
      `PDF 크기 ${(buf.byteLength / 1024 / 1024).toFixed(1)}MB 가 Storige 업로드 한도(100MB)를 초과합니다.`,
      413,
    );
  }

  const form = new FormData();
  // Buffer → Blob (Node 18+ 전역 Blob/FormData/fetch).
  form.append(
    "file",
    new Blob([new Uint8Array(buf)], { type: "application/pdf" }),
    opts.filename,
  );
  form.append("type", opts.type);
  if (typeof opts.orderSeqno === "number") {
    form.append("orderSeqno", String(opts.orderSeqno));
  }

  let resp: Response;
  try {
    resp = await fetch(`${BASE}/files/upload/external`, {
      method: "POST",
      headers: authHeaders(), // Content-Type 은 FormData 가 boundary 와 함께 자동 설정
      body: form,
    });
  } catch (e) {
    throw new StorigeError(
      `업로드 네트워크 오류: ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  if (!resp.ok) {
    const body = await safeText(resp);
    throw new StorigeError(
      `업로드 실패 (${resp.status}): ${body.slice(0, 500)}`,
      resp.status,
    );
  }

  const json = (await resp.json().catch(() => null)) as
    | (Partial<StorigeUploadResult> & { id?: string })
    | null;
  if (!json?.id) {
    throw new StorigeError("업로드 응답에 파일 id 가 없습니다.");
  }
  return {
    id: String(json.id),
    fileName: json.fileName,
    fileUrl: json.fileUrl,
    fileSize: json.fileSize,
  };
}

// =====================================================================
// 3.2 인쇄 검증 (CMYK/재단선/해상도)
// =====================================================================

export interface ValidateOpts {
  fileId: string;
  fileType: StorigeFileType;
  orderOptions: {
    size: { width: number; height: number }; // mm
    pages: number;
    binding: "perfect";
    bleed: number; // mm
  };
}

/** POST {BASE}/worker-jobs/validate/external → 201 { id: jobId } */
export async function requestValidation(opts: ValidateOpts): Promise<string> {
  assertEnabled();
  const resp = await fetch(`${BASE}/worker-jobs/validate/external`, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(opts),
  });
  if (!resp.ok) {
    const body = await safeText(resp);
    throw new StorigeError(
      `검증 요청 실패 (${resp.status}): ${body.slice(0, 300)}`,
      resp.status,
    );
  }
  const json = (await resp.json().catch(() => null)) as { id?: string } | null;
  if (!json?.id) throw new StorigeError("검증 응답에 jobId 가 없습니다.");
  return String(json.id);
}

interface WorkerJob {
  id: string;
  status: string; // PENDING | PROCESSING | COMPLETED | FIXABLE | FAILED ...
  result?: { issues?: unknown[]; warnings?: unknown[] } & Record<string, unknown>;
}

/** GET {BASE}/worker-jobs/{jobId} */
export async function getWorkerJob(jobId: string): Promise<WorkerJob> {
  assertEnabled();
  const resp = await fetch(`${BASE}/worker-jobs/${encodeURIComponent(jobId)}`, {
    method: "GET",
    headers: authHeaders(),
    cache: "no-store",
  });
  if (!resp.ok) {
    const body = await safeText(resp);
    throw new StorigeError(
      `검증 조회 실패 (${resp.status}): ${body.slice(0, 300)}`,
      resp.status,
    );
  }
  const json = (await resp.json().catch(() => null)) as WorkerJob | null;
  if (!json?.id) throw new StorigeError("검증 조회 응답이 비었습니다.");
  return json;
}

const TERMINAL = new Set(["COMPLETED", "FIXABLE", "FAILED", "ERROR", "CANCELLED"]);

/**
 * 검증 요청 + 폴링 (best-effort, 절대 throw 하지 않음).
 *   - 빌드 잡(waitUntil, 최대 300s) 안에서 호출되므로 시간 예산을 제한.
 *   - 종착 상태(COMPLETED/FIXABLE/FAILED) 도달 또는 timeout 시 결과 반환.
 *   - 어떤 실패든 status 에 'ERROR'/'PROCESSING' 을 담아 반환 (주문/빌드를 막지 않음).
 */
export async function validatePdf(
  opts: ValidateOpts,
  poll: { intervalMs?: number; maxMs?: number } = {},
): Promise<StorigeValidationResult> {
  const intervalMs = poll.intervalMs ?? 2500;
  const maxMs = poll.maxMs ?? 15000;

  let jobId: string;
  try {
    jobId = await requestValidation(opts);
  } catch (e) {
    return {
      status: "ERROR",
      raw: { error: e instanceof Error ? e.message : String(e) },
    };
  }

  const deadline = Date.now() + maxMs;
  let last: WorkerJob | null = null;
  // 첫 조회 전 짧은 대기 (검증 시작 직후)
  while (Date.now() < deadline) {
    await sleep(intervalMs);
    try {
      last = await getWorkerJob(jobId);
    } catch {
      continue; // 일시 오류 — 재시도
    }
    if (last && TERMINAL.has((last.status ?? "").toUpperCase())) break;
  }

  if (!last) return { status: "PROCESSING", jobId };
  return {
    status: (last.status ?? "PROCESSING").toUpperCase(),
    jobId,
    issues: last.result?.issues,
    warnings: last.result?.warnings,
  };
}

// =====================================================================
// 3.3 다운로드 (서버 프록시 전용)
// =====================================================================

/**
 * GET {BASE}/files/{fileId}/download/external → PDF 바이너리.
 * 스트리밍 위해 원본 fetch Response 를 그대로 반환 (호출자가 body 를 파이프).
 */
export async function downloadFile(fileId: string): Promise<Response> {
  assertEnabled();
  const resp = await fetch(
    `${BASE}/files/${encodeURIComponent(fileId)}/download/external`,
    { method: "GET", headers: authHeaders(), cache: "no-store" },
  );
  if (!resp.ok) {
    const body = await safeText(resp);
    throw new StorigeError(
      `다운로드 실패 (${resp.status}): ${body.slice(0, 300)}`,
      resp.status === 404 ? 404 : 502,
    );
  }
  return resp;
}

/** 다운로드 → Buffer (마이그레이션 스크립트/내부 용도). */
export async function downloadBuffer(fileId: string): Promise<Buffer> {
  const resp = await downloadFile(fileId);
  const ab = await resp.arrayBuffer();
  return Buffer.from(ab);
}

// =====================================================================
// 삭제 (보존정책 cron 용) — Storige 삭제 API 가 없을 수 있어 결과를 구분 반환.
// =====================================================================

export interface DeleteResult {
  /** 삭제 성공(2xx) 또는 이미 없음(404). */
  ok: boolean;
  /** HTTP status (네트워크 오류는 0). */
  status: number;
  /** 삭제 API 미지원(405/501/404 라우트)으로 판단되면 false. */
  supported: boolean;
}

/**
 * DELETE {BASE}/files/{fileId}/external (계약 미확정 — best-effort).
 *   - 2xx/404 → ok (삭제됨 또는 이미 없음).
 *   - 405/501 → supported=false (삭제 API 미지원 — 운영자 협의 대상).
 *   - 그 외(5xx/네트워크) → ok=false, supported=true (다음 cron 에서 재시도).
 */
export async function deleteFile(fileId: string): Promise<DeleteResult> {
  if (!STORIGE_ENABLED) return { ok: false, status: 0, supported: true };
  let resp: Response;
  try {
    resp = await fetch(
      `${BASE}/files/${encodeURIComponent(fileId)}/external`,
      { method: "DELETE", headers: authHeaders() },
    );
  } catch {
    return { ok: false, status: 0, supported: true };
  }
  if (resp.ok || resp.status === 404) {
    return { ok: true, status: resp.status, supported: true };
  }
  if (resp.status === 405 || resp.status === 501) {
    return { ok: false, status: resp.status, supported: false };
  }
  return { ok: false, status: resp.status, supported: true };
}

// =====================================================================
// helpers
// =====================================================================

async function safeText(resp: Response): Promise<string> {
  try {
    return await resp.text();
  } catch {
    return "";
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

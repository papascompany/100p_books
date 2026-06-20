import "server-only";

import type { StorigeValidationResult } from "@/lib/db/types";

/**
 * Storige 인쇄 백엔드 클라이언트 (서버 전용).
 *
 * papascompany 인쇄 PDF 저장·검증·이행을 Storige 단일 백엔드로 일원화하기 위한
 * 유일한 외부 API 경계. 모든 호출은 서버(Next API route/빌드 잡)에서만 일어나며
 * 인증 헤더는 `X-API-Key`.
 *
 * 인증 키 (2종 — Storige 가 계열별로 분리 발급):
 *   - STORIGE_API_KEY        : "편집기" 키 — /files/* (업로드·다운로드·삭제)
 *   - STORIGE_WORKER_API_KEY : "워커" 키   — /worker-jobs/* (인쇄 검증)
 *
 * 보안:
 *   - 두 키 모두 서버 env 전용 — 절대 NEXT_PUBLIC / 브라우저 노출 금지.
 *   - fileId 는 추측 불가하지만, 다운로드는 항상 서버 프록시 경유(클라 노출 최소화).
 *
 * 설계 메모:
 *   - PDF 의 단일 진실원본은 PageDoc(DB). PDF·검증결과는 재생성 가능한 파생물.
 *   - 외부 API 계약(필드명/응답 shape)이 바뀌어도 영향 범위는 이 파일로 한정.
 */

const DEFAULT_BASE = "https://api.papascompany.co.kr/api";

/** 끝 슬래시 제거한 base URL. env 미설정 시 고정 상수 사용. */
const BASE = (process.env.STORIGE_API_URL ?? DEFAULT_BASE).replace(/\/+$/, "");
/** 편집기 키 — /files/* (업로드/다운로드/삭제). */
const EDITOR_KEY = process.env.STORIGE_API_KEY ?? "";
/** 워커 키 — /worker-jobs/* (인쇄 검증). */
const WORKER_KEY = process.env.STORIGE_WORKER_API_KEY ?? "";

/** 파일 업로드/다운로드(편집기 키)가 가능한 상태인지. PDF 저장의 핵심. */
export const STORIGE_ENABLED = EDITOR_KEY.length > 0;
/** 인쇄 검증(워커 키)이 가능한 상태인지. 없으면 검증은 건너뛴다(주문은 진행). */
export const STORIGE_VALIDATION_ENABLED = WORKER_KEY.length > 0;

/**
 * Storige 업로드 최대 크기 (전체 상한). 초과 시 업로드 전 차단.
 *
 * 업로드 경로는 두 가지:
 *   - ≤90MB: 기존 multipart `POST /files/upload/external` (X-API-Key, multer 100MB 캡).
 *   - >90MB: presigned 직결 `POST /files/presigned-upload-public` → PUT R2 → complete
 *            (서버 Buffer 단일 PUT, R2 단일 객체 5GB 까지). 워커 검증은 프로덕션에서
 *            2GB 까지 지원 확인됨.
 *
 * 따라서 이 상한은 워커 검증 한도에 맞춰 기본 2048MB(2GB). STORIGE_MAX_UPLOAD_MB 로
 * override 가능하나 무한대 금지 — 하드 상한 5120MB(R2 단일 PUT 한도)로 클램프.
 *
 * ⚠️ 100p 사진북(q90) PDF 는 ~100MB 를 넘길 수 있어 presigned 경로로 처리된다.
 */
const STORIGE_HARD_MAX_MB = 5120; // R2 단일 객체 PUT 한도 (5GB)
const STORIGE_DEFAULT_MAX_MB = 2048; // 워커 검증 확인 한도 (2GB)
export const STORIGE_MAX_UPLOAD_BYTES =
  Math.min(
    Number.parseInt(process.env.STORIGE_MAX_UPLOAD_MB ?? "", 10) ||
      STORIGE_DEFAULT_MAX_MB,
    STORIGE_HARD_MAX_MB,
  ) *
  1024 *
  1024;

/**
 * multipart(`/files/upload/external`) 경로를 쓰는 임계값 (90MB).
 * 이하면 기존 X-API-Key multipart, 초과면 presigned 직결.
 * 100MB multer 캡 아래로 마진을 둔 값.
 */
export const STORIGE_MULTIPART_THRESHOLD_BYTES = 90 * 1024 * 1024;

/**
 * presigned uploadUrl 허용 호스트 suffix (SSRF 방지).
 * presign 응답의 uploadUrl 로 PDF 바이트를 PUT 하므로, 호스트가 신뢰 스토리지
 * (R2/S3)인지 검증해 presign 변조/하이재킹 시 임의 서버 전송을 차단한다.
 * STORIGE_UPLOAD_HOST_ALLOW(comma-separated)로 override. 기본 = R2 + S3.
 */
const UPLOAD_HOST_ALLOW = (
  process.env.STORIGE_UPLOAD_HOST_ALLOW ??
  "r2.cloudflarestorage.com,amazonaws.com"
)
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

export class StorigeError extends Error {
  status: number;
  code = "STORIGE_ERROR";
  constructor(message: string, status = 502) {
    super(message);
    this.name = "StorigeError";
    this.status = status;
  }
}

/**
 * presigned 엔드포인트가 driver=local 로 503 { code:'STORIGE_NOT_S3' } 를 반환.
 * uploadPdf 가 잡아 기존 multipart 경로로 폴백할 수 있게 별도 타입으로 구분.
 */
export class StorigeNotS3Error extends StorigeError {
  override code = "STORIGE_NOT_S3";
  constructor() {
    super("Storige presigned 업로드 미지원 (driver=local)", 503);
    this.name = "StorigeNotS3Error";
  }
}

function assertEditorEnabled(): void {
  if (!STORIGE_ENABLED) {
    throw new StorigeError(
      "STORIGE_API_KEY(편집기 키) 가 설정되지 않았습니다. (Storige 비활성)",
      503,
    );
  }
}

/** X-API-Key 헤더 — 호출 계열에 맞는 키를 넣는다. */
function authHeaders(
  key: string,
  extra?: Record<string, string>,
): Record<string, string> {
  return { "X-API-Key": key, ...(extra ?? {}) };
}

/**
 * presign uploadUrl 검증 (SSRF 방지) — https + 허용 호스트만.
 * 변조된 presign 응답으로 PDF(최대 2GB)가 임의 서버로 PUT 되는 것을 차단.
 */
function assertAllowedUploadUrl(raw: string): void {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new StorigeError("presign uploadUrl 형식이 올바르지 않습니다.");
  }
  if (u.protocol !== "https:") {
    throw new StorigeError(`presign uploadUrl 비-HTTPS 거부: ${u.protocol}`);
  }
  const host = u.hostname.toLowerCase();
  const ok = UPLOAD_HOST_ALLOW.some(
    (sfx) => host === sfx || host.endsWith("." + sfx),
  );
  if (!ok) {
    throw new StorigeError(
      `presign uploadUrl 호스트 비허용(SSRF 방지): ${host}`,
    );
  }
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
  assertEditorEnabled();

  if (buf.byteLength > STORIGE_MAX_UPLOAD_BYTES) {
    // 전체 상한 초과 — 워커 검증 한도를 넘김. 명확한 에러로 표면화.
    throw new StorigeError(
      `PDF 크기 ${(buf.byteLength / 1024 / 1024).toFixed(1)}MB 가 Storige 업로드 한도(${(STORIGE_MAX_UPLOAD_BYTES / 1024 / 1024).toFixed(0)}MB)를 초과합니다.`,
      413,
    );
  }

  // 90MB 초과 — multer 100MB 캡에 걸리므로 presigned 직결(R2 단일 PUT)로 라우팅.
  if (buf.byteLength > STORIGE_MULTIPART_THRESHOLD_BYTES) {
    try {
      return await uploadPdfPresigned(buf, {
        type: opts.type,
        filename: opts.filename,
      });
    } catch (e) {
      // driver=local(STORIGE_NOT_S3) 이면 기존 multipart 로 폴백.
      // 단, multer 100MB 캡을 넘으면 폴백해도 거부되므로 명확한 에러로 표면화.
      if (!(e instanceof StorigeNotS3Error)) throw e;
      if (buf.byteLength > 100 * 1024 * 1024) {
        throw new StorigeError(
          `PDF 크기 ${(buf.byteLength / 1024 / 1024).toFixed(1)}MB — Storige 가 presigned 미지원(driver=local)이고 multipart 한도(100MB)도 초과합니다. STORAGE_DRIVER=s3 프로비저닝이 필요합니다.`,
          413,
        );
      }
      // 90~100MB 이고 driver=local — multipart 폴백 진행.
    }
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
      headers: authHeaders(EDITOR_KEY), // Content-Type 은 FormData 가 boundary 와 함께 자동 설정
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
// 3.1b presigned 직결 업로드 (>100MB — multer 캡 우회)
// =====================================================================

export interface PresignedUploadOpts {
  type: StorigeFileType;
  /** 원본 파일명 (presign originalName + 응답 fileName). */
  filename: string;
}

/** presign 응답 — fileId/uploadUrl/uploadToken. */
interface PresignResponse {
  fileId?: string;
  uploadUrl?: string;
  uploadToken?: string;
}

/**
 * presigned 직결 업로드 (3단계). multipart 100MB multer 캡을 우회하기 위한 경로.
 * R2 단일 객체 PUT(최대 5GB)로 PDF 원본 바이트를 직접 올린다.
 *
 *   1) POST {BASE}/files/presigned-upload-public  (@Public — X-API-Key 없음)
 *        body { type, expectedSize, originalName, contentType:'application/pdf' }
 *        → { fileId, uploadUrl, uploadToken }
 *        driver=local 이면 503 { code:'STORIGE_NOT_S3' } → 기존 multipart 경로로 폴백.
 *   2) PUT <uploadUrl>  (API 미경유 — R2 직결)
 *        헤더 Content-Type: application/pdf (서명 type 일치 필수).
 *   3) POST {BASE}/files/{fileId}/complete  body { uploadToken }
 *        → FileResponseDto (status ready). 400 SIZE_MISMATCH if expectedSize≠실제.
 *
 * 반환은 기존 uploadPdf 와 동일 shape ({ id: fileId, ... }).
 */
export async function uploadPdfPresigned(
  buf: Buffer,
  opts: PresignedUploadOpts,
): Promise<StorigeUploadResult> {
  assertEditorEnabled();

  const expectedSize = buf.byteLength;
  if (expectedSize > STORIGE_MAX_UPLOAD_BYTES) {
    throw new StorigeError(
      `PDF 크기 ${(expectedSize / 1024 / 1024).toFixed(1)}MB 가 Storige 업로드 한도(${(STORIGE_MAX_UPLOAD_BYTES / 1024 / 1024).toFixed(0)}MB)를 초과합니다.`,
      413,
    );
  }

  // ---- 1) presign (@Public — X-API-Key 없이 호출) ----
  let presignResp: Response;
  try {
    presignResp = await fetch(`${BASE}/files/presigned-upload-public`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: opts.type,
        expectedSize,
        originalName: opts.filename,
        contentType: "application/pdf",
      }),
    });
  } catch (e) {
    throw new StorigeError(
      `presign 네트워크 오류: ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  if (!presignResp.ok) {
    const body = await safeText(presignResp);
    // driver=local — presigned 미지원. 호출자(uploadPdf)가 처리할 수 있게 명확한 503.
    if (presignResp.status === 503 && body.includes("STORIGE_NOT_S3")) {
      throw new StorigeNotS3Error();
    }
    throw new StorigeError(
      `presign 실패 (${presignResp.status}): ${body.slice(0, 300)}`,
      presignResp.status,
    );
  }

  const presign = (await presignResp.json().catch(() => null)) as
    | PresignResponse
    | null;
  if (!presign?.fileId || !presign.uploadUrl || !presign.uploadToken) {
    throw new StorigeError("presign 응답이 불완전합니다 (fileId/uploadUrl/uploadToken).");
  }
  const { fileId, uploadUrl, uploadToken } = presign;
  // SSRF 방지 — uploadUrl 이 신뢰 스토리지 호스트(R2/S3)인지 검증 후 PUT.
  assertAllowedUploadUrl(uploadUrl);

  // ---- 2) PUT R2 직결 (Content-Type 은 서명 type 과 일치해야 함) ----
  let putResp: Response;
  try {
    putResp = await fetch(uploadUrl, {
      method: "PUT",
      headers: {
        "Content-Type": "application/pdf",
        "Content-Length": String(buf.byteLength),
      },
      body: new Uint8Array(buf),
    });
  } catch (e) {
    throw new StorigeError(
      `R2 PUT 네트워크 오류: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  if (!putResp.ok) {
    const body = await safeText(putResp);
    throw new StorigeError(
      `R2 PUT 실패 (${putResp.status}): ${body.slice(0, 300)}`,
      502,
    );
  }

  // ---- 3) complete (SIZE_MISMATCH → 400) ----
  let completeResp: Response;
  try {
    completeResp = await fetch(
      `${BASE}/files/${encodeURIComponent(fileId)}/complete`,
      {
        method: "POST",
        // /files/* 계열 — 편집기 키로 인증 (uploadToken 외 방어 심화).
        headers: authHeaders(EDITOR_KEY, { "Content-Type": "application/json" }),
        body: JSON.stringify({ uploadToken }),
      },
    );
  } catch (e) {
    throw new StorigeError(
      `complete 네트워크 오류: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  if (!completeResp.ok) {
    const body = await safeText(completeResp);
    throw new StorigeError(
      `complete 실패 (${completeResp.status}): ${body.slice(0, 300)}`,
      completeResp.status,
    );
  }

  const json = (await completeResp.json().catch(() => null)) as
    | (Partial<StorigeUploadResult> & { id?: string; fileName?: string })
    | null;
  // 2xx 인데 id 가 없으면 백엔드 이상 — presign fileId 로 silent fallback 하지 않고
  // 명확히 실패시킨다(불완전 업로드가 orders 에 커밋되는 것 방지).
  if (!json?.id) {
    throw new StorigeError("complete 응답에 파일 id 가 없습니다 (백엔드 이상).");
  }
  return {
    id: String(json.id),
    fileName: json.fileName ?? opts.filename,
    fileUrl: json.fileUrl,
    fileSize: json.fileSize ?? expectedSize,
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

/** POST {BASE}/worker-jobs/validate/external → 201 { id: jobId } (워커 키) */
export async function requestValidation(opts: ValidateOpts): Promise<string> {
  if (!STORIGE_VALIDATION_ENABLED) {
    throw new StorigeError("STORIGE_WORKER_API_KEY(워커 키) 미설정.", 503);
  }
  const resp = await fetch(`${BASE}/worker-jobs/validate/external`, {
    method: "POST",
    headers: authHeaders(WORKER_KEY, { "Content-Type": "application/json" }),
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

/** GET {BASE}/worker-jobs/external/{jobId} (워커 키 — 외부 파트너 폴링 라우트) */
export async function getWorkerJob(jobId: string): Promise<WorkerJob> {
  if (!STORIGE_VALIDATION_ENABLED) {
    throw new StorigeError("STORIGE_WORKER_API_KEY(워커 키) 미설정.", 503);
  }
  const resp = await fetch(`${BASE}/worker-jobs/external/${encodeURIComponent(jobId)}`, {
    method: "GET",
    headers: authHeaders(WORKER_KEY),
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
  // 워커 키 없으면 검증 생략 (주문/빌드는 그대로 진행).
  if (!STORIGE_VALIDATION_ENABLED) {
    return { status: "SKIPPED", raw: { reason: "STORIGE_WORKER_API_KEY 미설정" } };
  }

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
  assertEditorEnabled();
  const resp = await fetch(
    `${BASE}/files/${encodeURIComponent(fileId)}/download/external`,
    { method: "GET", headers: authHeaders(EDITOR_KEY), cache: "no-store" },
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
      { method: "DELETE", headers: authHeaders(EDITOR_KEY) },
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

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

/** STORIGE_ENABLED 는 import 시점 env 로 결정되므로 env 설정 후 동적 import. */
async function loadDeleteFile() {
  vi.resetModules();
  vi.stubEnv("STORIGE_API_KEY", "test-editor-key");
  vi.stubEnv("STORIGE_API_URL", "https://storige.test/api");
  const mod = await import("./client");
  return mod.deleteFile;
}

function mockFetch(status: number, body: string) {
  const fn = vi.fn(async () => new Response(status === 204 ? null : body, { status }));
  vi.stubGlobal("fetch", fn);
  return fn;
}

describe("deleteFile — 404 구분", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("2xx → 삭제 성공", async () => {
    const deleteFile = await loadDeleteFile();
    const fetchFn = mockFetch(200, JSON.stringify({ success: true }));
    expect(await deleteFile("f1")).toEqual({ ok: true, status: 200, supported: true });
    expect(fetchFn).toHaveBeenCalledWith(
      "https://storige.test/api/files/f1/external",
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it("404 + FILE_NOT_FOUND → 이미 없음(성공)", async () => {
    const deleteFile = await loadDeleteFile();
    mockFetch(
      404,
      JSON.stringify({ code: "FILE_NOT_FOUND", message: "파일을 찾을 수 없습니다.", details: { fileId: "f1" } }),
    );
    expect(await deleteFile("f1")).toEqual({ ok: true, status: 404, supported: true });
  });

  it("404 라우트 없음(Nest 기본 본문) → 미지원, 참조 유지", async () => {
    const deleteFile = await loadDeleteFile();
    mockFetch(
      404,
      JSON.stringify({ message: "Cannot DELETE /api/files/f1/external", error: "Not Found", statusCode: 404 }),
    );
    expect(await deleteFile("f1")).toEqual({ ok: false, status: 404, supported: false });
  });

  it("404 HTML(프록시) → 미지원", async () => {
    const deleteFile = await loadDeleteFile();
    mockFetch(404, "<html><body>404 Not Found</body></html>");
    expect(await deleteFile("f1")).toEqual({ ok: false, status: 404, supported: false });
  });

  it("405/501 → 미지원, 5xx → 재시도 대상", async () => {
    const deleteFile = await loadDeleteFile();
    mockFetch(405, "");
    expect(await deleteFile("f1")).toEqual({ ok: false, status: 405, supported: false });
    mockFetch(503, "");
    expect(await deleteFile("f1")).toEqual({ ok: false, status: 503, supported: true });
  });

  it("네트워크 오류 → 재시도 대상", async () => {
    const deleteFile = await loadDeleteFile();
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("ECONNRESET"); }));
    expect(await deleteFile("f1")).toEqual({ ok: false, status: 0, supported: true });
  });
});

/** 워커 키·편집기 키를 넣고 client 를 새로 import (STORIGE_*_ENABLED 는 import 시점 결정). */
async function loadClient() {
  vi.resetModules();
  vi.stubEnv("STORIGE_API_KEY", "test-editor-key");
  vi.stubEnv("STORIGE_WORKER_API_KEY", "test-worker-key");
  vi.stubEnv("STORIGE_API_URL", "https://storige.test/api");
  return import("./client");
}

describe("extractValidationResult — 검증 잡 result 중첩", () => {
  it("이중 중첩(Storige 실제 저장 형태)에서 꺼낸다", async () => {
    const { extractValidationResult } = await loadClient();
    const payload = { isValid: false, errors: [{ code: "LOW_RESOLUTION" }], warnings: [{ code: "W" }] };
    expect(extractValidationResult({ result: payload })).toEqual(payload);
  });

  it("단일 중첩도 받는다", async () => {
    const { extractValidationResult } = await loadClient();
    const payload = { isValid: true, errors: [], warnings: [] };
    expect(extractValidationResult(payload)).toEqual(payload);
  });

  it("검증 필드가 없으면 undefined", async () => {
    const { extractValidationResult } = await loadClient();
    expect(extractValidationResult(undefined)).toBeUndefined();
    expect(extractValidationResult({ result: { foo: 1 } })).toBeUndefined();
    expect(extractValidationResult("x")).toBeUndefined();
  });
});

describe("validatePdf — 실제 잡 응답 형태", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("result.result 의 isValid·errors·warnings 를 담고, 모르는 키는 무시한다", async () => {
    const { validatePdf } = await loadClient();
    const errors = [{ code: "FILE_CORRUPTED", message: "PDF 를 읽을 수 없습니다." }];
    const warnings = [{ code: "TRIMBOX_SIZE_BASIS" }];
    const fetchFn = vi.fn(async (url: string) => {
      if (url.endsWith("/worker-jobs/validate/external")) {
        return new Response(JSON.stringify({ id: "job-1", status: "PENDING", someNewKey: 1 }), { status: 201 });
      }
      return new Response(
        JSON.stringify({
          id: "job-1",
          jobType: "VALIDATE",
          status: "FAILED",
          result: { result: { isValid: false, errors, warnings, metadata: {} } },
          errorCode: "X",
          unknownKey: { a: 1 },
        }),
        { status: 200 },
      );
    });
    vi.stubGlobal("fetch", fetchFn);
    const out = await validatePdf(
      { fileId: "f1", fileType: "content" } as Parameters<typeof validatePdf>[0],
      { intervalMs: 1, maxMs: 1000 },
    );
    expect(out).toEqual({ status: "FAILED", jobId: "job-1", isValid: false, errors, warnings });
  });
});

describe("uploadPdf — presign 503 STORAGE_NOT_S3 폴백", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("서버 철자 STORAGE_NOT_S3 면 multipart 로 폴백한다", async () => {
    const { uploadPdf, STORIGE_MULTIPART_THRESHOLD_BYTES, isNotS3Body } = await loadClient();
    expect(isNotS3Body(JSON.stringify({ code: "STORAGE_NOT_S3" }))).toBe(true);
    expect(isNotS3Body(JSON.stringify({ code: "STORIGE_NOT_S3" }))).toBe(true);
    expect(isNotS3Body(JSON.stringify({ code: "INTERNAL" }))).toBe(false);

    const fetchFn = vi.fn(async (url: string) => {
      if (url.endsWith("/files/presigned-upload-public")) {
        return new Response(
          JSON.stringify({ statusCode: 503, code: "STORAGE_NOT_S3", message: "s3 아님" }),
          { status: 503 },
        );
      }
      if (url.endsWith("/files/upload/external")) {
        return new Response(JSON.stringify({ id: "file-1", fileName: "a.pdf" }), { status: 201 });
      }
      return new Response("unexpected", { status: 500 });
    });
    vi.stubGlobal("fetch", fetchFn);
    const buf = Buffer.alloc(STORIGE_MULTIPART_THRESHOLD_BYTES + 1);
    const res = await uploadPdf(buf, { type: "content", filename: "a.pdf" });
    expect(res.id).toBe("file-1");
    const urls = fetchFn.mock.calls.map((c) => String(c[0]));
    expect(urls).toEqual([
      "https://storige.test/api/files/presigned-upload-public",
      "https://storige.test/api/files/upload/external",
    ]);
  });
});

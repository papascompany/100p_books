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

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * app/api/health/route.test.ts
 *
 * 고정하는 계약 (SEC-19): 배포 환경의 비인증 응답은 최소 상태(ok/status)만 담고,
 * env 구성 여부와 DB 오류 원문은 `Authorization: Bearer <CRON_SECRET>` 가 있을 때만 준다.
 * 상태 코드(200/503)는 인증과 무관하게 같아야 업타임 모니터가 깨지지 않는다.
 */

vi.mock("server-only", () => ({}));

const selectMock = vi.fn();
vi.mock("@/lib/db/server", () => ({
  createServerSupabase: () => ({ from: () => ({ select: selectMock }) }),
}));

import { GET } from "./route";

const SECRET = "health-secret-0123456789";
const DB_ERROR = 'relation "public.profiles" does not exist';

function req(headers: Record<string, string> = {}): Request {
  return new Request("https://100pbooks.example/api/health", { headers });
}

beforeEach(() => {
  vi.stubEnv("VERCEL_ENV", "production");
  vi.stubEnv("CRON_SECRET", SECRET);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://ci-dummy.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://100pbooks.example");
  vi.stubEnv("TOSS_SECRET_KEY", "toss-secret");
  vi.stubEnv("NEXT_PUBLIC_TOSS_CLIENT_KEY", "toss-client");
  vi.spyOn(console, "error").mockImplementation(() => {});
  selectMock.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("GET /api/health", () => {
  it("비인증 + DB 실패: 503 과 최소 상태만 — env·오류 원문 없음", async () => {
    selectMock.mockResolvedValue({ error: { message: DB_ERROR } });

    const res = await GET(req());
    const body = (await res.json()) as Record<string, unknown>;

    expect(res.status).toBe(503);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(Object.keys(body).sort()).toEqual(["ok", "service", "status", "ts"]);
    expect(body).toMatchObject({ ok: false, status: "degraded" });
    expect(JSON.stringify(body)).not.toContain("profiles");
  });

  it("비인증 + 정상: 200 과 status ok", async () => {
    selectMock.mockResolvedValue({ error: null });

    const res = await GET(req());

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, status: "ok" });
  });

  it("Bearer CRON_SECRET 이면 db·env·warning 상세를 준다 (상태 코드는 동일)", async () => {
    selectMock.mockResolvedValue({ error: { message: DB_ERROR } });

    const res = await GET(req({ authorization: `Bearer ${SECRET}` }));
    const body = (await res.json()) as Record<string, unknown>;

    expect(res.status).toBe(503);
    expect(body).toMatchObject({
      ok: false,
      db: "fail",
      env: { supabase: true, toss: true, app_url: true },
      warning: DB_ERROR,
    });
  });

  it("틀린 Bearer 는 비인증과 같다", async () => {
    selectMock.mockResolvedValue({ error: null });

    const res = await GET(req({ authorization: "Bearer wrong" }));
    const body = (await res.json()) as Record<string, unknown>;

    expect(body).not.toHaveProperty("env");
    expect(body).not.toHaveProperty("db");
  });
});

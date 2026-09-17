import { afterEach, describe, expect, it, vi } from "vitest";

import {
  hasValidCronBearer,
  isDeployedRuntime,
  verifyCronRequest,
  type CronAuthEnv,
} from "./cron-auth";

/**
 * lib/security/cron-auth.test.ts
 *
 * 고정하는 계약 (SEC-14):
 *   - CRON_SECRET 이 있으면 Bearer 일치만 통과한다. x-vercel-cron 헤더는 무의미하다.
 *   - CRON_SECRET 이 없는 배포 런타임은 fail-closed — 위조 가능한 x-vercel-cron 로 통과 불가.
 *   - 로컬 개발(`next dev`)에서만 x-vercel-cron: 1 수동 호출을 허용한다.
 */

function req(headers: Record<string, string> = {}): Request {
  return new Request("http://localhost:3000/api/cron/process-emails", { headers });
}

const SECRET = "s3cr3t-value-at-least-16";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("verifyCronRequest — CRON_SECRET 설정됨", () => {
  const prod: CronAuthEnv = { CRON_SECRET: SECRET, NODE_ENV: "production", VERCEL_ENV: "production" };

  it("Vercel 이 자동으로 붙이는 Bearer 헤더면 통과한다", () => {
    expect(verifyCronRequest(req({ authorization: `Bearer ${SECRET}` }), prod)).toEqual({
      ok: true,
      via: "bearer",
    });
  });

  it("x-vercel-cron 헤더만으로는 통과하지 못한다 (위조 가능)", () => {
    expect(verifyCronRequest(req({ "x-vercel-cron": "1" }), prod)).toMatchObject({
      ok: false,
      status: 401,
      code: "UNAUTHORIZED",
    });
  });

  it("틀린 secret·접두 일치·Bearer 누락은 401", () => {
    for (const authorization of [
      `Bearer ${SECRET}x`,
      `Bearer ${SECRET.slice(0, -1)}`,
      SECRET,
      `bearer ${SECRET}`,
    ]) {
      expect(verifyCronRequest(req({ authorization }), prod)).toMatchObject({
        ok: false,
        status: 401,
      });
    }
  });

  it("로컬 개발에서도 secret 이 있으면 Bearer 를 강제한다", () => {
    const dev: CronAuthEnv = { CRON_SECRET: SECRET, NODE_ENV: "development" };
    expect(verifyCronRequest(req({ "x-vercel-cron": "1" }), dev)).toMatchObject({
      ok: false,
      status: 401,
    });
    expect(verifyCronRequest(req({ authorization: `Bearer ${SECRET}` }), dev).ok).toBe(true);
  });
});

describe("verifyCronRequest — CRON_SECRET 미설정", () => {
  it("production 배포는 x-vercel-cron 헤더가 있어도 거부한다 (fail-closed)", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const env: CronAuthEnv = { NODE_ENV: "production", VERCEL_ENV: "production" };
    expect(verifyCronRequest(req({ "x-vercel-cron": "1" }), env)).toMatchObject({
      ok: false,
      status: 500,
      code: "CRON_NOT_CONFIGURED",
    });
  });

  it("preview 배포도 거부한다", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const env: CronAuthEnv = { NODE_ENV: "production", VERCEL_ENV: "preview" };
    expect(verifyCronRequest(req({ "x-vercel-cron": "1" }), env).ok).toBe(false);
  });

  it("빈 문자열 secret 은 미설정과 같다", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const env: CronAuthEnv = { CRON_SECRET: "", NODE_ENV: "production" };
    expect(verifyCronRequest(req({ authorization: "Bearer " }), env)).toMatchObject({
      ok: false,
      code: "CRON_NOT_CONFIGURED",
    });
  });

  it("로컬 개발에서는 x-vercel-cron: 1 수동 호출만 허용한다", () => {
    const dev: CronAuthEnv = { NODE_ENV: "development" };
    expect(verifyCronRequest(req({ "x-vercel-cron": "1" }), dev)).toEqual({
      ok: true,
      via: "local-dev",
    });
    // 헤더 없는 GET(브라우저 주소창 등)은 거부 — 삭제 cron 오발 방지.
    expect(verifyCronRequest(req(), dev)).toMatchObject({
      ok: false,
      code: "CRON_NOT_CONFIGURED",
    });
  });
});

describe("hasValidCronBearer / isDeployedRuntime", () => {
  it("secret 이 없으면 어떤 헤더로도 true 가 되지 않는다", () => {
    expect(hasValidCronBearer(req({ authorization: "Bearer undefined" }), {})).toBe(false);
    expect(hasValidCronBearer(req({ authorization: "Bearer " }), { CRON_SECRET: "" })).toBe(false);
  });

  it("배포 런타임 판정", () => {
    expect(isDeployedRuntime({ NODE_ENV: "production" })).toBe(true);
    expect(isDeployedRuntime({ NODE_ENV: "development", VERCEL_ENV: "preview" })).toBe(true);
    expect(isDeployedRuntime({ NODE_ENV: "development" })).toBe(false);
    expect(isDeployedRuntime({ NODE_ENV: "test" })).toBe(false);
  });
});

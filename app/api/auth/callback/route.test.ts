// @vitest-environment node
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * /api/auth/callback 라우트 흐름 테스트 — Supabase 호출은 mock.
 * SEC-3(오픈 리다이렉트)·SEC-13(재설정 마커) 수정이 실제 라우트에 연결돼 있는지,
 * 그리고 정상 재설정 메일 흐름(1e53054)이 그대로 동작하는지 고정한다.
 */

const mocks = vi.hoisted(() => ({
  exchangeCodeForSession: vi.fn(),
}));

vi.mock("@/lib/db/server", () => ({
  createServerSupabase: () => ({
    auth: { exchangeCodeForSession: mocks.exchangeCodeForSession },
  }),
}));

vi.mock("@/lib/db/admin", () => ({
  createAdminSupabase: () => ({
    rpc: vi.fn(async () => ({ data: null, error: null })),
    from: () => ({ insert: vi.fn(async () => ({ error: null })) }),
  }),
}));

vi.mock("@/lib/analytics/funnel", () => ({
  trackFunnelEvent: vi.fn(async () => undefined),
}));

vi.mock("@/lib/referrals/code", () => ({
  ensureReferralCode: vi.fn(async () => ({ code: "SELF1234" })),
}));

import { GET } from "./route";

const ORIGIN = "https://100pbooks.vercel.app";

function jwtWithAmr(method: string): string {
  const enc = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64url");
  return `${enc({ alg: "HS256" })}.${enc({ sub: "user-1", amr: [{ method, timestamp: 1 }] })}.sig`;
}

function sessionFor(method: string) {
  return {
    data: {
      user: { id: "user-1", created_at: "2020-01-01T00:00:00Z" },
      session: { access_token: jwtWithAmr(method) },
    },
    error: null,
  };
}

async function call(query: string) {
  const res = await GET(new NextRequest(`${ORIGIN}/api/auth/callback?${query}`));
  const location = res.headers.get("location") ?? "";
  return { res, location, url: new URL(location) };
}

beforeEach(() => {
  mocks.exchangeCodeForSession.mockReset();
});

describe("GET /api/auth/callback — 오픈 리다이렉트 (SEC-3)", () => {
  it.each([
    ["next=/%5Cevil.example"],
    ["next=/%09/evil.example"],
    ["next=//evil.example"],
    ["next=/.//evil.example"],
    ["next=https://evil.example"],
    ["next=/%255Cevil.example"],
  ])("code 없음 + %s → 같은 origin 의 / 로", async (query) => {
    const { url } = await call(query);
    expect(url.origin).toBe(ORIGIN);
    expect(url.pathname).toBe("/");
    expect(mocks.exchangeCodeForSession).not.toHaveBeenCalled();
  });

  it("정상 내부 경로는 보존", async () => {
    const { url } = await call("next=/mypage/orders");
    expect(url.origin).toBe(ORIGIN);
    expect(url.pathname).toBe("/mypage/orders");
  });

  it("교환 실패 시 /login 으로 보내고 우회 next 는 싣지 않음", async () => {
    mocks.exchangeCodeForSession.mockResolvedValue({
      data: { user: null, session: null },
      error: { message: "invalid flow state" },
    });
    const { url } = await call("code=abc&next=/%5Cevil.example");
    expect(url.origin).toBe(ORIGIN);
    expect(url.pathname).toBe("/login");
    expect(url.searchParams.get("next")).toBeNull();
  });
});

describe("GET /api/auth/callback — 재설정 마커 (SEC-13)", () => {
  it("정상 재설정 메일 흐름: AMR recovery + next=/reset-password → 마커 발급 후 폼으로", async () => {
    mocks.exchangeCodeForSession.mockResolvedValue(sessionFor("recovery"));
    const { res, url } = await call("code=abc&next=/reset-password");
    expect(url.origin).toBe(ORIGIN);
    expect(url.pathname).toBe("/reset-password");
    const marker = res.cookies.get("pw_recovery");
    expect(marker?.value).toBe("user-1");
    expect(marker?.httpOnly).toBe(true);
  });

  it("카카오 OAuth 교환 + next=/reset-password → 마커 없음", async () => {
    mocks.exchangeCodeForSession.mockResolvedValue(sessionFor("oauth"));
    const { res, url } = await call("code=abc&next=/reset-password");
    expect(url.pathname).toBe("/reset-password");
    expect(res.cookies.get("pw_recovery")).toBeUndefined();
  });

  it("recovery 세션이라도 next 가 재설정 폼이 아니면 마커 없음", async () => {
    mocks.exchangeCodeForSession.mockResolvedValue(sessionFor("recovery"));
    const { res } = await call("code=abc&next=/mypage");
    expect(res.cookies.get("pw_recovery")).toBeUndefined();
  });
});

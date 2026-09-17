// @vitest-environment node
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * /api/auth/callback 라우트 흐름 테스트 — Supabase 호출은 mock.
 * SEC-3(오픈 리다이렉트)·SEC-13(재설정 마커) 수정이 실제 라우트에 연결돼 있는지,
 * 정상 재설정 메일 흐름(1e53054)이 그대로 동작하는지,
 * 탈퇴(익명화) 계정이면 부수효과 없이 세션을 끊고 안내 경로로 보내는지(DEBT-3) 고정한다.
 */

const mocks = vi.hoisted(() => ({
  exchangeCodeForSession: vi.fn(),
  signOut: vi.fn(async (_opts?: { scope?: string }) => ({ error: null })),
  profile: { deleted_at: null as string | null } as { deleted_at: string | null } | null,
  profileError: null as { message: string } | null,
  profileLookups: [] as string[],
  rpc: vi.fn(async (_fn: string, _args?: unknown) => ({ data: null as unknown, error: null })),
  referralInsert: vi.fn(async (_row: unknown) => ({ error: null })),
  ensureReferralCode: vi.fn(async (_admin: unknown, _userId: string) => ({ code: "SELF1234" })),
  trackFunnelEvent: vi.fn(async (_args: unknown) => undefined),
}));

vi.mock("@/lib/db/server", () => ({
  createServerSupabase: () => ({
    auth: {
      exchangeCodeForSession: mocks.exchangeCodeForSession,
      signOut: mocks.signOut,
    },
  }),
}));

vi.mock("@/lib/db/admin", () => ({
  createAdminSupabase: () => ({
    rpc: mocks.rpc,
    from: (table: string) => {
      if (table === "profiles") {
        return {
          select: (columns: string) => ({
            eq: (_column: string, id: string) => ({
              maybeSingle: async () => {
                mocks.profileLookups.push(`${columns}@${id}`);
                return { data: mocks.profile, error: mocks.profileError };
              },
            }),
          }),
        };
      }
      if (table === "referrals") return { insert: mocks.referralInsert };
      throw new Error(`unexpected table ${table}`);
    },
  }),
}));

vi.mock("@/lib/analytics/funnel", () => ({
  trackFunnelEvent: mocks.trackFunnelEvent,
}));

vi.mock("@/lib/referrals/code", () => ({
  ensureReferralCode: mocks.ensureReferralCode,
}));

import { GET } from "./route";

const ORIGIN = "https://100pbooks.vercel.app";

function jwtWithAmr(method: string): string {
  const enc = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64url");
  return `${enc({ alg: "HS256" })}.${enc({ sub: "user-1", amr: [{ method, timestamp: 1 }] })}.sig`;
}

function sessionFor(method: string, createdAt = "2020-01-01T00:00:00Z") {
  return {
    data: {
      user: { id: "user-1", created_at: createdAt },
      session: { access_token: jwtWithAmr(method) },
    },
    error: null,
  };
}

async function call(query: string, cookie?: string) {
  const req = new NextRequest(`${ORIGIN}/api/auth/callback?${query}`, {
    headers: cookie ? { cookie } : undefined,
  });
  const res = await GET(req);
  const location = res.headers.get("location") ?? "";
  return { res, location, url: new URL(location) };
}

function rpcNames(): string[] {
  return mocks.rpc.mock.calls.map((c) => c[0]);
}

beforeEach(() => {
  mocks.exchangeCodeForSession.mockReset();
  mocks.signOut.mockClear();
  mocks.rpc.mockReset();
  mocks.rpc.mockImplementation(async (fn: string) => ({
    data: fn === "lookup_referral_code" ? "referrer-9" : null,
    error: null,
  }));
  mocks.referralInsert.mockClear();
  mocks.ensureReferralCode.mockClear();
  mocks.trackFunnelEvent.mockClear();
  mocks.profile = { deleted_at: null };
  mocks.profileError = null;
  mocks.profileLookups = [];
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

describe("GET /api/auth/callback — 탈퇴(익명화) 계정 (DEBT-3)", () => {
  it("활성 계정: 동의 기록·프로필 동기화·가입 계측·추천 코드·referrals 가 실행되고 쿠키를 지운다", async () => {
    mocks.exchangeCodeForSession.mockResolvedValue(
      sessionFor("oauth", new Date().toISOString()),
    );
    const { res, url } = await call("code=abc&next=/mypage", "referral_code=frnd1234");

    expect(url.pathname).toBe("/mypage");
    expect(mocks.profileLookups).toEqual(["deleted_at@user-1"]);
    expect(rpcNames()).toEqual(["record_agreements", "sync_oauth_profile", "lookup_referral_code"]);
    expect(mocks.trackFunnelEvent).toHaveBeenCalledTimes(1);
    expect(mocks.ensureReferralCode).toHaveBeenCalledTimes(1);
    expect(mocks.referralInsert).toHaveBeenCalledWith({
      referrer_id: "referrer-9",
      referee_id: "user-1",
      referral_code: "FRND1234",
      reward_status: "pending",
    });
    expect(res.cookies.get("referral_code")?.value).toBe("");
    expect(mocks.signOut).not.toHaveBeenCalled();
  });

  it("탈퇴 계정: 부수효과 0건, 세션(local) 정리 후 /login?error=account_deleted — next·재설정 마커 없음", async () => {
    mocks.profile = { deleted_at: "2026-09-17T00:00:00Z" };
    mocks.exchangeCodeForSession.mockResolvedValue(
      sessionFor("recovery", new Date().toISOString()),
    );
    const { res, url } = await call(
      "code=abc&next=/reset-password",
      "referral_code=frnd1234",
    );

    expect(url.origin).toBe(ORIGIN);
    expect(url.pathname).toBe("/login");
    expect(url.searchParams.get("error")).toBe("account_deleted");
    expect(url.searchParams.get("next")).toBeNull();

    expect(mocks.signOut).toHaveBeenCalledTimes(1);
    expect(mocks.signOut).toHaveBeenCalledWith({ scope: "local" });

    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.ensureReferralCode).not.toHaveBeenCalled();
    expect(mocks.referralInsert).not.toHaveBeenCalled();
    expect(mocks.trackFunnelEvent).not.toHaveBeenCalled();
    expect(res.cookies.get("pw_recovery")).toBeUndefined();
  });

  it("탈퇴 계정: signOut 이 실패해도 안내 경로로 보내고 부수효과는 실행하지 않는다", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    mocks.profile = { deleted_at: "2026-09-17T00:00:00Z" };
    mocks.signOut.mockRejectedValueOnce(new Error("network down"));
    mocks.exchangeCodeForSession.mockResolvedValue(sessionFor("oauth"));
    const { url } = await call("code=abc");

    expect(url.pathname).toBe("/login");
    expect(url.searchParams.get("error")).toBe("account_deleted");
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.ensureReferralCode).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("계정 상태 조회 실패: 로그인·동의 기록은 진행, 나머지 부수효과는 건너뛰고 referral 쿠키는 다음 로그인용으로 남긴다", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    mocks.profile = null;
    mocks.profileError = { message: "timeout" };
    mocks.exchangeCodeForSession.mockResolvedValue(
      sessionFor("oauth", new Date().toISOString()),
    );
    const { res, url } = await call("code=abc&next=/mypage", "referral_code=frnd1234");

    expect(url.pathname).toBe("/mypage");
    expect(mocks.signOut).not.toHaveBeenCalled();
    // 동의 시각은 coalesce 만 하는 멱등 RPC 라 unknown 에서도 채운다 (다른 보완 경로 없음)
    expect(rpcNames()).toEqual(["record_agreements"]);
    expect(mocks.trackFunnelEvent).not.toHaveBeenCalled();
    expect(mocks.ensureReferralCode).not.toHaveBeenCalled();
    expect(mocks.referralInsert).not.toHaveBeenCalled();
    expect(res.cookies.get("referral_code")).toBeUndefined();
    warn.mockRestore();
  });

  it("프로필 행이 아직 없으면(신규 가입) 활성으로 보고 부수효과를 실행한다", async () => {
    mocks.profile = null;
    mocks.exchangeCodeForSession.mockResolvedValue(sessionFor("oauth"));
    await call("code=abc");
    expect(rpcNames()).toContain("record_agreements");
    expect(mocks.ensureReferralCode).toHaveBeenCalledTimes(1);
    expect(mocks.signOut).not.toHaveBeenCalled();
  });

  it("탈퇴 계정이 재설정 메일 링크로 들어와도 마커를 굽지 않는다 (탈퇴 계정 비밀번호 변경 차단)", async () => {
    mocks.profile = { deleted_at: "2026-09-17T00:00:00Z" };
    mocks.exchangeCodeForSession.mockResolvedValue(sessionFor("recovery"));
    const { res } = await call("code=abc&next=/reset-password");
    expect(res.cookies.get("pw_recovery")).toBeUndefined();
  });
});

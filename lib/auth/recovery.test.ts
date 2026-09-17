import { describe, expect, it } from "vitest";

import {
  isPasswordRecoveryPath,
  PASSWORD_RECOVERY_PATH,
  readAmrMethods,
  shouldIssueRecoveryMarker,
} from "./recovery";
import { safeRedirectPath } from "./safe-redirect";

/** base64url(JSON) — 서명은 판정에 쓰지 않으므로 더미. */
function b64url(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

/** GoTrue access token 모양의 JWT (header.payload.signature). */
function fakeJwt(payload: Record<string, unknown>): string {
  return `${b64url({ alg: "HS256", typ: "JWT" })}.${b64url(payload)}.sig`;
}

const now = 1_758_000_000;

/** 재설정 메일 링크(PKCE, type=recovery) 교환 직후 토큰 — GoTrue AMREntry 형식. */
const RECOVERY_TOKEN = fakeJwt({
  sub: "user-1",
  aal: "aal1",
  amr: [{ method: "recovery", timestamp: now }],
  session_id: "s-1",
  user_metadata: { name: "홍길동" },
});

/** 카카오 OAuth 교환 직후 토큰. user_metadata 에 한글 닉네임(UTF-8 멀티바이트)이 들어간다. */
const OAUTH_TOKEN = fakeJwt({
  sub: "user-1",
  amr: [{ method: "oauth", timestamp: now }],
  user_metadata: { nickname: "카카오친구", avatar_url: "https://k.kakaocdn.net/a.png" },
});

const MAGICLINK_TOKEN = fakeJwt({
  sub: "user-1",
  amr: [{ method: "magiclink", timestamp: now }],
});

const PASSWORD_TOKEN = fakeJwt({
  sub: "user-1",
  amr: [{ method: "password", timestamp: now }],
});

describe("readAmrMethods", () => {
  it("AMREntry 객체 배열에서 method 를 읽는다", () => {
    expect(readAmrMethods(RECOVERY_TOKEN)).toEqual(["recovery"]);
    expect(readAmrMethods(OAUTH_TOKEN)).toEqual(["oauth"]);
  });

  it("문자열 배열 형식(access token hook)도 읽는다", () => {
    expect(readAmrMethods(fakeJwt({ amr: ["recovery", "password"] }))).toEqual([
      "recovery",
      "password",
    ]);
  });

  it("비정상 입력은 빈 배열", () => {
    expect(readAmrMethods(undefined)).toEqual([]);
    expect(readAmrMethods(null)).toEqual([]);
    expect(readAmrMethods("")).toEqual([]);
    expect(readAmrMethods("not-a-jwt")).toEqual([]);
    expect(readAmrMethods("a.!!!.c")).toEqual([]);
    expect(readAmrMethods(fakeJwt({ sub: "x" }))).toEqual([]);
    expect(readAmrMethods(fakeJwt({ amr: "recovery" }))).toEqual([]);
    expect(readAmrMethods(fakeJwt({ amr: [{ method: 1 }, null, 3] }))).toEqual([]);
  });
});

describe("isPasswordRecoveryPath", () => {
  it.each([
    ["/reset-password", true],
    ["/reset-password/", true],
    ["/reset-password?x=1", true],
    ["/reset-password#top", true],
    ["/reset-passwordX", false],
    ["/reset-password-evil", false],
    ["/", false],
    ["/mypage", false],
  ])("%s → %s", (path, expected) => {
    expect(isPasswordRecoveryPath(path)).toBe(expected);
  });
});

describe("shouldIssueRecoveryMarker — SEC-13", () => {
  it("정상 재설정 흐름: 메일 redirectTo 의 next + AMR recovery → 발급", () => {
    // LoginForm 의 resetPasswordForEmail redirectTo 와 같은 모양에서 next 를 꺼내 콜백과 같은 방식으로 정규화.
    const redirectTo = `https://100pbooks.vercel.app/api/auth/callback?next=${PASSWORD_RECOVERY_PATH}`;
    const target = safeRedirectPath(new URL(redirectTo).searchParams.get("next"));
    expect(target).toBe("/reset-password");
    expect(
      shouldIssueRecoveryMarker({ target, accessToken: RECOVERY_TOKEN }),
    ).toBe(true);
  });

  it("OAuth(카카오) 교환 + next=/reset-password → 발급하지 않음", () => {
    expect(
      shouldIssueRecoveryMarker({
        target: "/reset-password",
        accessToken: OAUTH_TOKEN,
      }),
    ).toBe(false);
  });

  it("매직링크·비밀번호 세션 + next=/reset-password → 발급하지 않음", () => {
    for (const accessToken of [MAGICLINK_TOKEN, PASSWORD_TOKEN]) {
      expect(
        shouldIssueRecoveryMarker({ target: "/reset-password", accessToken }),
      ).toBe(false);
    }
  });

  it("recovery 세션이라도 대상이 재설정 폼이 아니면 발급하지 않음", () => {
    expect(
      shouldIssueRecoveryMarker({ target: "/", accessToken: RECOVERY_TOKEN }),
    ).toBe(false);
    expect(
      shouldIssueRecoveryMarker({
        target: "/reset-passwordX",
        accessToken: RECOVERY_TOKEN,
      }),
    ).toBe(false);
  });

  it("토큰이 없거나 깨졌으면 발급하지 않음 (fail-closed)", () => {
    expect(
      shouldIssueRecoveryMarker({ target: "/reset-password", accessToken: undefined }),
    ).toBe(false);
    expect(
      shouldIssueRecoveryMarker({ target: "/reset-password", accessToken: "x.y.z" }),
    ).toBe(false);
  });
});

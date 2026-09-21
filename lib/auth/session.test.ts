// @vitest-environment node
import type * as ReactModule from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * requireActiveUser — 탈퇴 가드 (DEBT-3).
 * Supabase 클라이언트는 mock, React cache 는 요청 스코프 밖에서 항등 함수로 둔다.
 */

const state = vi.hoisted(() => ({
  user: { id: "user-1" } as { id: string } | null,
  profile: { deleted_at: null } as { deleted_at: string | null } | null,
  profileError: null as null | { message: string },
}));

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof ReactModule>();
  return { ...actual, cache: <T>(fn: T): T => fn };
});

vi.mock("@/lib/db/server", () => ({
  createServerSupabase: () => ({
    auth: {
      getUser: async () => ({ data: { user: state.user } }),
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: state.profile, error: state.profileError }),
        }),
      }),
    }),
  }),
}));

import {
  ACCOUNT_DELETED_LOGIN_MESSAGE,
  callbackErrorMessage,
} from "@/app/(auth)/login/callback-error";

import { ACCOUNT_DELETED_MESSAGE, requireActiveUser, requireUser } from "./session";

async function rejection(p: Promise<unknown>) {
  try {
    await p;
  } catch (e) {
    return e as { status?: number; code?: string };
  }
  throw new Error("expected rejection");
}

beforeEach(() => {
  state.user = { id: "user-1" };
  state.profile = { deleted_at: null };
  state.profileError = null;
});

describe("requireActiveUser", () => {
  it("활성 사용자 → 통과", async () => {
    await expect(requireActiveUser()).resolves.toEqual({ id: "user-1" });
  });

  it("탈퇴(익명화)된 사용자 → 410 ACCOUNT_DELETED", async () => {
    state.profile = { deleted_at: "2026-09-17T00:00:00Z" };
    const err = await rejection(requireActiveUser());
    expect(err).toMatchObject({ status: 410, code: "ACCOUNT_DELETED" });
  });

  it("profiles 조회 실패 → 통과시키지 않음 (503)", async () => {
    state.profile = null;
    state.profileError = { message: "connection reset" };
    const err = await rejection(requireActiveUser());
    expect(err).toMatchObject({ status: 503, code: "ACCOUNT_STATUS_UNAVAILABLE" });
  });

  it("세션 없음(soft delete 로 세션 삭제된 경우 포함) → 401", async () => {
    state.user = null;
    const err = await rejection(requireActiveUser());
    expect(err).toMatchObject({ status: 401, code: "UNAUTHORIZED" });
  });

  it("requireUser 는 deleted_at 을 보지 않는다 (탈퇴 재시도 경로용)", async () => {
    state.profile = { deleted_at: "2026-09-17T00:00:00Z" };
    await expect(requireUser()).resolves.toEqual({ id: "user-1" });
  });
});

describe("탈퇴 중간 상태 안내 — 410 문구와 로그인 콜백 동작의 일치", () => {
  it("410 message 는 ACCOUNT_DELETED_MESSAGE 그대로", async () => {
    state.profile = { deleted_at: "2026-09-17T00:00:00Z" };
    const err = (await rejection(requireActiveUser())) as { message?: string };
    expect(err.message).toBe(ACCOUNT_DELETED_MESSAGE);
  });

  it("410(세션 있음): 지금 세션으로 탈퇴 재시도 + 링크 로그인은 콜백이 끊는다는 사실 + 고객센터", () => {
    expect(ACCOUNT_DELETED_MESSAGE).toContain("계정 관리에서 회원 탈퇴를 다시 진행");
    expect(ACCOUNT_DELETED_MESSAGE).toContain("카카오·이메일 링크로는 다시 로그인할 수 없");
    expect(ACCOUNT_DELETED_MESSAGE).toContain("고객센터");
  });

  it("로그인 화면(error=account_deleted, 세션 끊김): 따를 수 없는 '마이페이지에서 재시도' 대신 고객센터", () => {
    expect(callbackErrorMessage("account_deleted")).toBe(ACCOUNT_DELETED_LOGIN_MESSAGE);
    expect(ACCOUNT_DELETED_LOGIN_MESSAGE).toContain("카카오·이메일 링크로는 로그인할 수 없");
    expect(ACCOUNT_DELETED_LOGIN_MESSAGE).toContain("고객센터");
    expect(ACCOUNT_DELETED_LOGIN_MESSAGE).not.toContain("마이페이지");
    // 일반 실패 문구로 떨어지지 않는다(예전: '로그인에 실패했어요').
    expect(callbackErrorMessage("account_deleted")).not.toBe(callbackErrorMessage("unknown_code"));
  });

  it("기존 코드 매핑은 유지", () => {
    expect(callbackErrorMessage("callback_failed")).toContain("로그인 처리 중 문제");
    expect(callbackErrorMessage("whatever")).toBe("로그인에 실패했어요. 다시 시도해주세요.");
  });
});

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

import { requireActiveUser, requireUser } from "./session";

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

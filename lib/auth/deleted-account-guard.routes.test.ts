// @vitest-environment node
import type * as ReactModule from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 탈퇴 가드 라우트 수준 테스트 (DEBT-3).
 *
 * lib/auth/session 은 mock 하지 않는다 — 실제 requireActiveUser 가 profiles.deleted_at 을 읽게 해서,
 * 라우트가 requireUser 로 되돌아가면 이 테스트가 실패하도록 한다.
 * 가드 뒤의 모든 쓰기(service_role 클라이언트·메일)는 호출되면 기록된다.
 */

const state = vi.hoisted(() => ({
  deletedAt: "2026-09-17T00:00:00Z" as string | null,
  touched: [] as string[],
}));

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof ReactModule>();
  return { ...actual, cache: <T>(fn: T): T => fn };
});

vi.mock("@/lib/db/server", () => ({
  createServerSupabase: () => ({
    auth: {
      getUser: async () => ({ data: { user: { id: "user-1", email: "me@example.com" } } }),
    },
    from: (table: string) => {
      if (table === "profiles") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: { deleted_at: state.deletedAt }, error: null }),
            }),
          }),
        };
      }
      state.touched.push(`server.from(${table})`);
      throw new Error(`guard bypassed: server.from(${table})`);
    },
  }),
}));

vi.mock("@/lib/db/admin", () => ({
  createAdminSupabase: () => {
    state.touched.push("admin");
    throw new Error("guard bypassed: service_role client");
  },
}));

vi.mock("@/lib/email/queue", () => ({
  enqueueEmail: vi.fn(async () => {
    state.touched.push("enqueueEmail");
    return { ok: true, jobId: null, sent: false };
  }),
}));

import { POST as attendanceCheck } from "@/app/api/attendance/check/route";
import { POST as giftAction } from "@/app/api/gifts/[token]/route";
import { POST as createOrder } from "@/app/api/orders/create/route";

const GIFT_TOKEN = "0c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f";

function jsonRequest(path: string, body: unknown) {
  return new Request(`https://100pbooks.vercel.app${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const CASES: Array<[name: string, call: () => Promise<Response>]> = [
  [
    "POST /api/orders/create",
    () =>
      createOrder(
        jsonRequest("/api/orders/create", {
          projectId: "4b6f2a0e-7c1d-4f7a-9a51-2b1f0c3d4e5f",
          qty: 1,
        }),
      ),
  ],
  [
    "POST /api/gifts/[token] (수령)",
    () =>
      giftAction(jsonRequest(`/api/gifts/${GIFT_TOKEN}`, { action: "claim" }), {
        params: Promise.resolve({ token: GIFT_TOKEN }),
      }),
  ],
  ["POST /api/attendance/check", () => attendanceCheck()],
];

beforeEach(() => {
  state.deletedAt = "2026-09-17T00:00:00Z";
  state.touched = [];
});

describe("탈퇴(익명화)된 계정은 돈·정체성 변경 라우트에서 410", () => {
  for (const [name, call] of CASES) {
    it(`${name} → 410 ACCOUNT_DELETED, 가드 뒤 단계 미실행`, async () => {
      const res = await call();
      const json = (await res.json()) as { ok: boolean; error?: { code: string; message: string } };
      expect(res.status).toBe(410);
      expect(json.ok).toBe(false);
      expect(json.error?.code).toBe("ACCOUNT_DELETED");
      // 중간 상태(익명화 완료·auth 잔존)에 맞는 안내 — 탈퇴 재시도
      expect(json.error?.message).toContain("탈퇴");
      expect(state.touched).toEqual([]);
    });
  }
});

describe("활성 계정은 가드를 통과한다", () => {
  it("POST /api/attendance/check → 가드 통과 후 service_role 단계로 진행", async () => {
    state.deletedAt = null;
    const res = await attendanceCheck();
    expect(res.status).not.toBe(410);
    expect(state.touched).toContain("admin");
  });

  it("POST /api/gifts/[token] → 가드 통과 후 service_role 단계로 진행", async () => {
    state.deletedAt = null;
    const res = await giftAction(jsonRequest(`/api/gifts/${GIFT_TOKEN}`, { action: "claim" }), {
      params: Promise.resolve({ token: GIFT_TOKEN }),
    });
    expect(res.status).not.toBe(410);
    expect(state.touched).toContain("admin");
  });
});

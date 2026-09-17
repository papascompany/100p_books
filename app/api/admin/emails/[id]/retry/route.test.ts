// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * POST /api/admin/emails/[id]/retry 라우트 흐름 테스트.
 *
 * 고정하는 계약:
 *   - 'sending' 에 STALE_SENDING_MS(10분) 넘게 갇힌 잡은 409 대신 pending(attempt 0)으로 reset.
 *   - 진행 중 'sending'·'sent' 는 409 이고 행을 바꾸지 않는다.
 *   - reset 은 조회한 상태가 그대로일 때만 — 그 사이 워커가 claim 했으면 409 EMAIL_JOB_STATE_CHANGED.
 *
 * service_role 클라이언트만 인메모리 email_jobs(필터 흉내)로 바꿔 Supabase 호출 모양까지 검증한다.
 */

type Row = {
  id: string;
  status: string;
  attempt: number;
  template: string;
  to_email: string;
  last_error: string | null;
  scheduled_at: string;
  updated_at: string;
};

const state = vi.hoisted(() => ({
  rows: [] as Array<Record<string, unknown>>,
  /** 조회(select) 직후, reset(update) 직전에 끼어드는 동시 변경 흉내. */
  beforeUpdate: null as null | (() => void),
  audit: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/lib/auth/session", () => ({
  requireAdmin: vi.fn(async () => ({ id: "admin-1", email: "admin@example.com" })),
}));

vi.mock("@/lib/admin/audit", () => ({
  logAdminAction: vi.fn(async (args: Record<string, unknown>) => {
    state.audit.push(args);
  }),
}));

vi.mock("@/lib/db/admin", () => {
  type Filter = (r: Record<string, unknown>) => boolean;
  function builder() {
    let mode: "select" | "update" = "select";
    let patch: Record<string, unknown> = {};
    let single = false;
    const filters: Filter[] = [];
    const api = {
      select(_cols: string) {
        return api;
      },
      update(p: Record<string, unknown>) {
        mode = "update";
        patch = p;
        return api;
      },
      eq(col: string, value: unknown) {
        filters.push((r) => r[col] === value);
        return api;
      },
      lt(col: string, value: string) {
        filters.push((r) => String(r[col]) < value);
        return api;
      },
      maybeSingle() {
        single = true;
        return api;
      },
      then<T1, T2 = never>(
        onfulfilled?: ((v: { data: unknown; error: null }) => T1 | PromiseLike<T1>) | null,
        onrejected?: ((reason: unknown) => T2 | PromiseLike<T2>) | null,
      ): Promise<T1 | T2> {
        return Promise.resolve().then(() => {
          if (mode === "update" && state.beforeUpdate) {
            state.beforeUpdate();
            state.beforeUpdate = null;
          }
          const matched = state.rows.filter((r) => filters.every((f) => f(r)));
          if (mode === "update") {
            for (const r of matched) Object.assign(r, patch);
            return { data: matched.map((r) => ({ id: r.id })), error: null };
          }
          const copies = matched.map((r) => ({ ...r }));
          return { data: single ? (copies[0] ?? null) : copies, error: null };
        }).then(onfulfilled, onrejected);
      },
    };
    return api;
  }
  return { createAdminSupabase: () => ({ from: (_table: string) => builder() }) };
});

import { NextRequest } from "next/server";

import { STALE_SENDING_MS } from "@/lib/email/retry-policy";

import { POST } from "./route";

const NOW = Date.UTC(2026, 8, 17, 12, 0, 0);
const iso = (ms: number) => new Date(ms).toISOString();

function job(overrides: Partial<Row>): Row {
  return {
    id: "job-1",
    status: "failed",
    attempt: 2,
    template: "order.paid",
    to_email: "buyer@example.com",
    last_error: "Resend: boom",
    scheduled_at: iso(NOW - 60 * 60_000),
    updated_at: iso(NOW - 60 * 60_000),
    ...overrides,
  };
}

async function retry(id = "job-1") {
  const res = await POST(
    new NextRequest(`https://100pbooks.vercel.app/api/admin/emails/${id}/retry`, {
      method: "POST",
    }),
    { params: { id } },
  );
  const body = (await res.json()) as { ok: boolean; error?: { code: string } };
  return { status: res.status, body };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  state.rows = [];
  state.beforeUpdate = null;
  state.audit = [];
});

afterEach(() => {
  vi.useRealTimers();
});

describe("POST /api/admin/emails/[id]/retry", () => {
  it("오래된 sending(발송 호출이 죽음) 은 pending·attempt 0 으로 reset 하고 감사 로그에 표시한다", async () => {
    state.rows = [job({ status: "sending", attempt: 1, updated_at: iso(NOW - STALE_SENDING_MS - 60_000) })];

    const { status, body } = await retry();

    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(state.rows[0]).toMatchObject({
      status: "pending",
      attempt: 0,
      last_error: null,
      scheduled_at: iso(NOW),
    });
    expect(state.audit).toHaveLength(1);
    expect(state.audit[0]).toMatchObject({
      action: "email.retry",
      details: { previousStatus: "sending", staleSending: true },
    });
  });

  it("진행 중 sending 은 409 IN_PROGRESS — 행을 바꾸지 않는다", async () => {
    state.rows = [job({ status: "sending", attempt: 1, updated_at: iso(NOW - 30_000) })];

    const { status, body } = await retry();

    expect(status).toBe(409);
    expect(body.error?.code).toBe("IN_PROGRESS");
    expect(state.rows[0]).toMatchObject({ status: "sending", attempt: 1 });
    expect(state.audit).toHaveLength(0);
  });

  it("sent 는 409 ALREADY_SENT", async () => {
    state.rows = [job({ status: "sent" })];

    const { status, body } = await retry();

    expect(status).toBe(409);
    expect(body.error?.code).toBe("ALREADY_SENT");
    expect(state.rows[0]).toMatchObject({ status: "sent" });
  });

  it("failed 는 기존대로 reset 한다", async () => {
    state.rows = [job({ status: "failed", attempt: 3 })];

    const { status } = await retry();

    expect(status).toBe(200);
    expect(state.rows[0]).toMatchObject({ status: "pending", attempt: 0, last_error: null });
    expect(state.audit[0]).toMatchObject({ details: { previousStatus: "failed" } });
    expect((state.audit[0]?.details as Record<string, unknown>).staleSending).toBeUndefined();
  });

  it("조회 뒤 워커가 같은 잡을 claim 했으면 409 EMAIL_JOB_STATE_CHANGED — 발송 중 잡을 덮어쓰지 않는다", async () => {
    state.rows = [job({ status: "failed", attempt: 1 })];
    state.beforeUpdate = () => {
      Object.assign(state.rows[0]!, { status: "sending", attempt: 2, updated_at: iso(NOW) });
    };

    const { status, body } = await retry();

    expect(status).toBe(409);
    expect(body.error?.code).toBe("EMAIL_JOB_STATE_CHANGED");
    expect(state.rows[0]).toMatchObject({ status: "sending", attempt: 2 });
    expect(state.audit).toHaveLength(0);
  });

  it("오래된 sending 을 조회한 뒤 워커가 복구·재claim 했으면(updated_at 갱신) reset 하지 않는다", async () => {
    state.rows = [job({ status: "sending", attempt: 1, updated_at: iso(NOW - STALE_SENDING_MS - 60_000) })];
    state.beforeUpdate = () => {
      Object.assign(state.rows[0]!, { status: "sending", attempt: 2, updated_at: iso(NOW) });
    };

    const { status, body } = await retry();

    expect(status).toBe(409);
    expect(body.error?.code).toBe("EMAIL_JOB_STATE_CHANGED");
    expect(state.rows[0]).toMatchObject({ status: "sending", attempt: 2 });
  });

  it("없는 잡은 404", async () => {
    const { status, body } = await retry("missing");

    expect(status).toBe(404);
    expect(body.error?.code).toBe("NOT_FOUND");
  });
});

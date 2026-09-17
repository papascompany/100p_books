// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * GET /api/cron/reap-pdf-jobs (DEBT-8).
 *
 * 인증은 실제 lib/security/cron-auth, service_role 클라이언트만 인메모리 pdf_build_jobs 로 바꾼다.
 * 필터를 실제로 평가하므로 상태·기준 시각 조건이 빠지면 살아 있는 잡이 failed 로 덮여 실패한다.
 */

type Row = Record<string, unknown>;

const state = vi.hoisted(() => ({
  jobs: [] as Array<Record<string, unknown>>,
  updates: 0,
}));

function compare(a: unknown, b: unknown): number {
  const ta = typeof a === "string" ? Date.parse(a) : NaN;
  const tb = typeof b === "string" ? Date.parse(b) : NaN;
  if (Number.isFinite(ta) && Number.isFinite(tb)) return ta - tb;
  return String(a).localeCompare(String(b));
}

function table(name: string) {
  if (name !== "pdf_build_jobs") throw new Error(`unexpected table ${name}`);
  const filters: Array<(r: Row) => boolean> = [];
  let action: "select" | "update" = "select";
  let values: Row = {};
  let limit: number | null = null;
  let orderBy: { col: string; asc: boolean } | null = null;

  const run = () => {
    const hits = state.jobs.filter((r) => filters.every((f) => f(r)));
    if (action === "update") {
      state.updates += 1;
      for (const r of hits) Object.assign(r, values);
      return { data: hits.map((r) => ({ id: r.id })), error: null };
    }
    let out = [...hits];
    if (orderBy) {
      const { col, asc } = orderBy;
      out.sort((x, y) => (asc ? 1 : -1) * compare(x[col], y[col]));
    }
    if (limit !== null) out = out.slice(0, limit);
    return { data: out.map((r) => ({ ...r })), error: null };
  };

  const b = {
    select() {
      return b;
    },
    update(v: Row) {
      action = "update";
      values = v;
      return b;
    },
    eq(col: string, v: unknown) {
      filters.push((r) => r[col] === v);
      return b;
    },
    lt(col: string, v: string) {
      // SQL 처럼 NULL 비교는 거짓.
      filters.push((r) => r[col] !== null && compare(r[col], v) < 0);
      return b;
    },
    in(col: string, vs: unknown[]) {
      filters.push((r) => vs.includes(r[col]));
      return b;
    },
    order(col: string, opts: { ascending: boolean }) {
      orderBy = { col, asc: opts.ascending };
      return b;
    },
    limit(n: number) {
      limit = n;
      return b;
    },
    then<T>(resolve: (v: ReturnType<typeof run>) => T, reject?: (e: unknown) => T) {
      return Promise.resolve().then(run).then(resolve, reject);
    },
  };
  return b;
}

vi.mock("@/lib/db/admin", () => ({
  createAdminSupabase: () => ({ from: (name: string) => table(name) }),
}));

import { GET } from "./route";

const MIN = 60_000;
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

function job(id: string, over: Row): Row {
  return {
    id,
    order_id: "order-1",
    status: "running",
    attempt: 1,
    max_attempts: 3,
    last_error: null,
    created_at: ago(60 * MIN),
    started_at: ago(60 * MIN),
    finished_at: null,
    ...over,
  };
}

function req(query = "", auth = "Bearer test-cron-secret") {
  return new Request(`https://100p.test/api/cron/reap-pdf-jobs${query}`, {
    headers: auth ? { authorization: auth } : {},
  });
}

type Body = {
  ok: boolean;
  data?: {
    dryRun: boolean;
    reaped?: number;
    wouldReap?: number;
    jobs: Array<{ id: string; orderId: string | null; retryable: boolean }>;
  };
};

beforeEach(() => {
  vi.stubEnv("CRON_SECRET", "test-cron-secret");
  vi.spyOn(console, "error").mockImplementation(() => {});
  state.updates = 0;
  state.jobs = [
    job("stuck-running", {}),
    job("stuck-running-exhausted", { attempt: 3, order_id: "order-2" }),
    // 관리자 재시도로 방금 다시 running — created_at 은 오래됐어도 살아 있다.
    job("retried-running", { created_at: ago(3 * 24 * 60 * MIN), started_at: ago(2 * MIN) }),
    job("stuck-pending", { status: "pending", started_at: null, attempt: 0, order_id: null }),
    job("fresh-pending", { status: "pending", started_at: null, created_at: ago(1 * MIN), attempt: 0 }),
    job("done", { status: "success", finished_at: ago(50 * MIN) }),
    job("already-failed", { status: "failed", last_error: "boom" }),
  ];
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const find = (id: string) => state.jobs.find((j) => j.id === id);

describe("GET /api/cron/reap-pdf-jobs", () => {
  it("Bearer CRON_SECRET 가 없으면 401 이고 아무것도 바꾸지 않는다", async () => {
    const res = await GET(req("", "Bearer wrong"));
    expect(res.status).toBe(401);
    expect(state.updates).toBe(0);
  });

  it("15분 넘게 고착된 running·pending 만 failed + 복구 안내로 되돌린다", async () => {
    const res = await GET(req());
    const body = (await res.json()) as Body;
    expect(res.status).toBe(200);
    expect(body.data?.reaped).toBe(3);
    expect(body.data?.jobs.map((j) => j.id).sort()).toEqual(
      ["stuck-pending", "stuck-running", "stuck-running-exhausted"],
    );

    for (const id of ["stuck-running", "stuck-running-exhausted", "stuck-pending"]) {
      expect(find(id)?.status, id).toBe("failed");
      expect(String(find(id)?.last_error)).toContain("PDF 재생성");
      expect(find(id)?.finished_at).not.toBeNull();
    }
    expect(find("retried-running")?.status).toBe("running");
    expect(find("fresh-pending")?.status).toBe("pending");
    expect(find("done")?.status).toBe("success");
    expect(find("already-failed")?.last_error).toBe("boom");

    // 결제 주문의 잡만 운영 로그(console.error)에 남긴다 — order_id 없는 사용자 빌드는 제외.
    expect(console.error).toHaveBeenCalledTimes(2);
    const exhausted = body.data?.jobs.find((j) => j.id === "stuck-running-exhausted");
    expect(exhausted?.retryable).toBe(false);
  });

  it("?dryRun=1 은 바꾸지 않고 예정 잡만 반환", async () => {
    const res = await GET(req("?dryRun=1"));
    const body = (await res.json()) as Body;
    expect(body.data).toMatchObject({ dryRun: true, wouldReap: 3 });
    expect(state.updates).toBe(0);
    expect(find("stuck-running")?.status).toBe("running");
  });

  it("되돌린 잡은 다음 실행에서 다시 건드리지 않는다 (멱등)", async () => {
    await GET(req());
    const res = await GET(req());
    const body = (await res.json()) as Body;
    expect(body.data?.reaped).toBe(0);
  });
});

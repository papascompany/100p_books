import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * lib/email/worker.test.ts
 *
 * 고정하려는 계약은 하나다: **발송 인프라가 없을 때 큐를 파괴하지 않는다.**
 *
 * 예전 구현은 RESEND_API_KEY 가 없으면 잡을 'cancelled' 로 종결시켰다. 그러면 나중에
 * 키를 등록해도 그동안 쌓인 주문 확인·배송 알림이 되살아나지 않는다(영구 유실).
 * 게다가 잡을 'sending' 으로 claim 하며 attempt 를 올려, cron 이 도는 것만으로
 * max_attempts 가 소진됐다. 이 테스트는 그 회귀를 막는다.
 */

vi.mock("server-only", () => ({}));

const fromMock = vi.fn();
vi.mock("@/lib/db/admin", () => ({
  createAdminSupabase: () => ({ from: fromMock }),
}));

// worker 가 최상단에서 import 하므로 SDK 도 막아둔다(네트워크 접근 차단).
// send 는 테스트마다 결과를 바꿀 수 있게 공유 mock 으로 위임한다.
const sendMock = vi.fn();
vi.mock("resend", () => ({
  Resend: class {
    emails = { send: (...args: unknown[]) => sendMock(...args) };
  },
}));

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import {
  IMMEDIATE_SEND_GRACE_MS,
  buildEmailJobPayload,
  emailJobIdempotencyKey,
  processEmailQueue,
} from "./worker";

const ORIGINAL_KEY = process.env.RESEND_API_KEY;

beforeEach(() => {
  fromMock.mockReset();
});

afterEach(() => {
  if (ORIGINAL_KEY === undefined) delete process.env.RESEND_API_KEY;
  else process.env.RESEND_API_KEY = ORIGINAL_KEY;
});

describe("processEmailQueue — 발송 인프라 미설정", () => {
  beforeEach(() => {
    delete process.env.RESEND_API_KEY;
  });

  it("큐를 건드리지 않고 deferred 로 보고한다 (대기 건수 포함)", async () => {
    const inMock = vi.fn().mockResolvedValue({ count: 7, error: null });
    const selectMock = vi.fn().mockReturnValue({ in: inMock });
    fromMock.mockReturnValue({ select: selectMock });

    const result = await processEmailQueue();

    expect(result).toEqual({
      processed: 0,
      sent: 0,
      failed: 0,
      skipped: 0,
      deferred: true,
      queued: 7,
    });

    // 조회는 head-count 하나뿐이어야 한다 — 상태를 바꾸는 호출이 있으면 안 된다.
    expect(fromMock).toHaveBeenCalledTimes(1);
    expect(fromMock).toHaveBeenCalledWith("email_jobs");
    expect(selectMock).toHaveBeenCalledWith("id", { count: "exact", head: true });
    expect(inMock).toHaveBeenCalledWith("status", ["pending", "failed"]);
  });

  it("count 조회가 실패해도 throw 하지 않고 0 으로 보고한다", async () => {
    const inMock = vi.fn().mockResolvedValue({ count: null, error: null });
    fromMock.mockReturnValue({ select: () => ({ in: inMock }) });

    await expect(processEmailQueue()).resolves.toMatchObject({
      deferred: true,
      queued: 0,
    });
  });
});

describe("processEmailQueue — 발송 인프라 설정됨", () => {
  beforeEach(() => {
    process.env.RESEND_API_KEY = "re_test_key";
  });

  it("deferred 가드를 건너뛰고 실제 큐 조회로 진입한다", async () => {
    // 후보 0건 — 정상 경로로 들어왔는지만 확인한다.
    const limitMock = vi.fn().mockResolvedValue({ data: [], error: null });
    const orderMock = vi.fn().mockReturnValue({ limit: limitMock });
    // scheduled_at·created_at(생성 유예) 두 번의 lte 뒤에 order 가 온다.
    const lteMock = vi.fn();
    lteMock.mockReturnValue({ lte: lteMock, order: orderMock });
    const inMock = vi.fn().mockReturnValue({ lte: lteMock });
    const selectMock = vi.fn().mockReturnValue({ in: inMock });
    fromMock.mockReturnValue({ select: selectMock });

    const result = await processEmailQueue();

    expect(result.deferred).toBeUndefined();
    expect(result).toMatchObject({ processed: 0, sent: 0, failed: 0, skipped: 0 });
    // head-count 가 아니라 컬럼 목록을 가져오는 본 조회여야 한다.
    expect(selectMock.mock.calls[0]?.[1]).toBeUndefined();
  });
});

// =====================================================================
// 다중 배치 소진 · 시간 예산 · Resend rate limit (OPS-1)
// =====================================================================

/**
 * email_jobs 테이블을 흉내 내는 인메모리 가짜. 워커가 쓰는 체인
 * (select/update → in/eq/lte → order/limit → maybeSingle → await) 만 구현한다.
 * 조건부 UPDATE(claim) 가 실제로 행 상태를 바꾸므로, "같은 잡을 두 번 claim 하지 않는다"
 * 같은 의미를 목 호출 순서가 아니라 최종 행 상태로 검증할 수 있다.
 */
type FakeRow = Record<string, unknown> & {
  id: string;
  status: string;
  attempt: number;
};

interface FakeResult {
  data: unknown;
  error: { message: string } | null;
}

function createFakeEmailJobs(rows: FakeRow[]) {
  class FakeQuery implements PromiseLike<FakeResult> {
    private mode: "select" | "update" = "select";
    private columns = "";
    private patch: Record<string, unknown> = {};
    private filters: Array<(r: FakeRow) => boolean> = [];
    private orderCol: string | null = null;
    private limitN: number | null = null;
    private single = false;

    select(columns: string): this {
      if (this.mode === "select") this.columns = columns;
      return this;
    }
    update(patch: Record<string, unknown>): this {
      this.mode = "update";
      this.patch = patch;
      return this;
    }
    in(col: string, values: readonly unknown[]): this {
      this.filters.push((r) => values.includes(r[col]));
      return this;
    }
    eq(col: string, value: unknown): this {
      this.filters.push((r) => r[col] === value);
      return this;
    }
    lte(col: string, value: string): this {
      this.filters.push((r) => String(r[col]) <= value);
      return this;
    }
    order(col: string): this {
      this.orderCol = col;
      return this;
    }
    limit(n: number): this {
      this.limitN = n;
      return this;
    }
    maybeSingle(): this {
      this.single = true;
      return this;
    }
    then<T1 = FakeResult, T2 = never>(
      onfulfilled?: ((value: FakeResult) => T1 | PromiseLike<T1>) | null,
      onrejected?: ((reason: unknown) => T2 | PromiseLike<T2>) | null,
    ): PromiseLike<T1 | T2> {
      return Promise.resolve(this.exec()).then(onfulfilled, onrejected);
    }

    private exec(): FakeResult {
      let matched = rows.filter((r) => this.filters.every((f) => f(r)));
      const col = this.orderCol;
      if (col) {
        matched = [...matched].sort((a, b) => String(a[col]).localeCompare(String(b[col])));
      }
      if (this.mode === "update") {
        for (const r of matched) Object.assign(r, this.patch);
        if (this.single) {
          return { data: matched[0] ? { id: matched[0].id } : null, error: null };
        }
        return { data: null, error: null };
      }
      if (this.limitN !== null) matched = matched.slice(0, this.limitN);
      if (this.columns === "id") {
        return { data: matched.map((r) => ({ id: r.id })), error: null };
      }
      // DB 가 주는 것은 복사본이다 — 이후 UPDATE 가 워커 손의 job 객체를 바꾸면 안 된다.
      return { data: matched.map((r) => ({ ...r })), error: null };
    }
  }

  return { query: () => new FakeQuery() };
}

function makeJob(i: number, overrides: Partial<FakeRow> = {}): FakeRow {
  return {
    id: `job-${String(i).padStart(3, "0")}`,
    template: "order.paid",
    to_email: `user${i}@example.com`,
    to_name: null,
    subject: "주문이 접수되었습니다",
    body_text: "본문",
    body_html: null,
    context: {},
    status: "pending",
    attempt: 0,
    max_attempts: 3,
    last_error: null,
    related_type: null,
    related_id: null,
    scheduled_at: new Date(Date.UTC(2026, 0, 1) + i * 1000).toISOString(),
    sent_at: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

/** 가상 시계 — sleep 은 실제로 기다리지 않고 시계만 전진시킨다. */
function createClock() {
  let t = 0;
  const sleep = vi.fn(async (ms: number) => {
    t += ms;
  });
  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms;
    },
    sleep,
  };
}

const SENT = { data: { id: "re_msg" }, error: null };

describe("processEmailQueue — 한 호출에서 배치 반복 소진", () => {
  beforeEach(() => {
    process.env.RESEND_API_KEY = "re_test_key";
    sendMock.mockReset();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("batchSize 를 넘는 큐를 여러 배치로 모두 발송한다 (호출당 10건 상한 제거)", async () => {
    const rows = Array.from({ length: 25 }, (_, i) => makeJob(i + 1));
    const db = createFakeEmailJobs(rows);
    fromMock.mockImplementation(() => db.query());
    sendMock.mockResolvedValue(SENT);
    const clock = createClock();

    const result = await processEmailQueue({
      batchSize: 10,
      now: clock.now,
      sleep: clock.sleep,
    });

    expect(result).toMatchObject({
      processed: 25,
      sent: 25,
      failed: 0,
      skipped: 0,
      batches: 3,
      stopReason: "drained",
    });
    expect(sendMock).toHaveBeenCalledTimes(25);
    // 모든 잡이 정확히 한 번 claim 됐다 (attempt 1).
    expect(rows.every((r) => r.status === "sent" && r.attempt === 1)).toBe(true);
  });

  it("같은 호출 안에서 방금 실패한 잡을 다시 집어 attempt 를 태우지 않는다", async () => {
    const rows = Array.from({ length: 12 }, (_, i) => makeJob(i + 1));
    const db = createFakeEmailJobs(rows);
    fromMock.mockImplementation(() => db.query());
    sendMock.mockImplementation(async (payload: { to: string }) =>
      payload.to === "user1@example.com"
        ? { data: null, error: { name: "application_error", statusCode: 500, message: "boom" } }
        : SENT,
    );
    const clock = createClock();

    const result = await processEmailQueue({
      batchSize: 5,
      now: clock.now,
      sleep: clock.sleep,
    });

    expect(result).toMatchObject({ sent: 11, failed: 1, stopReason: "drained" });
    const failedCalls = sendMock.mock.calls.filter(
      ([p]) => (p as { to: string }).to === "user1@example.com",
    );
    expect(failedCalls).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: "failed", attempt: 1, last_error: "Resend: boom" });
  });

  it("시간 예산이 끝나면 새 잡을 claim 하지 않고 멈춘다 — 남은 잡은 다음 호출 몫", async () => {
    const rows = Array.from({ length: 30 }, (_, i) => makeJob(i + 1));
    const db = createFakeEmailJobs(rows);
    fromMock.mockImplementation(() => db.query());
    const clock = createClock();
    // 발송 1건에 1초가 걸리는 느린 상황.
    sendMock.mockImplementation(async () => {
      clock.advance(1000);
      return SENT;
    });

    const result = await processEmailQueue({
      batchSize: 10,
      timeBudgetMs: 10_000,
      minSendIntervalMs: 0,
      now: clock.now,
      sleep: clock.sleep,
    });

    expect(result).toMatchObject({ sent: 10, stopReason: "time_budget" });
    // 예산을 넘긴 뒤에는 claim 이 없어야 한다 — 'sending' 에 갇힌 잡 0, 남은 잡은 attempt 0.
    expect(rows.filter((r) => r.status === "sending")).toHaveLength(0);
    const untouched = rows.filter((r) => r.status === "pending");
    expect(untouched).toHaveLength(20);
    expect(untouched.every((r) => r.attempt === 0)).toBe(true);
  });

  it("기본 설정은 Resend 기본 한도(팀당 10 req/s)의 절반 속도 이하로 발송한다", async () => {
    const rows = Array.from({ length: 12 }, (_, i) => makeJob(i + 1));
    const db = createFakeEmailJobs(rows);
    fromMock.mockImplementation(() => db.query());
    const clock = createClock();
    const startedAt: number[] = [];
    sendMock.mockImplementation(async () => {
      startedAt.push(clock.now());
      return SENT;
    });

    const result = await processEmailQueue({ now: clock.now, sleep: clock.sleep });

    expect(result.sent).toBe(12);
    for (let i = 1; i < startedAt.length; i++) {
      expect(startedAt[i]! - startedAt[i - 1]!).toBeGreaterThanOrEqual(200);
    }
    // 어떤 1초 구간에도 발송 시작이 5건을 넘지 않는다.
    for (const t0 of startedAt) {
      expect(startedAt.filter((t) => t >= t0 && t < t0 + 1000).length).toBeLessThanOrEqual(5);
    }
  });

  it("429 rate_limit_exceeded 면 그 잡만 failed 로 두고 이번 호출을 멈춘다", async () => {
    const rows = Array.from({ length: 6 }, (_, i) => makeJob(i + 1));
    const db = createFakeEmailJobs(rows);
    fromMock.mockImplementation(() => db.query());
    sendMock
      .mockResolvedValueOnce(SENT)
      .mockResolvedValueOnce(SENT)
      .mockResolvedValueOnce({
        data: null,
        error: { name: "rate_limit_exceeded", statusCode: 429, message: "Too many requests" },
      });
    const clock = createClock();

    const result = await processEmailQueue({ now: clock.now, sleep: clock.sleep });

    expect(result).toMatchObject({ sent: 2, failed: 1, stopReason: "rate_limited" });
    expect(sendMock).toHaveBeenCalledTimes(3);
    expect(rows[2]).toMatchObject({ status: "failed", attempt: 1 });
    expect(rows.slice(3).every((r) => r.status === "pending" && r.attempt === 0)).toBe(true);
  });

  it("연속 발송 실패가 3건이면 멈춰 장애 중 큐 전체의 attempt 소진을 막는다", async () => {
    const rows = Array.from({ length: 10 }, (_, i) => makeJob(i + 1));
    const db = createFakeEmailJobs(rows);
    fromMock.mockImplementation(() => db.query());
    sendMock.mockRejectedValue(new Error("network down"));
    const clock = createClock();

    const result = await processEmailQueue({ now: clock.now, sleep: clock.sleep });

    expect(result).toMatchObject({ sent: 0, failed: 3, stopReason: "consecutive_failures" });
    expect(rows.filter((r) => r.status === "pending" && r.attempt === 0)).toHaveLength(7);
  });

  it("max_attempts 초과 잡은 발송 없이 cancelled 로 종결한다 (기존 의미 유지)", async () => {
    const rows = [makeJob(1, { status: "failed", attempt: 3, max_attempts: 3 }), makeJob(2)];
    const db = createFakeEmailJobs(rows);
    fromMock.mockImplementation(() => db.query());
    sendMock.mockResolvedValue(SENT);
    const clock = createClock();

    const result = await processEmailQueue({ now: clock.now, sleep: clock.sleep });

    expect(result).toMatchObject({ processed: 2, sent: 1, skipped: 1, stopReason: "drained" });
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(rows[0]).toMatchObject({ status: "cancelled", attempt: 3 });
  });

  it("스냅샷 상한(maxJobs)에 닿으면 max_jobs 로 보고하고 나머지는 남긴다", async () => {
    const rows = Array.from({ length: 15 }, (_, i) => makeJob(i + 1));
    const db = createFakeEmailJobs(rows);
    fromMock.mockImplementation(() => db.query());
    sendMock.mockResolvedValue(SENT);
    const clock = createClock();

    const result = await processEmailQueue({
      maxJobs: 10,
      now: clock.now,
      sleep: clock.sleep,
    });

    expect(result).toMatchObject({ sent: 10, stopReason: "max_jobs" });
    expect(rows.filter((r) => r.status === "pending")).toHaveLength(5);
  });
});

// =====================================================================
// 즉시 발송 경로(enqueueEmail)와의 중복 발송 방지 — 생성 유예 · idempotency key
// =====================================================================

const ORIGINAL_FROM = process.env.EMAIL_FROM;

function isoAgo(ms: number): string {
  return new Date(Date.now() - ms).toISOString();
}

/** makeJob(i) 와 같은 값의 payload 입력 — FakeRow 는 느슨한 Record 라 타입이 맞는 모양으로 따로 만든다. */
type PayloadSource = Parameters<typeof buildEmailJobPayload>[0];
function payloadSource(i: number, overrides: Partial<PayloadSource> = {}): PayloadSource {
  return {
    to_email: `user${i}@example.com`,
    to_name: null,
    subject: "주문이 접수되었습니다",
    body_text: "본문",
    body_html: null,
    ...overrides,
  };
}

describe("processEmailQueue — 즉시 발송 경로와의 중복 방지", () => {
  beforeEach(() => {
    process.env.RESEND_API_KEY = "re_test_key";
    sendMock.mockReset();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (ORIGINAL_FROM === undefined) delete process.env.EMAIL_FROM;
    else process.env.EMAIL_FROM = ORIGINAL_FROM;
  });

  it("생성 유예 안의 pending 잡은 claim·발송하지 않고, 유예가 지난 잡만 발송한다", async () => {
    const rows = [
      // enqueueEmail 이 방금 넣고 즉시 발송 중일 수 있는 잡
      makeJob(1, { created_at: isoAgo(1_000), scheduled_at: isoAgo(1_000) }),
      // 호출 라우트 maxDuration(300s) 직전까지 즉시 발송이 걸려 있을 수 있는 잡
      makeJob(2, { created_at: isoAgo(299_000), scheduled_at: isoAgo(299_000) }),
      makeJob(3, {
        created_at: isoAgo(IMMEDIATE_SEND_GRACE_MS + 60_000),
        scheduled_at: isoAgo(IMMEDIATE_SEND_GRACE_MS + 60_000),
      }),
    ];
    const db = createFakeEmailJobs(rows);
    fromMock.mockImplementation(() => db.query());
    sendMock.mockResolvedValue(SENT);
    const clock = createClock();

    const result = await processEmailQueue({ now: clock.now, sleep: clock.sleep });

    expect(result).toMatchObject({ processed: 1, sent: 1, stopReason: "drained" });
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect((sendMock.mock.calls[0]?.[0] as { to: string }).to).toBe("user3@example.com");
    expect(rows[0]).toMatchObject({ status: "pending", attempt: 0 });
    expect(rows[1]).toMatchObject({ status: "pending", attempt: 0 });
    expect(rows[2]).toMatchObject({ status: "sent", attempt: 1 });
  });

  it("관리자 재시도처럼 created_at 이 오래된 잡은 scheduled_at 이 방금이어도 바로 발송한다", async () => {
    const rows = [
      makeJob(1, {
        status: "pending",
        attempt: 0,
        created_at: isoAgo(24 * 60 * 60_000),
        scheduled_at: isoAgo(1_000),
      }),
    ];
    const db = createFakeEmailJobs(rows);
    fromMock.mockImplementation(() => db.query());
    sendMock.mockResolvedValue(SENT);
    const clock = createClock();

    const result = await processEmailQueue({ now: clock.now, sleep: clock.sleep });

    expect(result).toMatchObject({ sent: 1 });
    expect(rows[0]).toMatchObject({ status: "sent", attempt: 1 });
  });

  it("발송마다 잡 id·payload 기반 idempotency key 를 붙이고, 다음 호출의 재시도도 같은 키를 쓴다", async () => {
    const rows = [makeJob(1)];
    const db = createFakeEmailJobs(rows);
    fromMock.mockImplementation(() => db.query());
    sendMock
      .mockResolvedValueOnce({
        data: null,
        error: { name: "application_error", statusCode: 500, message: "boom" },
      })
      .mockResolvedValueOnce(SENT);
    const clock = createClock();

    await processEmailQueue({ now: clock.now, sleep: clock.sleep });
    expect(rows[0]).toMatchObject({ status: "failed", attempt: 1 });
    await processEmailQueue({ now: clock.now, sleep: clock.sleep });
    expect(rows[0]).toMatchObject({ status: "sent", attempt: 2 });

    const keys = sendMock.mock.calls.map(
      ([, options]) => (options as { idempotencyKey?: string } | undefined)?.idempotencyKey,
    );
    expect(keys).toHaveLength(2);
    expect(keys[0]).toMatch(/^email-job\/job-001\/[0-9a-f]{16}$/);
    expect(keys[1]).toBe(keys[0]);
    expect(keys[0]).toBe(emailJobIdempotencyKey("job-001", buildEmailJobPayload(payloadSource(1))));
  });

  it("payload 가 바뀌면(EMAIL_FROM 수정) 키도 바뀌어 409 invalid_idempotent_request 로 막히지 않는다", () => {
    const jobId = "job-001";
    const job = payloadSource(1, { to_name: "홍길동", body_html: "<p>본문</p>" });

    process.env.EMAIL_FROM = "Wrong <noreply@unverified.example>";
    const before = buildEmailJobPayload(job);
    process.env.EMAIL_FROM = "100p Books <noreply@100pbooks.com>";
    const after = buildEmailJobPayload(job);

    expect(after).toEqual({
      from: "100p Books <noreply@100pbooks.com>",
      to: "홍길동 <user1@example.com>",
      subject: "주문이 접수되었습니다",
      text: "본문",
      html: "<p>본문</p>",
    });
    expect(emailJobIdempotencyKey(jobId, after)).toBe(emailJobIdempotencyKey(jobId, after));
    expect(emailJobIdempotencyKey(jobId, before)).not.toBe(emailJobIdempotencyKey(jobId, after));
    // Resend 문서 한도 256자 이내
    expect(emailJobIdempotencyKey("0f8fad5b-d9cb-469f-a165-70867728950e", after).length).toBeLessThanOrEqual(256);
  });
});

describe("IMMEDIATE_SEND_GRACE_MS — 즉시 발송 호출 라우트의 maxDuration 보다 길다", () => {
  const REPO_ROOT = path.resolve(__dirname, "../..");
  /** Vercel Fluid compute 기본 maxDuration (공식 문서 functions/configuring-functions/duration, 2026-09-17 확인). */
  const VERCEL_DEFAULT_MAX_DURATION_S = 300;

  function sourceFiles(dir: string): string[] {
    return readdirSync(dir, { recursive: true, encoding: "utf8" })
      .filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f))
      .map((f) => path.join(dir, f));
  }

  it("enqueueEmail 을 import 하는 파일은 모두 라우트이고, 그 maxDuration 이 유예보다 짧다", () => {
    const vercel = JSON.parse(readFileSync(path.join(REPO_ROOT, "vercel.json"), "utf8")) as {
      functions?: Record<string, { maxDuration?: number }>;
    };
    const queueFile = path.join(REPO_ROOT, "lib/email/queue.ts");
    const importers = [
      ...sourceFiles(path.join(REPO_ROOT, "app")),
      ...sourceFiles(path.join(REPO_ROOT, "lib")),
    ]
      .filter((file) => file !== queueFile)
      .filter((file) =>
        /from\s+["'](?:@\/lib\/email\/queue|\.\/queue)["']/.test(readFileSync(file, "utf8")),
      );

    expect(importers.length).toBeGreaterThan(0);
    for (const file of importers) {
      const rel = path.relative(REPO_ROOT, file).split(path.sep).join("/");
      // lib 모듈을 거치는 간접 호출이 생기면 그 모듈을 쓰는 라우트까지 따라가도록 이 테스트를 넓혀야 한다.
      expect(rel, `${rel}: enqueueEmail 간접 호출 — 호출 라우트의 maxDuration 을 확인할 것`).toMatch(
        /^app\/.+\/route\.ts$/,
      );
      const exported = readFileSync(file, "utf8").match(/export const maxDuration\s*=\s*(\d+)/);
      const seconds = Math.max(
        exported ? Number(exported[1]) : VERCEL_DEFAULT_MAX_DURATION_S,
        vercel.functions?.[rel]?.maxDuration ?? 0,
      );
      expect(
        seconds * 1000,
        `${rel} maxDuration ${seconds}s — lib/email/worker.ts IMMEDIATE_SEND_GRACE_MS 를 올려야 한다`,
      ).toBeLessThan(IMMEDIATE_SEND_GRACE_MS);
    }
  });
});

// =====================================================================
// 발송 타임아웃 · 실패 분류 · 스냅샷 상한 의미
// =====================================================================

describe("processEmailQueue — 발송 타임아웃과 실패 분류", () => {
  beforeEach(() => {
    process.env.RESEND_API_KEY = "re_test_key";
    sendMock.mockReset();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const never = () => new Promise<never>(() => {});
  const resendError = (name: string, statusCode: number | null, message = "rejected") => ({
    data: null,
    error: { name, statusCode, message },
  });

  it("Resend 응답이 sendTimeoutMs 를 넘으면 failed 로 두고 'sending' 에 가두지 않는다", async () => {
    const rows = [makeJob(1), makeJob(2)];
    const db = createFakeEmailJobs(rows);
    fromMock.mockImplementation(() => db.query());
    sendMock.mockImplementationOnce(never).mockResolvedValueOnce(SENT);
    const clock = createClock();

    const result = await processEmailQueue({
      sendTimeoutMs: 5,
      now: clock.now,
      sleep: clock.sleep,
    });

    expect(result).toMatchObject({ sent: 1, failed: 1, stopReason: "drained" });
    expect(rows[0]).toMatchObject({ status: "failed", attempt: 1 });
    expect(String(rows[0]?.last_error)).toContain("시간 초과");
    expect(rows.some((r) => r.status === "sending")).toBe(false);
  });

  it("타임아웃이 연속되면 시스템 실패로 세어 3건에서 멈춘다", async () => {
    const rows = Array.from({ length: 5 }, (_, i) => makeJob(i + 1));
    const db = createFakeEmailJobs(rows);
    fromMock.mockImplementation(() => db.query());
    sendMock.mockImplementation(never);
    const clock = createClock();

    const result = await processEmailQueue({
      sendTimeoutMs: 5,
      now: clock.now,
      sleep: clock.sleep,
    });

    expect(result).toMatchObject({ failed: 3, stopReason: "consecutive_failures" });
    expect(rows.filter((r) => r.status === "pending" && r.attempt === 0)).toHaveLength(2);
    expect(rows.some((r) => r.status === "sending")).toBe(false);
  });

  it("큐 앞쪽의 잡 단위 4xx 거절(잘못된 수신 주소) 3건이 뒤 잡 발송을 막지 않는다", async () => {
    const rows = Array.from({ length: 6 }, (_, i) => makeJob(i + 1));
    const db = createFakeEmailJobs(rows);
    fromMock.mockImplementation(() => db.query());
    sendMock
      .mockResolvedValueOnce(resendError("validation_error", 422, "Invalid `to` field"))
      .mockResolvedValueOnce(resendError("validation_error", 422, "Invalid `to` field"))
      .mockResolvedValueOnce(resendError("validation_error", 422, "Invalid `to` field"))
      .mockResolvedValue(SENT);
    const clock = createClock();

    const result = await processEmailQueue({ now: clock.now, sleep: clock.sleep });

    expect(result).toMatchObject({ sent: 3, failed: 3, stopReason: "drained" });
    // 거절된 잡도 재시도 의미는 그대로(failed, 다음 cron 에서 max_attempts 까지).
    expect(rows.slice(0, 3).every((r) => r.status === "failed" && r.attempt === 1)).toBe(true);
  });

  it("모든 잡이 4xx 로 거절되는 설정 오류면 10건에서 멈춰 큐 전체의 attempt 를 태우지 않는다", async () => {
    const rows = Array.from({ length: 12 }, (_, i) => makeJob(i + 1));
    const db = createFakeEmailJobs(rows);
    fromMock.mockImplementation(() => db.query());
    sendMock.mockResolvedValue(resendError("validation_error", 422));
    const clock = createClock();

    const result = await processEmailQueue({ now: clock.now, sleep: clock.sleep });

    expect(result).toMatchObject({ failed: 10, stopReason: "consecutive_failures" });
    expect(rows.filter((r) => r.status === "pending" && r.attempt === 0)).toHaveLength(2);
  });

  it.each([
    ["403 도메인 미인증", "validation_error", 403],
    ["401 제한된 API 키", "restricted_api_key", 401],
    ["422 invalid_from_address (EMAIL_FROM 공통)", "invalid_from_address", 422],
    ["네트워크 실패 (statusCode null)", "application_error", null],
  ] as const)("%s 는 시스템 실패로 세어 3건에서 멈춘다", async (_label, name, statusCode) => {
    const rows = Array.from({ length: 5 }, (_, i) => makeJob(i + 1));
    const db = createFakeEmailJobs(rows);
    fromMock.mockImplementation(() => db.query());
    sendMock.mockResolvedValue(resendError(name, statusCode));
    const clock = createClock();

    const result = await processEmailQueue({ now: clock.now, sleep: clock.sleep });

    expect(result).toMatchObject({ failed: 3, stopReason: "consecutive_failures" });
    expect(rows.filter((r) => r.status === "pending" && r.attempt === 0)).toHaveLength(2);
  });

  it("대상이 정확히 maxJobs 건이면 전부 처리하고 drained — max_jobs 는 실제로 더 남았을 때만", async () => {
    const rows = Array.from({ length: 10 }, (_, i) => makeJob(i + 1));
    const db = createFakeEmailJobs(rows);
    fromMock.mockImplementation(() => db.query());
    sendMock.mockResolvedValue(SENT);
    const clock = createClock();

    const result = await processEmailQueue({
      maxJobs: 10,
      now: clock.now,
      sleep: clock.sleep,
    });

    expect(result).toMatchObject({ sent: 10, stopReason: "drained" });
    expect(rows.every((r) => r.status === "sent")).toBe(true);
  });
});

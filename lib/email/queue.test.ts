import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * lib/email/queue.test.ts
 *
 * createAdminSupabase 를 모킹해서 enqueueEmail 이 적절한 INSERT payload 를 만들고
 * 예외 시에도 throw 하지 않는지(enqueue 실패가 비즈니스 로직 막지 않음) 검증.
 *
 * 실 supabase-js 는 깊은 빌더 체인이라, 본 테스트는 lightweight mock 으로
 * .from(...).insert(...).select(...).single() 흐름을 시뮬레이션한다.
 */

// server-only 마커는 jsdom 환경에서 throw — 빈 stub 으로 교체.
vi.mock("server-only", () => ({}));

// 가짜 admin supabase. 외부 모듈 import 전에 vi.mock 사전 설정.
const insertMock = vi.fn();
const selectMock = vi.fn();
const singleMock = vi.fn();
const fromMock = vi.fn();
const updateMock = vi.fn();
const updateEqMock = vi.fn();

vi.mock("@/lib/db/admin", () => ({
  createAdminSupabase: () => ({
    from: fromMock,
  }),
}));

// 즉시 발송은 worker 의 sendEmailJob 을 거쳐 Resend SDK 를 부른다 — 네트워크 차단 + 결과 주입.
const sendMock = vi.fn();
vi.mock("resend", () => ({
  Resend: class {
    emails = { send: (...args: unknown[]) => sendMock(...args) };
  },
}));

import { enqueueEmail } from "./queue";
import {
  EMAIL_SEND_TIMEOUT_MS,
  buildEmailJobPayload,
  emailJobIdempotencyKey,
} from "./worker";

beforeEach(() => {
  insertMock.mockReset();
  selectMock.mockReset();
  singleMock.mockReset();
  fromMock.mockReset();

  updateMock.mockReset();
  updateEqMock.mockReset();
  sendMock.mockReset();

  // chain: .from('email_jobs').insert(payload).select('id').single()
  //        .from('email_jobs').update(patch).eq('id', jobId)  ← 즉시 발송 성공 시
  fromMock.mockImplementation((_table: string) => ({
    insert: insertMock,
    update: updateMock,
  }));
  updateMock.mockImplementation((_patch: unknown) => ({ eq: updateEqMock }));
  updateEqMock.mockResolvedValue({ error: null });
  insertMock.mockImplementation((_payload: unknown) => ({
    select: selectMock,
  }));
  selectMock.mockImplementation((_cols: string) => ({
    single: singleMock,
  }));
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("enqueueEmail", () => {
  it("정상 INSERT — 반환된 jobId 매핑", async () => {
    singleMock.mockResolvedValue({ data: { id: "job-123" }, error: null });

    const result = await enqueueEmail({
      template: "order.paid",
      to: { email: "buyer@example.com", name: "Hong" },
      context: {
        kind: "order",
        orderId: "ord-1",
        customerName: "Hong",
        bookSizeName: "A5",
        pageCount: 50,
        qty: 1,
        amount: 19000,
      },
      relatedType: "order",
      relatedId: "ord-1",
    });

    expect(result.ok).toBe(true);
    expect(result.jobId).toBe("job-123");
    expect(fromMock).toHaveBeenCalledWith("email_jobs");
    expect(insertMock).toHaveBeenCalledTimes(1);

    const payload = insertMock.mock.calls[0]![0] as Record<string, unknown>;
    expect(payload.template).toBe("order.paid");
    expect(payload.to_email).toBe("buyer@example.com");
    expect(payload.to_name).toBe("Hong");
    expect(payload.subject).toContain("100p Books");
    expect(payload.body_text).toContain("Hong");
    expect(payload.body_html).toMatch(/<!doctype html>/);
    expect(payload.status).toBe("pending");
    expect(payload.attempt).toBe(0);
    expect(payload.max_attempts).toBe(3);
    expect(payload.related_type).toBe("order");
    expect(payload.related_id).toBe("ord-1");
  });

  it("수신자 이메일 빈 값 — INSERT 호출 없이 ok=false", async () => {
    const result = await enqueueEmail({
      template: "user.welcome",
      to: { email: "" },
      context: {
        kind: "user",
        email: "",
        displayName: "x",
      },
    });

    expect(result.ok).toBe(false);
    expect(result.jobId).toBeNull();
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("supabase INSERT 에러 — throw 하지 않고 ok=false 반환", async () => {
    singleMock.mockResolvedValue({
      data: null,
      error: { message: "permission denied" },
    });

    const result = await enqueueEmail({
      template: "user.welcome",
      to: { email: "x@example.com" },
      context: {
        kind: "user",
        email: "x@example.com",
        displayName: "x",
      },
    });

    expect(result.ok).toBe(false);
    expect(result.jobId).toBeNull();
    expect(result.error).toContain("permission denied");
  });

  it("템플릿 렌더링 예외 — throw 하지 않음 (kind mismatch 등)", async () => {
    // user.welcome 에 OrderContext 를 넣으면 templates.ts 가 throw → queue 가 catch.
    // 의도적 misuse — 타입 캐스팅으로 우회.
    const result = await enqueueEmail({
      template: "user.welcome",
      to: { email: "x@example.com" },
      context: {
        kind: "order",
        orderId: "x",
        customerName: "x",
        bookSizeName: "x",
        pageCount: 0,
        qty: 0,
        amount: 0,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
    });

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/UserContext/);
    expect(insertMock).not.toHaveBeenCalled();
  });
});

describe("enqueueEmail — 즉시 발송 (워커와 같은 payload·Idempotency-Key·응답 대기 상한)", () => {
  const ORDER_ARGS = {
    template: "order.paid" as const,
    to: { email: "buyer@example.com", name: "Hong" },
    context: {
      kind: "order" as const,
      orderId: "ord-1",
      customerName: "Hong",
      bookSizeName: "A5",
      pageCount: 50,
      qty: 1,
      amount: 19000,
    },
    relatedType: "order",
    relatedId: "ord-1",
  };

  /** INSERT 된 값 → 워커가 나중에 그 행을 읽어 만들 payload·키. */
  function workerKeyForInserted(jobId: string): { payload: unknown; key: string } {
    const row = insertMock.mock.calls[0]![0] as Parameters<typeof buildEmailJobPayload>[0];
    const payload = buildEmailJobPayload(row);
    return { payload, key: emailJobIdempotencyKey(jobId, payload) };
  }

  beforeEach(() => {
    vi.stubEnv("RESEND_API_KEY", "re_test_key");
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    singleMock.mockResolvedValue({ data: { id: "job-123" }, error: null });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("성공 — 워커와 같은 payload·키로 보내고 sent 로 마킹한다", async () => {
    sendMock.mockResolvedValue({ data: { id: "re_msg" }, error: null });

    const result = await enqueueEmail(ORDER_ARGS);

    expect(result).toEqual({ ok: true, jobId: "job-123", sent: true });
    expect(sendMock).toHaveBeenCalledTimes(1);
    const [payload, options] = sendMock.mock.calls[0] as [unknown, { idempotencyKey?: string }];
    const expected = workerKeyForInserted("job-123");
    expect(payload).toEqual(expected.payload);
    expect(options.idempotencyKey).toBe(expected.key);
    expect(options.idempotencyKey).toMatch(/^email-job\/job-123\/[0-9a-f]{16}$/);

    expect(updateMock).toHaveBeenCalledTimes(1);
    expect(updateMock.mock.calls[0]![0]).toMatchObject({ status: "sent", attempt: 1, last_error: null });
    expect(updateEqMock).toHaveBeenCalledWith("id", "job-123");
  });

  it("Resend 오류 — throw 없이 sent=false, 행은 pending 그대로(상태 갱신 없음)", async () => {
    sendMock.mockResolvedValue({
      data: null,
      error: { name: "application_error", statusCode: 500, message: "boom" },
    });

    const result = await enqueueEmail(ORDER_ARGS);

    expect(result).toEqual({ ok: true, jobId: "job-123", sent: false });
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("SDK 예외 — throw 없이 sent=false", async () => {
    sendMock.mockRejectedValue(new Error("network down"));

    await expect(enqueueEmail(ORDER_ARGS)).resolves.toEqual({
      ok: true,
      jobId: "job-123",
      sent: false,
    });
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("응답이 없으면 EMAIL_SEND_TIMEOUT_MS 에서 기다림을 끊고 sent=false — 호출 라우트를 붙잡지 않는다", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    sendMock.mockImplementation(() => new Promise<never>(() => {}));

    let settled = false;
    const pending = enqueueEmail(ORDER_ARGS).then((r) => {
      settled = true;
      return r;
    });

    await vi.advanceTimersByTimeAsync(EMAIL_SEND_TIMEOUT_MS - 1);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);

    await expect(pending).resolves.toEqual({ ok: true, jobId: "job-123", sent: false });
    expect(EMAIL_SEND_TIMEOUT_MS).toBe(10_000);
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("RESEND_API_KEY 미설정 — 발송 시도 없이 pending 으로 둔다(cron deferred 계약과 같음)", async () => {
    vi.stubEnv("RESEND_API_KEY", "");

    const result = await enqueueEmail(ORDER_ARGS);

    expect(result).toEqual({ ok: true, jobId: "job-123", sent: false });
    expect(sendMock).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
  });
});

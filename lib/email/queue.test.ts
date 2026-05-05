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

vi.mock("@/lib/db/admin", () => ({
  createAdminSupabase: () => ({
    from: fromMock,
  }),
}));

import { enqueueEmail } from "./queue";

beforeEach(() => {
  insertMock.mockReset();
  selectMock.mockReset();
  singleMock.mockReset();
  fromMock.mockReset();

  // chain: .from('email_jobs').insert(payload).select('id').single()
  fromMock.mockImplementation((_table: string) => ({
    insert: insertMock,
  }));
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

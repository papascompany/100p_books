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
vi.mock("resend", () => ({
  Resend: class {
    emails = { send: vi.fn() };
  },
}));

import { processEmailQueue } from "./worker";

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
    const lteMock = vi.fn().mockReturnValue({ order: orderMock });
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

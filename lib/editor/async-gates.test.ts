import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createIdleTracker,
  createSerialQueue,
  fetchJsonWithTimeout,
} from "./async-gates";

describe("createSerialQueue", () => {
  it("앞 작업이 끝난 뒤 다음 작업을 시작한다 (실패해도 줄은 이어진다)", async () => {
    const q = createSerialQueue();
    const log: string[] = [];
    let releaseFirst: () => void = () => {};
    const first = q.run(
      () =>
        new Promise<string>((resolve) => {
          log.push("first:start");
          releaseFirst = () => {
            log.push("first:end");
            resolve("a");
          };
        }),
    );
    const second = q.run(async () => {
      log.push("second:start");
      throw new Error("boom");
    });
    const third = q.run(async () => {
      log.push("third:start");
      return "c";
    });

    await Promise.resolve();
    expect(log).toEqual(["first:start"]);
    releaseFirst();
    await expect(first).resolves.toBe("a");
    await expect(second).rejects.toThrow("boom");
    await expect(third).resolves.toBe("c");
    expect(log).toEqual([
      "first:start",
      "first:end",
      "second:start",
      "third:start",
    ]);
  });
});

describe("createIdleTracker", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("진행 중인 작업이 모두 끝나야 whenIdle 이 true", async () => {
    const t = createIdleTracker();
    await expect(t.whenIdle()).resolves.toBe(true);

    const endA = t.begin();
    const endB = t.begin();
    let settled: boolean | null = null;
    void t.whenIdle().then((v) => {
      settled = v;
    });
    endA();
    endA(); // 중복 종료는 무시
    await Promise.resolve();
    expect(settled).toBeNull();
    expect(t.busy).toBe(true);
    endB();
    await Promise.resolve();
    expect(settled).toBe(true);
    expect(t.busy).toBe(false);
  });

  it("timeout 안에 끝나지 않으면 false — 저장·이동이 영원히 막히지 않게", async () => {
    vi.useFakeTimers();
    const t = createIdleTracker();
    const end = t.begin();
    const waiting = t.whenIdle(1000);
    vi.advanceTimersByTime(1000);
    await expect(waiting).resolves.toBe(false);
    end();
    await expect(t.whenIdle(1000)).resolves.toBe(true);
  });
});

describe("fetchJsonWithTimeout", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("제한 시간 안에 응답하면 status·ok·JSON 본문을 돌려준다", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ ok: true, data: { version: "v1-x" } }), {
        status: 200,
      }),
    );
    const result = await fetchJsonWithTimeout(
      "/api/cover?projectId=p",
      { cache: "no-store" },
      10_000,
      fetchImpl as unknown as typeof fetch,
    );
    expect(result).toEqual({
      status: 200,
      ok: true,
      body: { ok: true, data: { version: "v1-x" } },
    });
    const init = (fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(init.cache).toBe("no-store");
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("JSON 이 아닌 본문은 body null", async () => {
    const fetchImpl = async () => new Response("not json", { status: 502 });
    const result = await fetchJsonWithTimeout(
      "/x",
      {},
      1000,
      fetchImpl as unknown as typeof fetch,
    );
    expect(result).toEqual({ status: 502, ok: false, body: null });
  });

  it("응답이 멈추면 시간 초과로 reject 하고 요청을 abort 한다 — 저장 큐가 영원히 막히지 않게", async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    // abort 를 무시하는 fetch 구현이어도 타이머로 끝난다.
    const fetchImpl = (_url: string, init?: RequestInit) => {
      signal = init?.signal ?? undefined;
      return new Promise<Response>(() => {});
    };
    const pending = fetchJsonWithTimeout(
      "/api/pages/p1",
      {},
      10_000,
      fetchImpl as unknown as typeof fetch,
    );
    const assertion = expect(pending).rejects.toThrow("시간 초과");
    await vi.advanceTimersByTimeAsync(9_999);
    expect(signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await assertion;
    expect(signal?.aborted).toBe(true);
  });

  it("네트워크 오류는 그대로 reject", async () => {
    const fetchImpl = async () => {
      throw new TypeError("Failed to fetch");
    };
    await expect(
      fetchJsonWithTimeout("/x", {}, 1000, fetchImpl as unknown as typeof fetch),
    ).rejects.toThrow("Failed to fetch");
  });
});

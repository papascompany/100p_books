/**
 * 에디터 비동기 작업 순서 보장 헬퍼 (클라이언트·서버 공용, 의존성 없음).
 */

export interface SerialQueue {
  /** 앞선 작업이 끝난 뒤(성공·실패 무관) task 를 실행한다. */
  run<T>(task: () => Promise<T>): Promise<T>;
}

/**
 * 저장 요청 직렬화.
 *
 * 자동저장·수동 저장·이동 전 flush 가 동시에 나가면, 먼저 끝난 저장이 서버 version 을
 * 바꾸는 바람에 뒤따르는 요청이 옛 baseVersion 으로 409 가 된다. 한 줄로 세우면
 * 각 요청이 직전 저장의 version 을 기준으로 삼는다.
 */
export function createSerialQueue(): SerialQueue {
  let tail: Promise<unknown> = Promise.resolve();
  return {
    run<T>(task: () => Promise<T>): Promise<T> {
      const result = tail.then(task, task);
      tail = result.catch(() => undefined);
      return result;
    },
  };
}

export interface IdleTracker {
  /** 작업 시작. 반환 함수를 정확히 한 번 호출해 종료를 알린다(중복 호출 무시). */
  begin(): () => void;
  readonly busy: boolean;
  /**
   * 진행 중인 작업이 모두 끝나면 true 로 resolve.
   * timeoutMs 가 있으면 그 안에 끝나지 않을 때 false — 이미지 로드가 멈춰도 저장·이동이
   * 영원히 막히지 않게 호출자가 실패로 처리한다.
   */
  whenIdle(timeoutMs?: number): Promise<boolean>;
}

/**
 * 캔버스 로드·복원 진행 추적.
 * 저장은 whenIdle 을 기다린 뒤 직렬화해, 교체 도중의 캔버스를 서버에 보내지 않는다.
 */
export function createIdleTracker(): IdleTracker {
  let count = 0;
  let waiters: Array<() => void> = [];
  return {
    begin() {
      count += 1;
      let ended = false;
      return () => {
        if (ended) return;
        ended = true;
        count -= 1;
        if (count === 0) {
          const ws = waiters;
          waiters = [];
          for (const w of ws) w();
        }
      };
    },
    get busy() {
      return count > 0;
    },
    whenIdle(timeoutMs?: number) {
      if (count === 0) return Promise.resolve(true);
      return new Promise<boolean>((resolve) => {
        let settled = false;
        let timer: ReturnType<typeof setTimeout> | null = null;
        const waiter = () => {
          if (settled) return;
          settled = true;
          if (timer) clearTimeout(timer);
          resolve(true);
        };
        waiters.push(waiter);
        if (timeoutMs !== undefined) {
          timer = setTimeout(() => {
            if (settled) return;
            settled = true;
            waiters = waiters.filter((w) => w !== waiter);
            resolve(false);
          }, timeoutMs);
        }
      });
    },
  };
}

export interface JsonFetchResult {
  status: number;
  ok: boolean;
  /** 파싱한 JSON 본문. 본문이 없거나 JSON 이 아니면 null. */
  body: unknown;
}

/**
 * 제한 시간 안에 **본문까지** 받는 JSON 요청. 시간 초과·네트워크 오류는 reject.
 *
 * 저장 큐 안에서 쓰는 요청(진입 직후 최신본 확인 등)이 멈추면 뒤따르는 자동저장·
 * 이동 전 flush 가 전부 막힌다(큐는 앞 작업이 끝나야 다음을 실행한다). 시간이 지나면
 * 요청을 abort 하고, fetch 구현이 abort 를 무시하더라도 타이머로 reject 한다.
 */
export async function fetchJsonWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  fetchImpl: typeof fetch = fetch,
): Promise<JsonFetchResult> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error(`요청 시간 초과 (${timeoutMs}ms)`));
    }, timeoutMs);
  });
  const work = (async (): Promise<JsonFetchResult> => {
    const res = await fetchImpl(url, { ...init, signal: controller.signal });
    const body: unknown = await res.json().catch(() => null);
    return { status: res.status, ok: res.ok, body };
  })();
  // 시간 초과로 먼저 끝난 뒤 늦게 reject 돼도 unhandled rejection 이 되지 않게.
  work.catch(() => undefined);
  try {
    return await Promise.race([work, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

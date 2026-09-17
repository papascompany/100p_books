import { describe, expect, it } from "vitest";

/**
 * lib/email/retry-policy.test.ts
 *
 * 고정하는 계약:
 *   - 발송 실패 백오프가 5분 → 30분 → 2시간(이후 유지)이다. 첫 시도~3번째 시도가 최소 35분이라
 *     5분 cron 에서 15~20분짜리 Resend 장애로는 max_attempts 3 을 다 쓰지 못한다.
 *   - 'sending' 은 STALE_SENDING_MS(10분)를 **넘겨야** 복구·관리자 재시도 대상이다.
 *   - 관리자 재시도: sent 는 거절, 진행 중 sending 은 거절, 오래된 sending·failed·cancelled·pending 은 허용.
 */

import {
  EMAIL_RETRY_BACKOFF_MS,
  STALE_SENDING_MS,
  decideAdminEmailRetry,
  emailRetryDelayMs,
  isStaleSending,
  nextEmailRetryAt,
  staleSendingCutoffIso,
} from "./retry-policy";

const MIN = 60_000;
const NOW = Date.UTC(2026, 8, 17, 12, 0, 0);
const iso = (ms: number) => new Date(ms).toISOString();

describe("emailRetryDelayMs", () => {
  it.each([
    [1, 5 * MIN],
    [2, 30 * MIN],
    [3, 120 * MIN],
    [4, 120 * MIN],
    [10, 120 * MIN],
  ])("%i 번째 시도 실패 → %i ms 뒤", (attempt, expected) => {
    expect(emailRetryDelayMs(attempt)).toBe(expected);
  });

  it("비정상 입력(0·음수·소수)은 첫 단계로 취급한다", () => {
    expect(emailRetryDelayMs(0)).toBe(5 * MIN);
    expect(emailRetryDelayMs(-3)).toBe(5 * MIN);
    expect(emailRetryDelayMs(1.9)).toBe(5 * MIN);
  });

  it("5분 cron 에서 max_attempts 3 을 모두 쓰려면 최소 35분이 걸린다 (15~20분 장애 흡수)", () => {
    // n 번째 시도 시각 ≥ (n-1 번째 시도 시각 + 지연). cron 이 정확히 그 시각에 돈다는 가장 빠른 경우.
    const firstToThird = emailRetryDelayMs(1) + emailRetryDelayMs(2);
    expect(firstToThird).toBeGreaterThanOrEqual(35 * MIN);
    expect(EMAIL_RETRY_BACKOFF_MS.every((ms, i, arr) => i === 0 || ms > arr[i - 1]!)).toBe(true);
  });
});

describe("nextEmailRetryAt", () => {
  it("now + 지연을 ISO 로 돌려준다", () => {
    expect(nextEmailRetryAt(1, NOW)).toBe(iso(NOW + 5 * MIN));
    expect(nextEmailRetryAt(2, NOW)).toBe(iso(NOW + 30 * MIN));
  });
});

describe("isStaleSending · staleSendingCutoffIso", () => {
  it("'sending' 이고 updated_at 이 10분을 넘긴 경우만 true", () => {
    expect(isStaleSending({ status: "sending", updated_at: iso(NOW - STALE_SENDING_MS - 1) }, NOW)).toBe(true);
    // 경계: 정확히 10분은 아직 아니다 (조건부 UPDATE 의 lt 와 같은 의미)
    expect(isStaleSending({ status: "sending", updated_at: iso(NOW - STALE_SENDING_MS) }, NOW)).toBe(false);
    expect(isStaleSending({ status: "sending", updated_at: iso(NOW - MIN) }, NOW)).toBe(false);
  });

  it("다른 상태이거나 시각을 읽을 수 없으면 false (보수적)", () => {
    const old = iso(NOW - 24 * 60 * MIN);
    for (const status of ["pending", "failed", "sent", "cancelled"] as const) {
      expect(isStaleSending({ status, updated_at: old }, NOW)).toBe(false);
    }
    expect(isStaleSending({ status: "sending", updated_at: "not-a-date" }, NOW)).toBe(false);
  });

  it("cutoff 는 now - STALE_SENDING_MS 이고, updated_at < cutoff 가 isStaleSending 과 일치한다", () => {
    const cutoff = staleSendingCutoffIso(NOW);
    expect(cutoff).toBe(iso(NOW - STALE_SENDING_MS));
    for (const ago of [STALE_SENDING_MS - 1, STALE_SENDING_MS, STALE_SENDING_MS + 1]) {
      const updated_at = iso(NOW - ago);
      expect(updated_at < cutoff).toBe(isStaleSending({ status: "sending", updated_at }, NOW));
    }
  });
});

describe("decideAdminEmailRetry", () => {
  const fresh = iso(NOW - MIN);
  const stale = iso(NOW - STALE_SENDING_MS - MIN);

  it("sent 는 ALREADY_SENT 로 거절", () => {
    expect(decideAdminEmailRetry({ status: "sent", updated_at: stale }, NOW)).toMatchObject({
      ok: false,
      code: "ALREADY_SENT",
    });
  });

  it("진행 중 sending 은 IN_PROGRESS 로 거절, 오래된 sending 은 허용", () => {
    expect(decideAdminEmailRetry({ status: "sending", updated_at: fresh }, NOW)).toMatchObject({
      ok: false,
      code: "IN_PROGRESS",
    });
    expect(decideAdminEmailRetry({ status: "sending", updated_at: stale }, NOW)).toEqual({
      ok: true,
      staleSending: true,
    });
  });

  it.each(["pending", "failed", "cancelled"] as const)("%s 는 허용", (status) => {
    expect(decideAdminEmailRetry({ status, updated_at: fresh }, NOW)).toEqual({
      ok: true,
      staleSending: false,
    });
  });
});

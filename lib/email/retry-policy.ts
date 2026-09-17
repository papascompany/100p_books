import type { EmailJob } from "@/lib/db/types";

/**
 * 이메일 잡 재시도·복구 정책 — 순수 함수(DB·SDK 의존 없음). 워커(lib/email/worker.ts)와
 * 관리자 재시도 라우트(app/api/admin/emails/[id]/retry)가 같은 기준을 쓰게 한 곳에 둔다.
 *
 * ── 재시도 백오프 ──────────────────────────────────────────────────────────
 * 예전에는 발송 실패 시 scheduled_at 을 그대로 둬, cron 이 5분 주기로 바뀐 뒤에는 다음 호출이
 * 곧바로 재시도했다. max_attempts 3 이 약 10~15분에 소진되므로 Resend 장애가 15~20분만
 * 이어져도 큐 앞쪽 잡(주문 확인·배송 알림)이 cancelled 로 끝났다.
 *
 * 그래서 n 번째 시도가 실패하면 scheduled_at 을 now + EMAIL_RETRY_BACKOFF_MS[n-1] 로 민다.
 *   - 1회 실패 → 5분 뒤 : 일시적 네트워크·5xx 는 다음 cron 1~2회 안에 회복.
 *   - 2회 실패 → 30분 뒤: 2·3번째 시도 사이만 30분 이상 벌어져, 첫 시도부터 마지막 시도까지
 *                         최소 35분(5 + 30)이 걸린다 → 15~20분짜리 장애로는 3회를 다 쓰지 못한다.
 *   - 3회 이상 실패 → 2시간 뒤: max_attempts 를 올린 잡의 추가 시도 간격. 기본 3 이면 이 시간
 *                         동안 'failed' 로 보이다가 다음 워커가 cancelled 로 종결한다.
 * cron 은 5분 간격이라 실제 재시도는 "지연이 끝난 뒤 첫 cron" 이다(최대 +5분).
 * scheduled_at 이 뒤로 가므로 장애 중에는 실패한 잡이 새 잡 뒤로 밀려, 워커의 연속 실패
 * 차단(호출당 3건)과 함께 같은 잡만 attempt 를 태우지 않는다.
 *
 * ── 'sending' 에 갇힌 잡 복구 ───────────────────────────────────────────────
 * 워커는 claim(→'sending') 후 발송·마킹까지 maxDuration 60s 안에 끝내도록 설계됐지만
 * (시간 예산 40s + 발송 대기 상한 10s), 함수가 강제 종료되면 행이 'sending' 에 남는다.
 * 'sending' 은 워커 조회 대상(pending·failed)이 아니고 관리자 재시도도 409 라 영구히 멈춘다.
 *
 * updated_at(claim 시각 — 트리거 + claim 패치가 함께 갱신)이 STALE_SENDING_MS 보다 오래된
 * 'sending' 은 "그 호출은 이미 죽었다" 로 본다. 10분 = process-emails maxDuration 60s 의 10배
 * (앱↔DB 시계 오차·cron 중복 호출 여유 포함, worker.test.ts 가 라우트 설정을 검사한다).
 * 복구 후 재발송이 중복 메일이 되지 않는 근거는 Resend Idempotency-Key 다: 같은 키 + 같은
 * payload 는 24시간 동안 재발송 없이 원래 응답을 돌려준다(공식 문서 dashboard/emails/
 * idempotency-keys, 2026-09-17 확인). 복구는 cron 5분 주기로 돌아 24시간보다 훨씬 이르다.
 */

/** n 번째 시도 실패 후 다음 시도까지의 지연(인덱스 n-1). 마지막 값은 그 이후 전부에 적용. */
export const EMAIL_RETRY_BACKOFF_MS: readonly number[] = [
  5 * 60_000,
  30 * 60_000,
  2 * 60 * 60_000,
];

/** failedAttempt(방금 실패한 시도 번호, 1부터) 뒤의 재시도 지연(ms). */
export function emailRetryDelayMs(failedAttempt: number): number {
  const last = EMAIL_RETRY_BACKOFF_MS.length - 1;
  const index = Math.min(Math.max(Math.trunc(failedAttempt), 1) - 1, last);
  return EMAIL_RETRY_BACKOFF_MS[index] ?? EMAIL_RETRY_BACKOFF_MS[last] ?? 0;
}

/** 실패한 잡의 다음 scheduled_at (ISO). nowMs 는 벽시계(Date.now) 기준. */
export function nextEmailRetryAt(failedAttempt: number, nowMs: number): string {
  return new Date(nowMs + emailRetryDelayMs(failedAttempt)).toISOString();
}

/** 이 시간보다 오래 'sending' 에 머문 잡은 발송 호출이 죽은 것으로 본다. 상세는 파일 상단 주석. */
export const STALE_SENDING_MS = 10 * 60_000;

/** updated_at 이 이 값보다 이전이면 오래된 'sending' (ISO, 조건부 UPDATE 필터용). */
export function staleSendingCutoffIso(nowMs: number): string {
  return new Date(nowMs - STALE_SENDING_MS).toISOString();
}

type JobState = Pick<EmailJob, "status" | "updated_at">;

/** 'sending' 이고 updated_at 이 STALE_SENDING_MS 보다 오래됐는가. 시각을 못 읽으면 false(보수적). */
export function isStaleSending(job: JobState, nowMs: number): boolean {
  if (job.status !== "sending") return false;
  const updatedMs = Date.parse(job.updated_at);
  if (Number.isNaN(updatedMs)) return false;
  return updatedMs < nowMs - STALE_SENDING_MS;
}

export type AdminEmailRetryDecision =
  | { ok: true; staleSending: boolean }
  | { ok: false; code: "ALREADY_SENT" | "IN_PROGRESS"; message: string };

/**
 * 관리자 재시도 허용 여부.
 *   - sent → 거절(중복 발송 방지).
 *   - sending → 오래된 것(발송 호출이 죽음)만 허용, 진행 중이면 거절.
 *   - pending·failed·cancelled → 허용.
 */
export function decideAdminEmailRetry(job: JobState, nowMs: number): AdminEmailRetryDecision {
  if (job.status === "sent") {
    return { ok: false, code: "ALREADY_SENT", message: "이미 발송 완료된 잡입니다." };
  }
  if (job.status === "sending") {
    if (isStaleSending(job, nowMs)) return { ok: true, staleSending: true };
    return {
      ok: false,
      code: "IN_PROGRESS",
      message: "현재 발송 중인 잡입니다. 잠시 후 다시 시도하세요.",
    };
  }
  return { ok: true, staleSending: false };
}

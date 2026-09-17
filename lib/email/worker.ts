import "server-only";

import { createHash } from "node:crypto";

import { Resend } from "resend";

import { createAdminSupabase } from "@/lib/db/admin";
import type { EmailJob } from "@/lib/db/types";

/**
 * 이메일 워커 — Vercel Cron (`/api/cron/process-emails`) 에서 호출.
 *
 * 동작:
 *   1. status in ('pending','failed') 이고 생성 유예가 지난 잡을 batch 만큼 가져옴
 *      (FOR UPDATE 는 supabase-js 미지원 → 낙관적: 가져온 후 조건부 update 로 race 회피).
 *   2. 각 잡을 sendEmail() 로 전달.
 *   3. 결과에 따라 status 마킹.
 *
 * Resend 통합:
 *   - RESEND_API_KEY 가 설정되어 있으면 Resend SDK 로 발송.
 *   - EMAIL_FROM 환경변수: 발신자 주소 (기본: "100p Books <noreply@100pbooks.com>").
 *   - **미설정이면 큐를 아예 건드리지 않는다**(deferred). 예전에는 잡을 'cancelled' 로
 *     종결시켰는데, 그러면 키를 나중에 등록해도 그동안 쌓인 주문·배송 알림이 영구 유실된다.
 *     지금은 pending 그대로 두므로 키를 넣는 순간 scheduled_at 순서대로 발송된다.
 *     attempt 도 소모하지 않는다(키 없는 상태로 cron 이 돌아 max_attempts 를 태우던 문제).
 *
 * 재시도:
 *   - 실패한 잡은 status='failed' + attempt+1.
 *   - 다음 워커 실행 시 idx_email_jobs_status_scheduled (status in ('pending','failed'))
 *     로 재시도. attempt >= max_attempts 면 영구 실패로 간주 (다음 폴링에서 제외하려면
 *     status='cancelled' 또는 attempt 조건으로 거름).
 *
 * 한 호출에서 배치 반복 소진 (OPS-1):
 *   - cron 이 5분 주기여도 호출당 10건이면 수요를 못 따라간다. 그래서 한 호출 안에서
 *     시간 예산(timeBudgetMs, 기본 40s — 라우트 maxDuration 60s 대비 20s 여유)이 남아 있는 동안
 *     batchSize 단위로 계속 처리한다. 예산이 끝나면 **새 잡을 claim 하지 않고** 멈춘다
 *     (이미 claim 한 잡은 발송·마킹까지 마친다). 남은 잡은 다음 호출이 이어받는다.
 *   - 호출 시작 시 대상 id 를 maxJobs 개까지 한 번만 스냅샷하고, 배치마다 그 id 로
 *     최신 행을 다시 읽는다. **같은 호출 안에서 한 잡은 최대 한 번만** 시도된다 —
 *     방금 실패해 'failed' 가 된 잡을 같은 호출이 다시 집어 attempt 를 연달아 태우지 않는다
 *     (재시도는 기존대로 다음 cron 실행).
 *   - claim(pending|failed → sending 조건부 UPDATE)·max_attempts·deferred 의미는 그대로다.
 *     cron 중복 호출로 **워커끼리** 실행이 겹쳐도 claim 은 한쪽만 성공한다.
 *
 * 즉시 발송 경로(lib/email/queue.ts enqueueEmail)와의 경쟁 — 생성 유예:
 *   - enqueueEmail 은 행을 pending(scheduled_at=now)으로 넣은 뒤 **claim 없이** Resend 를
 *     호출하고, 성공해야 'sent' 로 바꾼다. 그 사이(보통 수백 ms, 최악은 호출 라우트의
 *     maxDuration)에 워커가 같은 행을 claim 하면 두 경로가 모두 발송한다(주문·배송 메일 2통).
 *     cron 이 5분 주기가 되면서 이 창과 겹칠 기회가 하루 1회 → 288회로 늘었다.
 *   - 그래서 스냅샷은 created_at 이 IMMEDIATE_SEND_GRACE_MS(6분) 보다 오래된 잡만 본다.
 *     6분 = enqueueEmail 호출 라우트의 maxDuration 상한 300s(vercel.json payments/confirm,
 *     Vercel Fluid compute 기본값 300s — 공식 문서 functions/configuring-functions/duration,
 *     2026-09-17 확인) + 시계 오차 여유. 호출 라우트의 maxDuration 을 300s 넘게 올리면 이 값도
 *     올려야 한다(worker.test.ts 가 직접 호출 라우트의 설정을 검사한다).
 *   - created_at 기준이라 워커 자신의 failed 재시도와 관리자 재시도(created_at 은 오래됐고
 *     scheduled_at 만 now 로 바뀜)는 늦어지지 않는다. 즉시 발송이 실패해 pending 으로 남은
 *     잡만 최대 유예 6분 + cron 5분 뒤에 재시도된다.
 *
 * Idempotency key (Resend 공식 문서 dashboard/emails/idempotency-keys, 2026-09-17 확인):
 *   - 같은 키 + 같은 payload 는 24시간 동안 재발송 없이 원래 응답을 돌려준다.
 *     키는 emailJobIdempotencyKey(job.id, payload) — 잡 id + payload 지문이다.
 *   - 발송 타임아웃(sendTimeoutMs)으로 'failed' 처리한 요청이 실제로는 Resend 에 도달했더라도
 *     다음 재시도가 같은 키를 쓰므로 중복 발송되지 않는다.
 *   - payload 지문을 키에 넣는 이유: 같은 키에 다른 payload 면 409 invalid_idempotent_request
 *     이고, 문서는 오류 응답도 키에 저장되는지 밝히지 않는다. EMAIL_FROM 오설정을 고친 뒤의
 *     재시도가 24시간 동안 409 로 막히지 않게 payload 가 바뀌면 키도 바뀌게 한다.
 *   - 즉시 발송 경로도 buildEmailJobPayload + emailJobIdempotencyKey 를 쓰면 유예 창을 넘는
 *     hang(함수 강제 종료 후 pending 잔류)까지 막힌다 — queue.ts 반영은 별도 작업.
 *
 * Resend rate limit · 중단 조건:
 *   - 공식 문서(api-reference/rate-limit, 2026-09-17 확인) 기본 한도는 팀당 초당 10 요청,
 *     초과 시 429. 발송 시작 간격을 minSendIntervalMs(기본 200ms = 초당 5건 이하)로 벌려
 *     같은 팀의 다른 발송과 겹쳐도 여유를 둔다.
 *   - 429·일/월 quota 초과 응답이면 그 잡은 기존대로 'failed' 로 두고 이번 호출을 멈춘다
 *     (뒤 잡들의 attempt 를 헛되이 태우지 않음).
 *   - 실패는 두 갈래로 센다(성공하면 둘 다 0 으로):
 *     · 시스템 실패 — 예외·타임아웃·네트워크(statusCode 없음)·5xx·401/403(키·도메인 설정).
 *       다음 잡도 같은 이유로 실패할 가능성이 높아 maxConsecutiveFailures(기본 3)에서 멈춘다.
 *     · 잡 단위 거절 — 그 밖의 4xx(잘못된 수신 주소 422 등). 큐 앞쪽의 나쁜 주소 몇 건이
 *       뒤 메일 전체를 막지 않게 maxConsecutiveRejections(기본 10)까지 허용한다. 다만
 *       EMAIL_FROM 형식 오류처럼 모든 잡이 4xx 로 거절되는 설정 오류에서도 한 호출이 큐 전체의
 *       attempt 를 태우지 않도록 상한을 둔다.
 */

export interface ProcessOptions {
  /** 배치(본 조회 1회)당 잡 수. 기본 10. */
  batchSize?: number;
  /** 새 잡 claim 을 시작할 수 있는 시간 예산(ms). 기본 40_000 (maxDuration 60s 대비 여유). */
  timeBudgetMs?: number;
  /** 한 호출에서 스냅샷할 최대 잡 수. 기본 200 (시간 예산 ÷ 발송 간격 ≈ 호출당 처리 상한). */
  maxJobs?: number;
  /** Resend 발송 시작 간 최소 간격(ms). 기본 200 → 초당 5건 이하. */
  minSendIntervalMs?: number;
  /** 연속 **시스템** 실패(예외·타임아웃·5xx·401/403)가 이 수에 닿으면 멈춘다. 기본 3. */
  maxConsecutiveFailures?: number;
  /** 연속 **잡 단위 거절**(그 밖의 4xx)이 이 수에 닿으면 멈춘다. 기본 10. */
  maxConsecutiveRejections?: number;
  /** Resend 발송 1건의 응답 대기 상한(ms). 기본 10_000 — 넘으면 'failed' 로 두고 다음 잡. */
  sendTimeoutMs?: number;
  /** 테스트 주입용 시계 (기본 Date.now). */
  now?: () => number;
  /** 테스트 주입용 대기 (기본 setTimeout). */
  sleep?: (ms: number) => Promise<void>;
}

/**
 * 이번 호출이 멈춘 이유 — cron 응답에 실려 운영자가 "왜 다 못 비웠는지" 를 본다.
 * 적체 신호는 max_jobs·time_budget 뿐이다. drained 는 "지금 발송 대상이 없다" 이며,
 * 생성 유예(6분) 안의 새 잡은 대상에 들지 않으므로 pending 행이 남아 있어도 drained 일 수 있다.
 */
export type EmailQueueStopReason =
  | "drained" // 발송 대상 스냅샷을 다 처리했다
  | "max_jobs" // 스냅샷 상한(maxJobs)을 넘는 대상이 **실제로 더 있었다** — 남은 잡은 다음 호출
  | "time_budget" // 시간 예산 소진 — 남은 잡은 다음 호출
  | "rate_limited" // Resend 429 / quota 초과
  | "consecutive_failures" // 연속 시스템 실패 또는 연속 잡 단위 거절
  | "fetch_error"; // 큐 조회 실패

export interface ProcessResult {
  processed: number;
  sent: number;
  failed: number;
  skipped: number;
  /** 본 조회를 수행한 배치 수. deferred 일 때는 없다. */
  batches?: number;
  /** 이번 호출이 멈춘 이유. deferred 일 때는 없다. */
  stopReason?: EmailQueueStopReason;
  /**
   * true 면 발송 인프라가 없어 큐를 그대로 두고 아무것도 처리하지 않았다는 뜻.
   * cron 응답에 그대로 실려 나가므로 운영자가 "왜 0건인지" 를 바로 알 수 있다.
   */
  deferred?: boolean;
  /** deferred 일 때 대기 중인 잡 수 — 방치 규모를 드러낸다. */
  queued?: number;
}

const DEFAULT_BATCH = 10;
const DEFAULT_TIME_BUDGET_MS = 40_000;
const DEFAULT_MAX_JOBS = 200;
const DEFAULT_MIN_SEND_INTERVAL_MS = 200;
const DEFAULT_MAX_CONSECUTIVE_FAILURES = 3;
const DEFAULT_MAX_CONSECUTIVE_REJECTIONS = 10;
/**
 * 발송 1건 응답 대기 상한. 예산 마감 직전(40s)에 claim 해도 40 + 10 + DB 마킹 < maxDuration 60s 라
 * 함수가 끊겨 잡이 'sending' 에 갇히지 않는다. SDK(resend 6.12.3)는 AbortSignal 을 받지 않아
 * Promise.race 로 기다림만 끊는다 — 요청 자체가 뒤늦게 처리돼도 idempotency key 로 재발송이 막힌다.
 */
const DEFAULT_SEND_TIMEOUT_MS = 10_000;

/**
 * 즉시 발송 경로와 겹치지 않게 워커가 건너뛰는 생성 직후 구간. 상세는 파일 상단 주석.
 * enqueueEmail 을 호출하는 라우트의 maxDuration(최대 300s)보다 길어야 한다.
 */
export const IMMEDIATE_SEND_GRACE_MS = 6 * 60_000;

const JOB_COLUMNS =
  "id, template, to_email, to_name, subject, body_text, body_html, context, status, attempt, max_attempts, last_error, related_type, related_id, scheduled_at, sent_at, created_at, updated_at";

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function processEmailQueue(
  opts: ProcessOptions = {},
): Promise<ProcessResult> {
  const batch = Math.max(1, opts.batchSize ?? DEFAULT_BATCH);
  const timeBudgetMs = opts.timeBudgetMs ?? DEFAULT_TIME_BUDGET_MS;
  const maxJobs = Math.max(1, opts.maxJobs ?? DEFAULT_MAX_JOBS);
  const minSendIntervalMs = opts.minSendIntervalMs ?? DEFAULT_MIN_SEND_INTERVAL_MS;
  const maxConsecutiveFailures = Math.max(
    1,
    opts.maxConsecutiveFailures ?? DEFAULT_MAX_CONSECUTIVE_FAILURES,
  );
  const maxConsecutiveRejections = Math.max(
    1,
    opts.maxConsecutiveRejections ?? DEFAULT_MAX_CONSECUTIVE_REJECTIONS,
  );
  const sendTimeoutMs = Math.max(1, opts.sendTimeoutMs ?? DEFAULT_SEND_TIMEOUT_MS);
  const now = opts.now ?? Date.now;
  const sleep = opts.sleep ?? defaultSleep;
  const admin = createAdminSupabase();

  // 0) 발송 인프라 확인 — 없으면 큐를 **건드리지 않고** 그대로 대기시킨다.
  //    잡을 cancelled 로 종결하면 키 등록 후에도 되살릴 수 없다(주문 확인·배송 알림 유실).
  if (!process.env.RESEND_API_KEY) {
    const { count } = await admin
      .from("email_jobs")
      .select("id", { count: "exact", head: true })
      .in("status", ["pending", "failed"]);
    const queued = count ?? 0;
    console.warn(
      `[email/worker] RESEND_API_KEY 미설정 — 발송을 보류하고 큐를 보존합니다 (대기 ${queued}건). ` +
        `키를 등록하면 다음 cron 에서 자동 발송됩니다.`,
    );
    return { processed: 0, sent: 0, failed: 0, skipped: 0, deferred: true, queued };
  }

  const deadline = now() + timeBudgetMs;

  // 1) 이번 호출의 대상 스냅샷 — pending + failed, scheduled_at 순, id 만.
  //    created_at 이 유예 구간 안인 잡은 enqueueEmail 의 즉시 발송이 진행 중일 수 있어 뺀다.
  //    maxJobs + 1 건을 읽어 "상한을 넘는 대상이 실제로 더 있는지" 를 구분한다.
  //    (벽시계 기준 — opts.now 는 시간 예산 측정용 단조 시계라 DB 타임스탬프와 비교하지 않는다.)
  const wallNow = Date.now();
  const { data: idRows, error } = await admin
    .from("email_jobs")
    .select("id")
    .in("status", ["pending", "failed"])
    .lte("scheduled_at", new Date(wallNow).toISOString())
    .lte("created_at", new Date(wallNow - IMMEDIATE_SEND_GRACE_MS).toISOString())
    .order("scheduled_at", { ascending: true })
    .limit(maxJobs + 1);

  if (error) {
    console.error("[email/worker] fetch failed:", error.message);
    return {
      processed: 0,
      sent: 0,
      failed: 0,
      skipped: 0,
      batches: 0,
      stopReason: "fetch_error",
    };
  }

  const candidateIds = ((idRows ?? []) as Array<{ id: string }>).map((r) => r.id);
  const hasMoreThanMaxJobs = candidateIds.length > maxJobs;
  const ids = candidateIds.slice(0, maxJobs);
  if (ids.length === 0) {
    return {
      processed: 0,
      sent: 0,
      failed: 0,
      skipped: 0,
      batches: 0,
      stopReason: "drained",
    };
  }

  let processed = 0;
  let sent = 0;
  let failed = 0;
  let skipped = 0;
  let batches = 0;
  let consecutiveFailures = 0;
  let consecutiveRejections = 0;
  let lastSendStartedAt: number | null = null;
  let stopReason: EmailQueueStopReason | null = null;

  for (let offset = 0; offset < ids.length && stopReason === null; offset += batch) {
    if (now() >= deadline) {
      stopReason = "time_budget";
      break;
    }

    // 2) 배치 본 조회 — 스냅샷 이후 다른 워커·관리자가 바꾼 status/attempt 를 반영하려고
    //    id 로 최신 행을 다시 읽는다. 그 사이 처리된 잡은 status 조건에서 빠진다.
    const chunk = ids.slice(offset, offset + batch);
    const { data: rows, error: chunkErr } = await admin
      .from("email_jobs")
      .select(JOB_COLUMNS)
      .in("id", chunk)
      .in("status", ["pending", "failed"])
      .order("scheduled_at", { ascending: true });

    if (chunkErr) {
      console.error("[email/worker] batch fetch failed:", chunkErr.message);
      stopReason = "fetch_error";
      break;
    }
    batches += 1;

    for (const job of (rows ?? []) as EmailJob[]) {
      // 예산이 끝나면 새 잡은 claim 하지 않는다 — claim 직후 함수가 끊기면 'sending' 에 갇힌다.
      if (now() >= deadline) {
        stopReason = "time_budget";
        break;
      }
      processed += 1;

      // attempt >= max_attempts 라면 영구 실패 처리 (cancelled).
      if (job.attempt >= job.max_attempts) {
        await admin
          .from("email_jobs")
          .update({
            status: "cancelled",
            last_error:
              job.last_error ??
              `최대 시도 횟수 초과 (${job.attempt}/${job.max_attempts})`,
          })
          .eq("id", job.id)
          .eq("status", job.status); // race 보호
        skipped += 1;
        continue;
      }

      // 3) 'sending' 으로 마킹 — 동일 status 일 때만 (race 보호).
      const { data: claim, error: claimErr } = await admin
        .from("email_jobs")
        .update({
          status: "sending",
          attempt: job.attempt + 1,
        })
        .eq("id", job.id)
        .in("status", ["pending", "failed"])
        .select("id")
        .maybeSingle();

      if (claimErr || !claim) {
        // 다른 워커가 이미 가져갔거나 상태가 변경됨 → skip
        skipped += 1;
        continue;
      }

      // 4) Resend rate limit 준수 — 발송 시작 간격을 벌린다.
      if (lastSendStartedAt !== null) {
        const wait = lastSendStartedAt + minSendIntervalMs - now();
        if (wait > 0) await sleep(wait);
      }
      lastSendStartedAt = now();

      const result = await sendEmail(job, sendTimeoutMs);

      if (result.kind === "sent") {
        await admin
          .from("email_jobs")
          .update({
            status: "sent",
            sent_at: new Date().toISOString(),
            last_error: null,
          })
          .eq("id", job.id);
        sent += 1;
        consecutiveFailures = 0;
        consecutiveRejections = 0;
      } else if (result.kind === "cancelled") {
        await admin
          .from("email_jobs")
          .update({
            status: "cancelled",
            last_error: result.error,
          })
          .eq("id", job.id);
        skipped += 1;
      } else {
        // failed — 재시도는 다음 cron 실행에서.
        await admin
          .from("email_jobs")
          .update({
            status: "failed",
            last_error: result.error,
          })
          .eq("id", job.id);
        failed += 1;

        if (result.failure === "provider_limited") {
          console.warn(
            `[email/worker] Resend 한도 응답 — 이번 호출의 발송을 멈춥니다 (job ${job.id}).`,
          );
          stopReason = "rate_limited";
          break;
        }
        if (result.failure === "rejected") {
          // 잡 단위 거절(잘못된 수신 주소 등) — 뒤 잡은 계속 보내되, 전부 거절되는 설정 오류면 멈춘다.
          consecutiveRejections += 1;
          if (consecutiveRejections >= maxConsecutiveRejections) {
            console.warn(
              `[email/worker] 연속 발송 거절(4xx) ${consecutiveRejections}건 — 설정 오류 가능성, 이번 호출의 발송을 멈춥니다.`,
            );
            stopReason = "consecutive_failures";
            break;
          }
        } else {
          consecutiveFailures += 1;
          if (consecutiveFailures >= maxConsecutiveFailures) {
            console.warn(
              `[email/worker] 연속 시스템 실패 ${consecutiveFailures}건 — 이번 호출의 발송을 멈춥니다.`,
            );
            stopReason = "consecutive_failures";
            break;
          }
        }
      }
    }
  }

  if (stopReason === null) {
    stopReason = hasMoreThanMaxJobs ? "max_jobs" : "drained";
  }

  return {
    processed,
    sent,
    failed,
    skipped,
    batches,
    stopReason,
  };
}

// =====================================================================
// sendEmail — Resend SDK 발송.
// =====================================================================

/**
 * 실패 분류 — 호출자의 중단 판단용 (잡 상태 전이는 분류와 무관하게 'failed').
 *   provider_limited: 429·quota — 즉시 중단
 *   systemic: 예외·타임아웃·네트워크·5xx·401/403 — 다음 잡도 실패할 가능성이 높음
 *   rejected: 그 밖의 4xx — 이 잡의 문제일 가능성이 높음
 */
type SendFailure = "provider_limited" | "systemic" | "rejected";

interface SendResult {
  kind: "sent" | "failed" | "cancelled";
  error?: string;
  failure?: SendFailure;
}

/** 더 보내 봐야 같은 이유로 실패하는 Resend 오류 (rate limit·일/월 quota). */
const PROVIDER_LIMIT_ERRORS: ReadonlySet<string> = new Set([
  "rate_limit_exceeded",
  "daily_quota_exceeded",
  "monthly_quota_exceeded",
]);

/**
 * 상태 코드가 4xx 여도 모든 잡에 공통인 설정·서버 오류 (공식 문서 api-reference/errors 와
 * SDK 6.12.3 RESEND_ERROR_CODE_KEY 기준). 발신 주소는 EMAIL_FROM 하나라 잡 단위가 아니다.
 */
const SYSTEMIC_ERRORS: ReadonlySet<string> = new Set([
  "missing_api_key",
  "invalid_api_key",
  "restricted_api_key",
  "invalid_from_address",
  "application_error",
  "internal_server_error",
]);

function classifyResendError(error: {
  name: string;
  statusCode: number | null;
}): SendFailure {
  const status = error.statusCode;
  if (status === 429 || PROVIDER_LIMIT_ERRORS.has(error.name)) return "provider_limited";
  if (
    typeof status !== "number" || // SDK 가 fetch 자체 실패를 statusCode null 로 돌려준다
    status >= 500 ||
    status === 401 ||
    status === 403 || // 키 권한·도메인 미인증(validation_error 403)
    SYSTEMIC_ERRORS.has(error.name)
  ) {
    return "systemic";
  }
  return "rejected";
}

/** 발신자 주소. 환경변수 EMAIL_FROM 미설정이면 기본값 사용. */
function fromAddress(): string {
  return process.env.EMAIL_FROM ?? "100p Books <noreply@100pbooks.com>";
}

/** Resend emails.send 에 넘기는 필드 — 워커와 즉시 발송 경로가 같은 모양을 써야 idempotency 가 맞는다. */
export interface EmailJobSendPayload {
  from: string;
  to: string;
  subject: string;
  text: string;
  html?: string;
}

/** email_jobs 행(또는 INSERT 직전 값)으로 발송 payload 를 만든다. */
export function buildEmailJobPayload(
  job: Pick<EmailJob, "to_email" | "to_name" | "subject" | "body_text" | "body_html">,
): EmailJobSendPayload {
  return {
    from: fromAddress(),
    to: job.to_name ? `${job.to_name} <${job.to_email}>` : job.to_email,
    subject: job.subject,
    text: job.body_text,
    ...(job.body_html ? { html: job.body_html } : {}),
  };
}

/**
 * Resend Idempotency-Key — `email-job/<job id>/<payload sha256 앞 16자>` (최대 63자, 문서 한도 256자).
 * 같은 잡·같은 payload 면 어느 경로·몇 번째 시도든 같은 키라 24시간 안의 재발송이 막힌다.
 */
export function emailJobIdempotencyKey(jobId: string, payload: EmailJobSendPayload): string {
  const fingerprint = createHash("sha256")
    .update(
      JSON.stringify([payload.from, payload.to, payload.subject, payload.text, payload.html ?? null]),
    )
    .digest("hex")
    .slice(0, 16);
  return `email-job/${jobId}/${fingerprint}`;
}

const SEND_TIMED_OUT = Symbol("email-send-timeout");

/** promise 를 최대 ms 까지만 기다린다. 넘으면 SEND_TIMED_OUT (원 요청은 취소되지 않는다). */
async function waitAtMost<T>(
  promise: Promise<T>,
  ms: number,
): Promise<T | typeof SEND_TIMED_OUT> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<typeof SEND_TIMED_OUT>((resolve) => {
    timer = setTimeout(() => resolve(SEND_TIMED_OUT), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

async function sendEmail(job: EmailJob, timeoutMs: number): Promise<SendResult> {
  const resendKey = process.env.RESEND_API_KEY;

  if (!resendKey) {
    // 정상 경로에서는 도달하지 않는다 — processEmailQueue 가 진입 시점에 걸러
    // 잡을 pending 그대로 남긴다. 여기까지 왔다면 그 가드를 우회한 직접 호출이므로,
    // 잡을 죽이지 않고 'failed' 로 두어 다음 실행에서 재시도되게 한다.
    console.warn(
      `[email/worker] RESEND_API_KEY 미설정 — job ${job.id} 발송 보류 (template=${job.template})`,
    );
    return {
      kind: "failed",
      error: "RESEND_API_KEY 환경변수가 설정되지 않았습니다.",
      failure: "systemic",
    };
  }

  try {
    const resend = new Resend(resendKey);

    const payload: EmailJobSendPayload = buildEmailJobPayload(job);
    const response = await waitAtMost(
      resend.emails.send(payload, {
        idempotencyKey: emailJobIdempotencyKey(job.id, payload),
      }),
      timeoutMs,
    );

    if (response === SEND_TIMED_OUT) {
      // 요청이 Resend 에 도달했을 수 있다 — 재시도는 같은 idempotency key 라 중복 발송되지 않는다.
      console.error("[email/worker] Resend 응답 대기 시간 초과:", {
        jobId: job.id,
        template: job.template,
        timeoutMs,
      });
      return {
        kind: "failed",
        error: `Resend: 응답 대기 시간 초과 (${timeoutMs}ms)`,
        failure: "systemic",
      };
    }

    const { error } = response;
    if (error) {
      console.error("[email/worker] Resend error:", error, {
        jobId: job.id,
        template: job.template,
      });
      return {
        kind: "failed",
        error: `Resend: ${error.message}`,
        failure: classifyResendError(error),
      };
    }

    return { kind: "sent" };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[email/worker] sendEmail exception:", msg, {
      jobId: job.id,
      template: job.template,
    });
    return { kind: "failed", error: msg, failure: "systemic" };
  }
}

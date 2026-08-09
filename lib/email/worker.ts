import "server-only";

import { Resend } from "resend";

import { createAdminSupabase } from "@/lib/db/admin";
import type { EmailJob } from "@/lib/db/types";

/**
 * 이메일 워커 — Vercel Cron (`/api/cron/process-emails`) 에서 호출.
 *
 * 동작:
 *   1. status='pending' 잡을 batch 만큼 가져옴 (FOR UPDATE 는 supabase-js 미지원 →
 *      낙관적: 가져온 후 update where status='pending' 으로 race 회피).
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
 */

export interface ProcessOptions {
  /** 한 번에 처리할 잡 수. 기본 10. */
  batchSize?: number;
}

export interface ProcessResult {
  processed: number;
  sent: number;
  failed: number;
  skipped: number;
  /**
   * true 면 발송 인프라가 없어 큐를 그대로 두고 아무것도 처리하지 않았다는 뜻.
   * cron 응답에 그대로 실려 나가므로 운영자가 "왜 0건인지" 를 바로 알 수 있다.
   */
  deferred?: boolean;
  /** deferred 일 때 대기 중인 잡 수 — 방치 규모를 드러낸다. */
  queued?: number;
}

const DEFAULT_BATCH = 10;

export async function processEmailQueue(
  opts: ProcessOptions = {},
): Promise<ProcessResult> {
  const batch = opts.batchSize ?? DEFAULT_BATCH;
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

  // 1) 후보 가져오기 — pending + failed (attempt < max_attempts)
  const nowIso = new Date().toISOString();
  const { data: rows, error } = await admin
    .from("email_jobs")
    .select(
      "id, template, to_email, to_name, subject, body_text, body_html, context, status, attempt, max_attempts, last_error, related_type, related_id, scheduled_at, sent_at, created_at, updated_at",
    )
    .in("status", ["pending", "failed"])
    .lte("scheduled_at", nowIso)
    .order("scheduled_at", { ascending: true })
    .limit(batch);

  if (error) {
    console.error("[email/worker] fetch failed:", error.message);
    return { processed: 0, sent: 0, failed: 0, skipped: 0 };
  }

  const candidates = (rows ?? []) as EmailJob[];
  if (candidates.length === 0) {
    return { processed: 0, sent: 0, failed: 0, skipped: 0 };
  }

  let sent = 0;
  let failed = 0;
  let skipped = 0;

  for (const job of candidates) {
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

    // 2) 'sending' 으로 마킹 — 동일 status 일 때만 (race 보호).
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

    // 3) 발송
    const result = await sendEmail(job);

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
      // failed
      await admin
        .from("email_jobs")
        .update({
          status: "failed",
          last_error: result.error,
        })
        .eq("id", job.id);
      failed += 1;
    }
  }

  return {
    processed: candidates.length,
    sent,
    failed,
    skipped,
  };
}

// =====================================================================
// sendEmail — Resend SDK 발송.
// =====================================================================

interface SendResult {
  kind: "sent" | "failed" | "cancelled";
  error?: string;
}

/** 발신자 주소. 환경변수 EMAIL_FROM 미설정이면 기본값 사용. */
function fromAddress(): string {
  return process.env.EMAIL_FROM ?? "100p Books <noreply@100pbooks.com>";
}

async function sendEmail(job: EmailJob): Promise<SendResult> {
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
    };
  }

  try {
    const resend = new Resend(resendKey);

    const payload: Parameters<typeof resend.emails.send>[0] = {
      from: fromAddress(),
      to: job.to_name ? `${job.to_name} <${job.to_email}>` : job.to_email,
      subject: job.subject,
      text: job.body_text,
      ...(job.body_html ? { html: job.body_html } : {}),
    };

    const { error } = await resend.emails.send(payload);

    if (error) {
      console.error("[email/worker] Resend error:", error, {
        jobId: job.id,
        template: job.template,
      });
      return { kind: "failed", error: `Resend: ${error.message}` };
    }

    return { kind: "sent" };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[email/worker] sendEmail exception:", msg, {
      jobId: job.id,
      template: job.template,
    });
    return { kind: "failed", error: msg };
  }
}

import "server-only";

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
 * SMTP 미통합:
 *   - sendEmail() 이 SMTP 미설정을 감지하면 status='cancelled', last_error 명시.
 *   - 운영에서 Resend 등 통합 시 본 함수의 sendEmail 분기만 교체하면 됨.
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
}

const DEFAULT_BATCH = 10;

export async function processEmailQueue(
  opts: ProcessOptions = {},
): Promise<ProcessResult> {
  const batch = opts.batchSize ?? DEFAULT_BATCH;
  const admin = createAdminSupabase();

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
// sendEmail — Stub. SMTP 미설정이면 cancelled 로 마킹.
// =====================================================================

interface SendResult {
  kind: "sent" | "failed" | "cancelled";
  error?: string;
}

async function sendEmail(job: EmailJob): Promise<SendResult> {
  // SMTP / Resend 환경변수 확인
  const smtpHost = process.env.SMTP_HOST;
  const resendKey = process.env.RESEND_API_KEY;

  if (!smtpHost && !resendKey) {
    // 콘솔 로그만 — 운영자가 큐가 쌓이는 것을 보고 SMTP 통합을 진행할 수 있도록.
    console.warn(
      `[email/worker] SMTP not configured — cancelling job ${job.id} (template=${job.template}, to=${job.to_email})`,
    );
    return {
      kind: "cancelled",
      error: "SMTP not configured (no SMTP_HOST/RESEND_API_KEY)",
    };
  }

  // 실제 발송 통합은 Phase 12 — 본 마일스톤은 stub.
  // TODO(phase 12): Resend SDK 또는 nodemailer 또는 supabase auth admin sendEmail 사용.
  //   if (resendKey) {
  //     const { Resend } = await import("resend");
  //     const r = new Resend(resendKey);
  //     await r.emails.send({ from, to, subject, text, html });
  //     return { kind: "sent" };
  //   }
  //   if (smtpHost) {
  //     const transporter = await import("nodemailer").then((m) => m.createTransport(...));
  //     await transporter.sendMail({ ... });
  //     return { kind: "sent" };
  //   }

  return {
    kind: "failed",
    error: "SMTP/Resend integration not yet implemented (Phase 12)",
  };
}

import "server-only";

import { createAdminSupabase } from "@/lib/db/admin";

import {
  renderEmailTemplate,
  type EmailTemplate,
  type TemplateContext,
} from "./templates";
import { EMAIL_SEND_TIMEOUT_MS, sendEmailJob, type EmailJobSendTarget } from "./worker";

/**
 * 이메일 잡 큐 — INSERT + 즉시 발송 시도.
 *
 * 비즈니스 로직 안에서 호출 (결제/주문 전이/탈퇴/가입).
 *
 * 전략:
 *   1. email_jobs 에 INSERT (항상 — 감사 기록 + 재시도 안전망).
 *   2. RESEND_API_KEY 가 있으면 INSERT 직후 Resend 즉시 발송 시도.
 *      워커와 같은 sendEmailJob(lib/email/worker.ts)을 쓴다 — payload·Idempotency-Key
 *      (잡 id + payload 지문)·응답 대기 상한(EMAIL_SEND_TIMEOUT_MS 10s)이 워커와 같다.
 *      성공 → status='sent', sent_at=now
 *      실패·시간 초과 → status 는 'pending' 그대로 → 5분 주기 cron 워커가 재처리.
 *        워커는 즉시 발송과 겹치지 않게 생성 6분(IMMEDIATE_SEND_GRACE_MS) 이 지난 잡만 집으므로
 *        보통 생성 후 6~11분 안에 재시도된다. 즉시 발송이 실제로는 Resend 에 도달했더라도
 *        같은 키라 재시도가 두 번째 메일이 되지 않는다(24시간 이내).
 *   3. 키가 없으면 발송하지 않고 pending 으로 둔다 — 워커도 키가 없으면 큐를 보존(deferred)하고,
 *      키를 등록하면 다음 cron 에서 밀린 잡까지 발송한다.
 *
 * INSERT/send 실패는 throw 하지 않고 로깅만 → 이메일 큐 실패가 정상 응답을 막지 않음.
 */

export interface EnqueueEmailArgs {
  template: EmailTemplate;
  to: { email: string; name?: string };
  context: TemplateContext;
  relatedType?: "order" | "user" | string;
  relatedId?: string;
  scheduledAt?: Date;
}

export interface EnqueueResult {
  ok: boolean;
  jobId: string | null;
  sent: boolean;
  error?: string;
}

export async function enqueueEmail(
  args: EnqueueEmailArgs,
): Promise<EnqueueResult> {
  try {
    if (!args.to.email) {
      return {
        ok: false,
        jobId: null,
        sent: false,
        error: "수신자 이메일이 비어있습니다.",
      };
    }

    const rendered = renderEmailTemplate(args.template, args.context);
    const admin = createAdminSupabase();

    const insert = {
      template: args.template,
      to_email: args.to.email,
      to_name: args.to.name ?? null,
      subject: rendered.subject,
      body_text: rendered.text,
      body_html: rendered.html ?? null,
      context: (args.context as unknown) as Record<string, unknown>,
      status: "pending" as const,
      attempt: 0,
      max_attempts: 3,
      last_error: null,
      related_type: args.relatedType ?? null,
      related_id: args.relatedId ?? null,
      scheduled_at: (args.scheduledAt ?? new Date()).toISOString(),
      sent_at: null,
    };

    const { data, error } = await admin
      .from("email_jobs")
      .insert(insert)
      .select("id")
      .single();

    if (error || !data) {
      const msg = error?.message ?? "이메일 잡 INSERT 실패";
      console.error("[email/queue] enqueue failed:", msg, {
        template: args.template,
        to: args.to.email,
      });
      return { ok: false, jobId: null, sent: false, error: msg };
    }

    const jobId = data.id;

    // 즉시 발송 시도 (RESEND_API_KEY 있을 때만)
    const sent = await trySendImmediate({
      admin,
      job: {
        id: jobId,
        template: insert.template,
        to_email: insert.to_email,
        to_name: insert.to_name,
        subject: insert.subject,
        body_text: insert.body_text,
        body_html: insert.body_html,
      },
    });

    return { ok: true, jobId, sent };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[email/queue] enqueue exception:", msg);
    return { ok: false, jobId: null, sent: false, error: msg };
  }
}

// =====================================================================
// 즉시 발송 — 워커와 같은 sendEmailJob (payload·Idempotency-Key·응답 대기 상한 공유).
// =====================================================================

interface TrySendArgs {
  admin: ReturnType<typeof createAdminSupabase>;
  /** INSERT 한 값 그대로 — 워커가 나중에 읽을 행과 같아야 Idempotency-Key 가 같다. */
  job: EmailJobSendTarget;
}

async function trySendImmediate({ admin, job }: TrySendArgs): Promise<boolean> {
  if (!process.env.RESEND_API_KEY) return false; // 키 없으면 cron 에 위임

  // throw 하지 않는다 — 예외·Resend 오류·시간 초과는 모두 kind 'failed' 로 돌아온다.
  const result = await sendEmailJob(job, EMAIL_SEND_TIMEOUT_MS, "[email/queue] immediate");
  if (result.kind !== "sent") {
    // pending 상태로 남겨 cron 에서 재시도 (같은 Idempotency-Key)
    return false;
  }

  // 발송 성공 → DB 업데이트. 실패하면 pending 으로 남지만 워커 재시도는 같은 키라 재발송되지 않는다.
  const { error } = await admin
    .from("email_jobs")
    .update({
      status: "sent",
      attempt: 1,
      sent_at: new Date().toISOString(),
      last_error: null,
    })
    .eq("id", job.id);
  if (error) {
    console.error("[email/queue] immediate send 성공 후 상태 갱신 실패:", error.message, {
      jobId: job.id,
    });
  }

  return true;
}

import "server-only";

import { Resend } from "resend";

import { createAdminSupabase } from "@/lib/db/admin";

import {
  renderEmailTemplate,
  type EmailTemplate,
  type TemplateContext,
} from "./templates";

/**
 * 이메일 잡 큐 — INSERT + 즉시 발송 시도.
 *
 * 비즈니스 로직 안에서 호출 (결제/주문 전이/탈퇴/가입).
 *
 * 전략:
 *   1. email_jobs 에 INSERT (항상 — 감사 기록 + 재시도 안전망).
 *   2. RESEND_API_KEY 가 있으면 INSERT 직후 Resend 즉시 발송 시도.
 *      성공 → status='sent', sent_at=now
 *      실패 → status 는 'pending' 그대로 → 익일 cron 에서 재처리.
 *   3. Vercel Hobby 플랜에서 cron 이 일 1회라도 운영 이메일은 실시간 발송됨.
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
      jobId,
      admin,
      to: args.to,
      rendered,
    });

    return { ok: true, jobId, sent };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[email/queue] enqueue exception:", msg);
    return { ok: false, jobId: null, sent: false, error: msg };
  }
}

// =====================================================================
// 즉시 발송 — Resend SDK.
// =====================================================================

interface TrySendArgs {
  jobId: string;
  admin: ReturnType<typeof createAdminSupabase>;
  to: { email: string; name?: string };
  rendered: { subject: string; text: string; html?: string };
}

async function trySendImmediate({
  jobId,
  admin,
  to,
  rendered,
}: TrySendArgs): Promise<boolean> {
  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) return false; // 키 없으면 cron 에 위임

  try {
    const resend = new Resend(resendKey);
    const from = process.env.EMAIL_FROM ?? "100p Books <noreply@100pbooks.com>";
    const toAddress = to.name ? `${to.name} <${to.email}>` : to.email;

    const { error } = await resend.emails.send({
      from,
      to: toAddress,
      subject: rendered.subject,
      text: rendered.text,
      ...(rendered.html ? { html: rendered.html } : {}),
    });

    if (error) {
      console.error("[email/queue] immediate send failed:", error.message, {
        jobId,
        to: to.email,
      });
      // pending 상태로 남겨 cron 에서 재시도
      return false;
    }

    // 발송 성공 → DB 업데이트
    await admin
      .from("email_jobs")
      .update({
        status: "sent",
        attempt: 1,
        sent_at: new Date().toISOString(),
        last_error: null,
      })
      .eq("id", jobId);

    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[email/queue] immediate send exception:", msg, { jobId });
    return false;
  }
}

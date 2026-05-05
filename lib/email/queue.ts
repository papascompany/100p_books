import "server-only";

import { createAdminSupabase } from "@/lib/db/admin";

import {
  renderEmailTemplate,
  type EmailTemplate,
  type TemplateContext,
} from "./templates";

/**
 * 이메일 잡 큐 — INSERT 만 담당.
 *
 * 비즈니스 로직 안에서 호출 (결제/주문 전이/탈퇴/가입).
 * INSERT 실패는 throw 하지 않고 로깅만 → 이메일 큐 등록 실패가 정상 응답을 막지 않음
 * (audit logs 와 동일 정책).
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
  error?: string;
}

export async function enqueueEmail(
  args: EnqueueEmailArgs,
): Promise<EnqueueResult> {
  try {
    if (!args.to.email) {
      return { ok: false, jobId: null, error: "수신자 이메일이 비어있습니다." };
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
      return { ok: false, jobId: null, error: msg };
    }

    return { ok: true, jobId: data.id };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[email/queue] enqueue exception:", msg);
    return { ok: false, jobId: null, error: msg };
  }
}

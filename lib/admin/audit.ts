import "server-only";

import { createAdminSupabase } from "@/lib/db/admin";

/**
 * 관리자 감사 로그 헬퍼.
 *
 *   - admin (service_role) 으로 audit_logs INSERT.
 *   - request 가 주어지면 IP / User-Agent 를 헤더에서 추출.
 *   - 로깅 실패가 본 액션을 막지 않도록 throw 하지 않음 (console.warn 만).
 *
 * 사용 패턴:
 * ```ts
 * await logAdminAction({
 *   actor: { id: user.id, email: user.email },
 *   action: "order.transition",
 *   targetType: "order",
 *   targetId: order.id,
 *   details: { from, to, trackingNo },
 *   request: req,
 * });
 * ```
 */

export interface LogAdminActionArgs {
  actor: { id: string; email?: string | null };
  action: string;
  targetType: string;
  targetId?: string;
  details?: Record<string, unknown>;
  request?: Request;
}

export async function logAdminAction(args: LogAdminActionArgs): Promise<void> {
  try {
    const admin = createAdminSupabase();

    let ip: string | null = null;
    let ua: string | null = null;
    if (args.request) {
      const headers = args.request.headers;
      // x-forwarded-for 우선 (Vercel/프록시), 그 다음 x-real-ip.
      const xff = headers.get("x-forwarded-for");
      if (xff) ip = xff.split(",")[0]?.trim() ?? null;
      else ip = headers.get("x-real-ip") ?? null;
      ua = headers.get("user-agent");
    }

    const row: Record<string, unknown> = {
      actor_id: args.actor.id,
      actor_email: args.actor.email ?? null,
      action: args.action,
      target_type: args.targetType,
      target_id: args.targetId ?? null,
      details: args.details ?? {},
      ip_address: ip,
      user_agent: ua,
    };

    const { error } = await (
      admin as unknown as {
        from: (t: string) => {
          insert: (v: Record<string, unknown>) => Promise<{ error: unknown }>;
        };
      }
    )
      .from("audit_logs")
      .insert(row);

    if (error) {
      const msg =
        error && typeof error === "object" && "message" in error
          ? (error as { message: string }).message
          : "unknown";
      console.warn(`[admin/audit] log insert failed: ${msg}`, {
        action: args.action,
        targetType: args.targetType,
      });
    }
  } catch (e) {
    // 어떤 이유든 throw 하지 않음 — 로깅은 best-effort.
    console.warn(
      "[admin/audit] log threw:",
      e instanceof Error ? e.message : String(e),
    );
  }
}

/**
 * 변경 비교용 헬퍼 — 두 객체에서 변경된 키만 추출 (감사 로그 details 축약).
 */
export function diffFields<T extends Record<string, unknown>>(
  before: Partial<T>,
  after: Partial<T>,
): Record<string, { from: unknown; to: unknown }> {
  const out: Record<string, { from: unknown; to: unknown }> = {};
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const k of keys) {
    if (before[k as keyof T] !== after[k as keyof T]) {
      out[k] = {
        from: before[k as keyof T],
        to: after[k as keyof T],
      };
    }
  }
  return out;
}

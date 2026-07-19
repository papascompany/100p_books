import "server-only";

import { createAdminSupabase } from "@/lib/db/admin";

/**
 * 온보딩 퍼널 계측 헬퍼 (S1-2).
 *
 *   - service_role 로 funnel_events INSERT (마이그레이션 0029).
 *   - 계측 실패가 제품 흐름을 절대 막지 않는다 — throw 하지 않음 (console.warn 만).
 *   - signup_completed 는 DB 부분 유니크 인덱스로 중복 차단 (23505 는 정상 무시).
 *
 * 사용 패턴:
 * ```ts
 * await trackFunnelEvent({ event: "project_created", userId, projectId, props: { first: true } });
 * ```
 */

export type FunnelEventName =
  | "signup_completed"
  | "project_created"
  | "book_completed"
  | "order_paid";

interface TrackFunnelInput {
  event: FunnelEventName;
  userId?: string | null;
  projectId?: string | null;
  props?: Record<string, unknown>;
}

export async function trackFunnelEvent(input: TrackFunnelInput): Promise<void> {
  try {
    const admin = createAdminSupabase();

    // funnel_events 는 생성 타입(Database)에 없는 계측 전용 테이블 — audit_logs 와
    // 동일한 캐스트 관례를 따른다 (lib/admin/audit.ts 참조).
    const { error } = await (
      admin as unknown as {
        from: (t: string) => {
          insert: (v: Record<string, unknown>) => Promise<{ error: unknown }>;
        };
      }
    )
      .from("funnel_events")
      .insert({
        event: input.event,
        user_id: input.userId ?? null,
        project_id: input.projectId ?? null,
        props: input.props ?? {},
      });

    if (error) {
      const code =
        error && typeof error === "object" && "code" in error
          ? (error as { code?: string }).code
          : undefined;
      if (code !== "23505") {
        const msg =
          error && typeof error === "object" && "message" in error
            ? (error as { message: string }).message
            : String(error);
        console.warn(`[funnel] ${input.event} 기록 실패:`, msg);
      }
    }
  } catch (e) {
    console.warn(
      `[funnel] ${input.event} 기록 실패:`,
      e instanceof Error ? e.message : String(e),
    );
  }
}

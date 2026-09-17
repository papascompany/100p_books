import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { fail, failFromError, ok } from "@/app/api/_lib/response";
import { createAdminSupabase } from "@/lib/db/admin";
import type { Database } from "@/lib/db/types";
import {
  expirePendingOrders,
  keysetAfterFilter,
  PENDING_ORDER_EXPIRY_BATCH_DEFAULT,
  type PendingExpiryPort,
  type PendingOrderCandidate,
} from "@/lib/orders/pending-expiry";
import { restoreOrderCredits } from "@/lib/orders/refund";
import { probeTossOrder } from "@/lib/orders/toss-order-probe";
import { verifyCronRequest } from "@/lib/security/cron-auth";

export const dynamic = "force-dynamic";
/**
 * ⚠️ 필수 — orphan-photos 선례. 없으면 Next 가 Supabase 조회 응답을 캐시해 낡은 스냅샷으로
 * 상태를 바꿀 수 있다(그 사이 결제된 주문을 취소 후보로 보는 식).
 */
export const fetchCache = "force-no-store";
export const runtime = "nodejs";
export const maxDuration = 60;

/** PostgREST IN 절 URL 길이 제한 회피용. */
const ID_CHUNK = 100;

/**
 * GET /api/cron/expire-pending-orders
 *
 * 결제하지 않은 대기 주문 만료 (DEBT-6) — paymentKey 없는 pending 주문 중 생성 후 24시간이
 * 지나고 **토스 원장에 승인된 결제가 없다고 확인된** 것만 cancelled 로 조건부 전이한다.
 * 규칙·임계 근거는 lib/orders/pending-expiry.ts, 토스 판정은 lib/orders/toss-order-probe.ts.
 *
 *   - 토스에 결제 기록이 있는 pending(`paymentFound`)은 취소하지 않고 console.error 로 남긴다 —
 *     돈은 캡처됐는데 confirm/웹훅 반영이 실패한 주문이라 운영자가 paid 로 복구하거나 환불해야 한다.
 *   - 토스 조회 실패(`probeFailed`)·시간 예산 초과(`probeDeferred`)는 취소하지 않고 다음 실행에서 재시도.
 *   - 후보는 (created_at, id) keyset 페이지로 읽어, 앞자리에 취소되지 않는 주문이 쌓여도 예산 안에서
 *     뒤로 진행한다(`pages`, 끝까지 못 보면 `truncated`).
 *   - 결제 키가 있는 오래된 pending(`staleWithPaymentKey`)은 confirm 이 캡처 전에 키를 바인딩한 뒤
 *     결과가 확정되지 않은 주문 — 캡처됐을 수 있어 자동 만료하지 않고 console.error 로 운영 확인을 요청한다.
 *   - 취소한 주문은 restoreOrderCredits 로 잡힌 크레딧을 되돌린다(`creditRestoreFailed` 는 운영 확인).
 *     메일은 보내지 않는다.
 *
 * 인증: `Authorization: Bearer <CRON_SECRET>` 만 인정 (lib/security/cron-auth.ts).
 *
 * `?dryRun=1` — 상태를 바꾸지 않고 취소 예정 건수·id 만 반환한다(토스 조회는 읽기 전용이라 수행한다 —
 * 결제 기록이 있는 pending 을 켜기 전에 발견할 수 있다). 운영에 처음 붙일 때 이걸로 규모를 먼저 확인한다.
 */
export async function GET(req: Request) {
  try {
    const cronAuth = verifyCronRequest(req);
    if (!cronAuth.ok) {
      return fail(cronAuth.code, cronAuth.message, cronAuth.status);
    }

    const dryRun = new URL(req.url).searchParams.get("dryRun") === "1";
    const start = Date.now();
    const limit = parsePositiveInt(
      process.env.PENDING_ORDER_EXPIRY_BATCH,
      PENDING_ORDER_EXPIRY_BATCH_DEFAULT,
    );

    const result = await expirePendingOrders(supabasePort(createAdminSupabase()), {
      now: new Date(),
      dryRun,
      limit,
    });

    if (result.paymentFound.length > 0) {
      console.error(
        `[cron/expire-pending-orders] 토스에 결제 기록이 있는 pending 주문 ${result.paymentFound.length}건 — 취소하지 않음, 결제 반영 복구 필요:`,
        result.paymentFound.map((p) => `${p.orderId}(${p.tossStatus})`).join(", "),
      );
    }
    if (result.probeFailed.length > 0) {
      console.warn(
        `[cron/expire-pending-orders] 토스 결제 조회 실패 ${result.probeFailed.length}건 — 이번 실행에서 보류:`,
        [...new Set(result.probeFailed.map((p) => p.code))].join(", "),
      );
    }
    if (result.staleWithPaymentKey > 0) {
      console.error(
        `[cron/expire-pending-orders] 결제 승인 결과가 확정되지 않은(결제 키 바인딩) ${result.expiryHours}시간 초과 pending 주문 ${result.staleWithPaymentKey}건 — 캡처됐을 수 있어 자동 만료하지 않음. 토스 결제 조회 후 확정·환불·취소로 정리 필요.`,
      );
    }
    if (result.creditRestoreFailed.length > 0) {
      console.error(
        `[cron/expire-pending-orders] 취소한 주문의 크레딧 복원 실패 ${result.creditRestoreFailed.length}건 — 확인 필요:`,
        result.creditRestoreFailed.join(", "),
      );
    }
    if (!dryRun && result.orderIds.length > 0) {
      console.info(
        `[cron/expire-pending-orders] 결제하지 않은 대기 주문 ${result.orderIds.length}건 취소`,
      );
    }

    return ok({
      dryRun: result.dryRun,
      expiryHours: result.expiryHours,
      cutoff: result.cutoff,
      scanned: result.scanned,
      ...(result.dryRun
        ? { wouldExpire: result.orderIds.length, sample: result.orderIds.slice(0, 10) }
        : { expired: result.orderIds.length }),
      paymentFound: result.paymentFound.length,
      paymentFoundSample: result.paymentFound.slice(0, 10),
      probeFailed: result.probeFailed.length,
      probeDeferred: result.probeDeferred,
      staleWithPaymentKey: result.staleWithPaymentKey,
      creditRestoreFailed: result.creditRestoreFailed.length,
      pages: result.pages,
      truncated: result.truncated,
      durationMs: Date.now() - start,
    });
  } catch (err) {
    return failFromError(err);
  }
}

function dbError(code: string, message: string): Error {
  return Object.assign(new Error(message), { status: 500, code });
}

function supabasePort(admin: SupabaseClient<Database>): PendingExpiryPort {
  return {
    async listExpirable({ before, limit, after }) {
      const base = admin
        .from("orders")
        .select(
          "id, status, toss_payment_key, toss_order_id, created_at, user_id, points_used, discount_code_id",
        )
        .eq("status", "pending")
        .is("toss_payment_key", null)
        .lt("created_at", before);
      const { data, error } = await (after ? base.or(keysetAfterFilter(after)) : base)
        .order("created_at", { ascending: true })
        .order("id", { ascending: true })
        .limit(limit);
      if (error) throw dbError("ORDERS_QUERY_FAILED", error.message);
      return (data ?? []) as PendingOrderCandidate[];
    },

    async countStaleWithPaymentKey({ before }) {
      const { count, error } = await admin
        .from("orders")
        .select("id", { count: "exact", head: true })
        .eq("status", "pending")
        .not("toss_payment_key", "is", null)
        .lt("created_at", before);
      if (error) throw dbError("ORDERS_QUERY_FAILED", error.message);
      return count ?? 0;
    },

    probePayment(candidate) {
      return probeTossOrder(candidate.toss_order_id);
    },

    async cancelExpired({ ids, before }) {
      const changed: string[] = [];
      for (let i = 0; i < ids.length; i += ID_CHUNK) {
        const slice = ids.slice(i, i + ID_CHUNK);
        const { data, error } = await admin
          .from("orders")
          .update({ status: "cancelled" })
          .in("id", slice)
          .eq("status", "pending")
          .is("toss_payment_key", null)
          .lt("created_at", before)
          .select("id");
        if (error) {
          // 앞 청크는 이미 반영됐다 — 조건부 UPDATE 라 다음 실행에서 남은 것만 다시 처리된다.
          console.error(
            `[cron/expire-pending-orders] 취소 UPDATE 실패 (반영 ${changed.length}건 이후):`,
            error.message,
          );
          throw dbError("ORDERS_UPDATE_FAILED", error.message);
        }
        for (const row of data ?? []) changed.push(row.id);
      }
      return changed;
    },

    async restoreCredits(candidates) {
      const failedIds: string[] = [];
      for (const c of candidates) {
        const r = await restoreOrderCredits(admin, c);
        if (!r.ok) failedIds.push(c.id);
      }
      return { failedIds };
    },
  };
}

function parsePositiveInt(v: string | undefined, fallback: number): number {
  const n = v ? Number.parseInt(v, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

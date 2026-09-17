/**
 * 결제 대기(pending) 주문 만료 규칙 (DEBT-6) — 순수 함수 + 포트 주입 오케스트레이터.
 *
 * 배경: 주문서에서 '결제하기'를 누르면 orders 가 pending 으로 먼저 생긴다. 결제창을 닫거나
 * 인증에 실패하면 그 행이 영구히 남아 탈퇴(BLOCKING_STATUSES)·주문 내역을 어지럽힌다.
 * 결제 승인 전에 이탈한 주문은 토스 웹훅으로도 정리되지 않는다.
 *
 * 만료 후보 = status='pending' AND toss_payment_key IS NULL AND created_at < now - 24h.
 * 후보라도 **토스 원장에 승인된 결제가 없다는 것이 확인된 주문만** 취소한다
 * (lib/orders/toss-order-probe.ts). DB 의 "pending + 키 없음" 에는 결제하지 않은 주문뿐 아니라
 * "토스 캡처는 됐는데 confirm 클레임 UPDATE 가 실패해 반영되지 않은 주문" 도 섞여 있기 때문이다
 * (결제 키는 paid 전이와 같은 UPDATE 에서만 기록된다). 그런 주문을 취소하면 이후 웹훅 DONE 이
 * canTransition(cancelled→paid) 에 막혀 영구히 복구되지 않는다.
 *   - 토스에 결제 기록 있음 → 취소하지 않고 paymentFound 로 보고(운영 복구 대상, 라우트가 console.error).
 *   - 토스 조회 실패       → 취소하지 않고 probeFailed 로 집계, 다음 실행에서 재시도(fail-closed).
 *   - 시간 예산 초과        → 조회하지 않은 후보는 probeDeferred 로 남기고 truncated=true.
 *
 * 임계 24시간의 근거 (토스 API 레퍼런스, 2026-09-17 확인):
 *   - 결제 인증 후 10분 안에 승인 API 를 호출하지 않으면 그 결제는 만료되고, 결제 유효시간 30분이
 *     지나면 거래가 취소(EXPIRED)된다. 즉 생성 후 수십 분이 지난 미승인 주문은 새로 승인될 수 없다.
 *   - 24시간은 그 유효시간을 넉넉히 덮고, 토스 웹훅·confirm 재시도가 반영될 시간을 준다.
 *     사용자가 직접 취소(POST /api/orders/[id]/cancel)하면 즉시 정리되므로 길어도 손해가 없다.
 *   - 운영 중 바꾸려면 코드 리뷰를 거치게 env 로 열지 않는다(마이페이지 안내 문구와 일치 유지).
 *
 * toss_payment_key 가 있는 오래된 pending(staleWithPaymentKey)은 현재 결제 흐름에서는 생기지 않는
 * 데이터 이상이다. 손대지 않고 건수만 보고해 운영자가 보게 한다.
 */

import type { OrderStatus } from "@/lib/db/types";

import { hasPaymentKey } from "./state";
import type { TossOrderProbe } from "./toss-order-probe";

/** paymentKey 없는 pending 주문을 자동 취소하기까지의 시간. */
export const PENDING_ORDER_EXPIRY_HOURS = 24;

/**
 * 한 번 실행에서 볼 최대 후보 수 기본값. 후보마다 토스 조회가 1회 붙으므로 작게 둔다
 * (동시 PENDING_ORDER_PROBE_CONCURRENCY 건, 건당 timeout 5초, 예산 PENDING_ORDER_PROBE_BUDGET_MS).
 */
export const PENDING_ORDER_EXPIRY_BATCH_DEFAULT = 50;

/** 토스 조회 동시 실행 수 — 토스 API 에 순간 부하를 주지 않도록 보수적으로. */
export const PENDING_ORDER_PROBE_CONCURRENCY = 4;

/**
 * 토스 조회에 쓸 시간 예산(ms). 라우트 maxDuration 60초에서 DB 조회·UPDATE 와 진행 중인 조회의
 * timeout(5초)을 빼고 남는 값. 예산이 지나면 새 조회를 시작하지 않는다.
 */
export const PENDING_ORDER_PROBE_BUDGET_MS = 35_000;

/** 이 시각보다 **먼저** 생성된 주문이 만료 대상이다. */
export function pendingExpiryCutoff(
  now: Date,
  hours: number = PENDING_ORDER_EXPIRY_HOURS,
): Date {
  return new Date(now.getTime() - hours * 3_600_000);
}

export interface PendingOrderCandidate {
  id: string;
  status: OrderStatus;
  toss_payment_key: string | null;
  toss_order_id: string | null;
  created_at: string;
}

export interface PendingExpiryPlan {
  /** 토스 확인을 거쳐 취소할 후보 id (조회 순서 유지). */
  expireIds: string[];
  /** 결제 키가 있어 건너뛴 건수 — 데이터 이상. */
  skippedWithPaymentKey: number;
  /** 아직 임계 전이거나 created_at 을 해석할 수 없어 건너뛴 건수. */
  skippedNotExpired: number;
  /** pending 이 아니어서 건너뛴 건수(조회와 판정 사이에 상태가 바뀐 경우). */
  skippedNotPending: number;
}

/**
 * 조회된 후보를 다시 한 번 규칙으로 거른다.
 * DB 쿼리 필터가 잘못 바뀌어도 결제 키가 있거나 최근 생성된 주문을 취소하지 않게 하는 이중 방어다.
 */
export function planPendingExpiry(
  rows: readonly PendingOrderCandidate[],
  now: Date,
  hours: number = PENDING_ORDER_EXPIRY_HOURS,
): PendingExpiryPlan {
  const cutoffMs = pendingExpiryCutoff(now, hours).getTime();
  const plan: PendingExpiryPlan = {
    expireIds: [],
    skippedWithPaymentKey: 0,
    skippedNotExpired: 0,
    skippedNotPending: 0,
  };
  for (const row of rows) {
    if (row.status !== "pending") {
      plan.skippedNotPending += 1;
      continue;
    }
    if (hasPaymentKey(row.toss_payment_key)) {
      plan.skippedWithPaymentKey += 1;
      continue;
    }
    const created = Date.parse(row.created_at);
    // 해석 불가(NaN)나 경계값(=cutoff)은 취소하지 않는다 — 애매하면 다음 실행으로 미룬다.
    if (!Number.isFinite(created) || created >= cutoffMs) {
      plan.skippedNotExpired += 1;
      continue;
    }
    plan.expireIds.push(row.id);
  }
  return plan;
}

export interface PaymentFoundOrder {
  orderId: string;
  tossStatus: string;
}

export interface ProbeOutcome {
  /** 토스에 승인된 결제가 없다고 확인된 id — 취소 가능. */
  noPaymentIds: string[];
  /** 토스에 결제 기록이 있는 pending 주문 — 절대 취소하지 않는다. */
  paymentFound: PaymentFoundOrder[];
  /** 조회 실패(timeout·5xx·키 미설정·probe throw) id 와 코드. */
  probeFailed: Array<{ orderId: string; code: string }>;
  /** 시간 예산이 지나 조회하지 않은 후보 수. */
  deferred: number;
}

/**
 * 후보마다 토스 조회를 돌린다(동시성 제한 + 시간 예산). 결과 순서는 후보 순서를 따른다.
 * probe 가 throw 해도 unavailable 로 취급한다 — 어떤 실패도 "취소 가능" 으로 새지 않게.
 */
export async function probeCandidates(
  candidates: readonly PendingOrderCandidate[],
  probe: (candidate: PendingOrderCandidate) => Promise<TossOrderProbe>,
  opts: { concurrency: number; deadlineMs: number; clock: () => number },
): Promise<ProbeOutcome> {
  const results: Array<TossOrderProbe | undefined> = new Array(candidates.length);
  let next = 0;

  async function worker(): Promise<void> {
    for (;;) {
      const i = next;
      if (i >= candidates.length) return;
      // 예산이 지나면 이 워커는 멈춘다 — 남은 후보는 undefined(=deferred)로 남는다.
      if (opts.clock() >= opts.deadlineMs) return;
      next += 1;
      const candidate = candidates[i];
      if (!candidate) return;
      try {
        results[i] = await probe(candidate);
      } catch (e) {
        results[i] = {
          kind: "unavailable",
          code: "PROBE_THREW",
          message: e instanceof Error ? e.message : String(e),
        };
      }
    }
  }

  const workers = Math.max(1, Math.min(opts.concurrency, candidates.length));
  await Promise.all(Array.from({ length: workers }, () => worker()));

  const outcome: ProbeOutcome = { noPaymentIds: [], paymentFound: [], probeFailed: [], deferred: 0 };
  candidates.forEach((candidate, i) => {
    const r = results[i];
    if (r === undefined) outcome.deferred += 1;
    else if (r.kind === "no_payment") outcome.noPaymentIds.push(candidate.id);
    else if (r.kind === "payment_found") {
      outcome.paymentFound.push({ orderId: candidate.id, tossStatus: r.tossStatus });
    } else outcome.probeFailed.push({ orderId: candidate.id, code: r.code });
  });
  return outcome;
}

export interface PendingExpiryPort {
  /**
   * status='pending' AND toss_payment_key IS NULL AND created_at < before,
   * 오래된 순 limit 건.
   */
  listExpirable(args: { before: string; limit: number }): Promise<PendingOrderCandidate[]>;
  /** status='pending' AND toss_payment_key IS NOT NULL AND created_at < before 건수. */
  countStaleWithPaymentKey(args: { before: string }): Promise<number>;
  /** 토스 원장 조회 (lib/orders/toss-order-probe.ts probeTossOrder). */
  probePayment(candidate: PendingOrderCandidate): Promise<TossOrderProbe>;
  /**
   * 조건부 UPDATE → cancelled. WHERE 에 id 목록과 함께 status='pending' ·
   * toss_payment_key IS NULL · created_at < before 를 **다시** 건다 — 조회 뒤 결제가
   * 반영된 주문을 덮지 않게. 실제로 바뀐 id 를 돌려준다.
   */
  cancelExpired(args: { ids: string[]; before: string }): Promise<string[]>;
}

export interface PendingExpiryResult {
  dryRun: boolean;
  expiryHours: number;
  cutoff: string;
  scanned: number;
  /** dryRun 이면 취소 예정, 아니면 실제로 취소한 주문 id. */
  orderIds: string[];
  /** 토스에 결제 기록이 있어 취소하지 않은 pending 주문 — 운영 복구 대상. */
  paymentFound: PaymentFoundOrder[];
  /** 토스 조회 실패로 이번 실행에서 보류한 주문. */
  probeFailed: Array<{ orderId: string; code: string }>;
  /** 시간 예산 초과로 조회하지 않은 후보 수. */
  probeDeferred: number;
  /** 결제 키가 있는 오래된 pending 건수 — 현재 흐름에서는 생기지 않는 데이터 이상. */
  staleWithPaymentKey: number;
  /** 조회가 limit 에 걸렸거나 예산 초과로 남은 후보가 있다 — 다음 실행에서 이어서 처리된다. */
  truncated: boolean;
}

export async function expirePendingOrders(
  port: PendingExpiryPort,
  opts: {
    now: Date;
    dryRun: boolean;
    limit?: number;
    concurrency?: number;
    probeBudgetMs?: number;
    /** 시간 예산 계산용 시계(테스트 주입). 기본 Date.now. */
    clock?: () => number;
  },
): Promise<PendingExpiryResult> {
  const limit = opts.limit ?? PENDING_ORDER_EXPIRY_BATCH_DEFAULT;
  const clock = opts.clock ?? Date.now;
  const cutoff = pendingExpiryCutoff(opts.now).toISOString();

  const rows = await port.listExpirable({ before: cutoff, limit });
  const staleWithPaymentKey = await port.countStaleWithPaymentKey({ before: cutoff });
  const plan = planPendingExpiry(rows, opts.now);

  const byId = new Map(rows.map((r) => [r.id, r] as const));
  const candidates = plan.expireIds
    .map((id) => byId.get(id))
    .filter((r): r is PendingOrderCandidate => r !== undefined);

  const probed = await probeCandidates(candidates, (c) => port.probePayment(c), {
    concurrency: opts.concurrency ?? PENDING_ORDER_PROBE_CONCURRENCY,
    deadlineMs: clock() + (opts.probeBudgetMs ?? PENDING_ORDER_PROBE_BUDGET_MS),
    clock,
  });

  const base = {
    expiryHours: PENDING_ORDER_EXPIRY_HOURS,
    cutoff,
    scanned: rows.length,
    paymentFound: probed.paymentFound,
    probeFailed: probed.probeFailed,
    probeDeferred: probed.deferred,
    staleWithPaymentKey,
    truncated: rows.length >= limit || probed.deferred > 0,
  };

  if (opts.dryRun) {
    return { ...base, dryRun: true, orderIds: probed.noPaymentIds };
  }
  if (probed.noPaymentIds.length === 0) {
    return { ...base, dryRun: false, orderIds: [] };
  }

  const changed = await port.cancelExpired({ ids: probed.noPaymentIds, before: cutoff });
  return { ...base, dryRun: false, orderIds: changed };
}

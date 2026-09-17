/**
 * 결제 대기(pending) 주문 만료 규칙 (DEBT-6) — 순수 함수 + 포트 주입 오케스트레이터.
 *
 * 배경: 주문서에서 '결제하기'를 누르면 orders 가 pending 으로 먼저 생긴다. 결제창을 닫거나
 * 인증에 실패하면 그 행이 영구히 남아 탈퇴(BLOCKING_STATUSES)·주문 내역을 어지럽힌다.
 * 결제 승인 전에 이탈한 주문은 토스 웹훅으로도 정리되지 않는다.
 *
 * 대기 주문 정책(결제·주문 샤드 공통):
 *   결제창 이탈·결제 실패 pending 은 즉시 취소하지 않는다. 같은 포토북에서 다시 결제하면 orders/create 가
 *   그 행을 재사용하고(토스 주문번호·created_at 갱신), 사용자가 원하면 마이페이지·결제 실패 화면에서 직접
 *   취소한다. 끝내 결제하지 않은 주문만 이 cron 이 24시간 뒤 정리한다 — 실패마다 cancelled 가 쌓여
 *   포토북 삭제가 막히는(HAS_ORDERS) 것을 피한다.
 *
 * 만료 후보 = status='pending' AND toss_payment_key IS NULL AND created_at < now - 24h.
 * 결제 confirm 은 캡처 **전에** 키를 바인딩하므로(0033) 키 없는 pending 은 원칙적으로 미결제다. 그래도
 * 바인딩 도입 이전의 주문·해제 경합에 대비해 **토스 원장에 승인된 결제가 없다는 것이 확인된 주문만**
 * 취소한다(lib/orders/toss-order-probe.ts). 캡처된 주문을 취소하면 이후 웹훅 DONE 이
 * canTransition(cancelled→paid) 에 막혀 확정되지 않는다.
 *   - 토스에 결제 기록 있음 → 취소하지 않고 paymentFound 로 보고(운영 복구 대상, 라우트가 console.error).
 *   - 토스 조회 실패       → 취소하지 않고 probeFailed 로 집계, 다음 실행에서 재시도(fail-closed).
 *   - 시간 예산 초과        → 조회하지 않은 후보는 probeDeferred 로 남기고 truncated=true.
 *   - 취소한 주문은 restoreOrderCredits 로 잡힌 크레딧을 되돌린다(잡힌 것만, 멱등).
 *
 * head-of-line 방지: 후보를 오래된 순 keyset 페이지((created_at, id) 커서)로 읽고, 시간 예산 안에서
 * 다음 페이지로 넘어간다. 결제 기록이 있거나(paymentFound) 조회가 계속 실패하는 주문은 취소되지 않아
 * 매 실행 앞자리에 남지만, 커서가 그 뒤로 진행하므로 뒤의 만료 대상이 영원히 밀리지 않는다.
 *
 * 임계 24시간의 근거 (토스 API 레퍼런스, 2026-09-17 확인):
 *   - 결제 인증 후 10분 안에 승인 API 를 호출하지 않으면 그 결제는 만료되고, 결제 유효시간 30분이
 *     지나면 거래가 취소(EXPIRED)된다. 즉 생성 후 수십 분이 지난 미승인 주문은 새로 승인될 수 없다.
 *   - 24시간은 그 유효시간을 넉넉히 덮고, 토스 웹훅·confirm 재시도가 반영될 시간을 준다.
 *     사용자가 직접 취소(POST /api/orders/[id]/cancel)하면 즉시 정리되므로 길어도 손해가 없다.
 *   - 운영 중 바꾸려면 코드 리뷰를 거치게 env 로 열지 않는다(마이페이지 안내 문구와 일치 유지).
 *
 * toss_payment_key 가 있는 오래된 pending(staleWithPaymentKey)은 "결제 승인 결과가 확정되지 않은"
 * 주문이다 — 캡처 결과 불명 뒤 새로고침·웹훅이 오지 않았거나, 캡처됐는데 확정 반영이 실패했을 수 있다.
 * 돈이 캡처됐을 수 있으므로 **자동 만료하지 않는다**. 건수만 보고해 운영자가 토스 조회로 정리하게 한다
 * (관리자 주문 취소는 토스 확인 뒤에만 허용 — api/admin/orders/[id]/transition).
 */

import type { OrderStatus } from "@/lib/db/types";

import { hasPaymentKey } from "./state";
import type { TossOrderProbe } from "./toss-order-probe";

/** paymentKey 없는 pending 주문을 자동 취소하기까지의 시간. */
export const PENDING_ORDER_EXPIRY_HOURS = 24;

/**
 * 한 페이지에서 읽을 후보 수 기본값. 후보마다 토스 조회가 1회 붙으므로 작게 둔다
 * (동시 PENDING_ORDER_PROBE_CONCURRENCY 건, 건당 timeout 5초, 예산 PENDING_ORDER_PROBE_BUDGET_MS).
 */
export const PENDING_ORDER_EXPIRY_BATCH_DEFAULT = 50;

/** 한 번 실행에서 읽을 최대 페이지 수 — 시간 예산과 별개로 DB 조회 횟수를 묶는다. */
export const PENDING_ORDER_EXPIRY_MAX_PAGES = 20;

/** 토스 조회 동시 실행 수 — 토스 API 에 순간 부하를 주지 않도록 보수적으로. */
export const PENDING_ORDER_PROBE_CONCURRENCY = 4;

/**
 * 토스 조회에 쓸 시간 예산(ms, 실행 전체에 하나). 라우트 maxDuration 60초에서 DB 조회·UPDATE·크레딧 복원과
 * 진행 중인 조회의 timeout(5초)을 빼고 남는 값. 예산이 지나면 새 조회도, 다음 페이지 조회도 시작하지 않는다.
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
  user_id: string;
  points_used: number;
  discount_code_id: string | null;
}

/** keyset 커서 — (created_at, id) 사전순으로 이 행 **다음**부터 읽는다. */
export interface PendingExpiryCursor {
  createdAt: string;
  id: string;
}

const CURSOR_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * PostgREST `or` 필터 — (created_at > c) OR (created_at = c AND id > i).
 * 값은 DB 에서 읽은 것이지만 필터 문법에 섞이므로 형식을 검증하고 큰따옴표로 감싼다
 * (타임스탬프의 `:`·`+` 등 예약 문자). 형식이 이상하면 throw — 커서 없이 전체를 다시 읽지 않게.
 */
export function keysetAfterFilter(cursor: PendingExpiryCursor): string {
  if (!CURSOR_ID_RE.test(cursor.id)) {
    throw new Error(`pending-expiry 커서 id 형식 오류: ${cursor.id}`);
  }
  if (!Number.isFinite(Date.parse(cursor.createdAt)) || /["\\,()]/.test(cursor.createdAt)) {
    throw new Error(`pending-expiry 커서 created_at 형식 오류: ${cursor.createdAt}`);
  }
  const c = `"${cursor.createdAt}"`;
  return `created_at.gt.${c},and(created_at.eq.${c},id.gt.${cursor.id})`;
}

/**
 * 취소한 주문에 되돌릴 크레딧이 있을 수 있는가. 선점(reserve_order_credits)은 points_used 만큼의
 * 포인트와 discount_code_id 의 사용 기록만 잡으므로, 둘 다 없으면 복원 RPC 를 부르지 않는다.
 */
export function mayHoldCredits(c: Pick<PendingOrderCandidate, "points_used" | "discount_code_id">): boolean {
  return c.points_used > 0 || c.discount_code_id !== null;
}

export interface PendingExpiryPlan {
  /** 토스 확인을 거쳐 취소할 후보 id (조회 순서 유지). */
  expireIds: string[];
  /** 결제 키가 있어 건너뛴 건수 — 승인 결과 미확정이라 자동 만료하지 않음(조회 필터가 이미 거르는 이중 방어). */
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
   * status='pending' AND toss_payment_key IS NULL AND created_at < before
   * AND (after 가 있으면 (created_at, id) > after), (created_at, id) 오름차순 limit 건.
   */
  listExpirable(args: {
    before: string;
    limit: number;
    after: PendingExpiryCursor | null;
  }): Promise<PendingOrderCandidate[]>;
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
  /**
   * 취소된 주문의 크레딧 복원(restoreOrderCredits). throw 하지 않는다 — 복원하지 못한 id 를 돌려준다.
   */
  restoreCredits(candidates: PendingOrderCandidate[]): Promise<{ failedIds: string[] }>;
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
  /** 결제 키가 있는 오래된 pending 건수 — 승인 결과 미확정, 자동 만료하지 않음(운영 확인). */
  staleWithPaymentKey: number;
  /** 취소했지만 크레딧 복원에 실패한 주문 id — 운영 확인 대상. */
  creditRestoreFailed: string[];
  /** 읽은 페이지 수. */
  pages: number;
  /** 예산·페이지 상한으로 끝까지 보지 못했다 — 다음 실행에서 처음부터 다시 훑는다. */
  truncated: boolean;
}

export async function expirePendingOrders(
  port: PendingExpiryPort,
  opts: {
    now: Date;
    dryRun: boolean;
    /** 페이지 크기. */
    limit?: number;
    maxPages?: number;
    concurrency?: number;
    probeBudgetMs?: number;
    /** 시간 예산 계산용 시계(테스트 주입). 기본 Date.now. */
    clock?: () => number;
  },
): Promise<PendingExpiryResult> {
  const limit = opts.limit ?? PENDING_ORDER_EXPIRY_BATCH_DEFAULT;
  const maxPages = opts.maxPages ?? PENDING_ORDER_EXPIRY_MAX_PAGES;
  const clock = opts.clock ?? Date.now;
  const cutoff = pendingExpiryCutoff(opts.now).toISOString();
  // 예산은 실행 전체에 하나 — 페이지를 넘겨도 늘어나지 않는다.
  const deadlineMs = clock() + (opts.probeBudgetMs ?? PENDING_ORDER_PROBE_BUDGET_MS);

  const staleWithPaymentKey = await port.countStaleWithPaymentKey({ before: cutoff });

  const result: PendingExpiryResult = {
    dryRun: opts.dryRun,
    expiryHours: PENDING_ORDER_EXPIRY_HOURS,
    cutoff,
    scanned: 0,
    orderIds: [],
    paymentFound: [],
    probeFailed: [],
    probeDeferred: 0,
    staleWithPaymentKey,
    creditRestoreFailed: [],
    pages: 0,
    truncated: false,
  };

  let after: PendingExpiryCursor | null = null;
  for (;;) {
    const rows = await port.listExpirable({ before: cutoff, limit, after });
    result.pages += 1;
    result.scanned += rows.length;

    const plan = planPendingExpiry(rows, opts.now);
    const byId = new Map(rows.map((r) => [r.id, r] as const));
    const candidates = plan.expireIds
      .map((id) => byId.get(id))
      .filter((r): r is PendingOrderCandidate => r !== undefined);

    const probed = await probeCandidates(candidates, (c) => port.probePayment(c), {
      concurrency: opts.concurrency ?? PENDING_ORDER_PROBE_CONCURRENCY,
      deadlineMs,
      clock,
    });
    result.paymentFound.push(...probed.paymentFound);
    result.probeFailed.push(...probed.probeFailed);
    result.probeDeferred += probed.deferred;

    if (opts.dryRun) {
      result.orderIds.push(...probed.noPaymentIds);
    } else if (probed.noPaymentIds.length > 0) {
      const changed = await port.cancelExpired({ ids: probed.noPaymentIds, before: cutoff });
      result.orderIds.push(...changed);
      const toRestore = changed
        .map((id) => byId.get(id))
        .filter((r): r is PendingOrderCandidate => r !== undefined && mayHoldCredits(r));
      if (toRestore.length > 0) {
        const { failedIds } = await port.restoreCredits(toRestore);
        result.creditRestoreFailed.push(...failedIds);
      }
    }

    // 예산이 지나 조회하지 못한 후보가 있으면 여기서 멈춘다(다음 실행에서 다시 본다).
    if (probed.deferred > 0) {
      result.truncated = true;
      break;
    }
    const last = rows[rows.length - 1];
    if (rows.length < limit || !last) break; // 끝까지 봤다
    if (clock() >= deadlineMs || result.pages >= maxPages) {
      result.truncated = true;
      break;
    }
    after = { createdAt: last.created_at, id: last.id };
  }

  return result;
}

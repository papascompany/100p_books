import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { waitUntil } from "@vercel/functions";

import { trackFunnelEvent } from "@/lib/analytics/funnel";
import type { Database, OrderStatus } from "@/lib/db/types";
import type { EmailTemplate, TemplateContext } from "@/lib/email/templates";
import { isMissingDbObjectError, sumHeldOrderPoints } from "@/lib/orders/refund";
import { enqueuePdfJob, runPdfJob } from "@/lib/pdf/job-runner";
import { REFERRAL_REWARD } from "@/lib/referrals/code";
import { storigeOrderPatch } from "@/lib/storige/order-fields";

/**
 * 결제 확정 후 부수효과 — confirm·webhook·재시도가 모두 이 함수 하나를 부른다 (DEBT-1, SEC-8).
 *
 *   1. 사용 포인트 차감 확정   — 원장(ref=orders/주문)에 이미 잡혀 있으면 건너뜀
 *   2. 할인 사용 기록·카운트   — discount_uses.order_id 가 있으면 건너뜀
 *   3. projects.status='ordered'
 *   4. 친구 추천 보상         — award_referral_reward_v2 자체가 1회성
 *   5. order_paid 퍼널        — 주문당 1건(0033 부분 유니크 + 사전 조회)
 *   6. PDF 빌드 잡            — pdf_build_jobs.order_id 가 있으면 건너뜀, 새 잡만 waitUntil 실행
 *   7. 주문 확인 메일         — email_jobs(order.paid, related_id=주문) 가 있으면 건너뜀
 *
 * 단일 실행(동시에 두 곳에서 돌지 않게):
 *   - 0033 적용: orders.finalize_started_at 리스(CAS) + finalized_at 완료 마커.
 *   - 미적용   : 클레임 승자는 바로 실행, 복구 호출은 paid_at 이 리스 시간보다 오래됐을 때만.
 *   어느 쪽이든 효과별 마커로 한 번 더 걸러 이미 실행된 효과는 재실행하지 않는다.
 *
 * 절대 throw 하지 않는다 — 결제는 이미 확정됐으므로 응답을 막지 않고 결과만 돌려준다.
 */

type Admin = SupabaseClient<Database>;

/** 결제가 확정된(캡처된) 상태 — finalize 대상. */
export const PAID_LIKE_STATUSES: readonly OrderStatus[] = [
  "paid",
  "in_production",
  "shipped",
  "delivered",
];

export function isPaidLikeStatus(s: OrderStatus): boolean {
  return PAID_LIKE_STATUSES.includes(s);
}

/** finalize 리스 — 동기 구간(조회·RPC·잡 등록·메일 1통)을 넉넉히 덮는 시간. */
export const FINALIZE_LEASE_MS = 2 * 60 * 1000;

/**
 * 자동 복구(클레임 승자가 아닌 호출) 허용 기간. 토스 웹훅 재전송(최대 7회, 누적 약 23h 이후
 * 마지막 재시도)을 덮으면서, 오래된 주문에 뒤늦게 포인트를 차감하는 일은 막는다.
 */
export const FINALIZE_RECOVERY_MAX_AGE_MS = 72 * 60 * 60 * 1000;

export type FinalizeTrigger = "confirm" | "confirm_retry" | "webhook";

/**
 * 주문 확인 메일 발송 함수 — 라우트가 `enqueueEmail` 을 넘긴다.
 *
 * 이 모듈이 lib/email/queue 를 직접 import 하지 않는 이유: enqueueEmail 의 즉시 발송은
 * 호출 **라우트**의 maxDuration 안에서 끝나야 하고, lib/email/worker.test.ts 가
 * "enqueueEmail 을 import 하는 파일 = maxDuration 이 IMMEDIATE_SEND_GRACE_MS 보다 짧은 라우트"
 * 를 정적으로 검사한다. 라우트가 주입하면 그 검사가 실제 호출 라우트를 계속 덮는다.
 */
export type PaidOrderEmailSender = (args: {
  template: EmailTemplate;
  to: { email: string; name?: string };
  context: TemplateContext;
  relatedType?: string;
  relatedId?: string;
}) => Promise<{ ok: boolean; error?: string }>;

export interface FinalizePaidOrderOptions {
  /** 이 호출이 pending→paid 조건부 클레임의 승자인가. */
  claimed: boolean;
  trigger: FinalizeTrigger;
  /** 주문 확인 메일 enqueue (라우트의 enqueueEmail). */
  sendEmail: PaidOrderEmailSender;
  /** 테스트용 시계. */
  now?: () => Date;
}

export type FinalizeSkipReason =
  | "not_found"
  | "not_paid"
  | "already_finalized"
  | "in_progress"
  | "too_old"
  | "load_failed";

export interface FinalizePaidOrderResult {
  /** finalized: 모든 효과 완료 · incomplete: 일시 실패가 남음(다음 트리거에서 재시도) · skipped */
  outcome: "finalized" | "incomplete" | "skipped";
  skipReason?: FinalizeSkipReason;
  /** column: 0033 리스 컬럼 사용 · legacy: 미적용 폴백. */
  leaseMode: "column" | "legacy";
  /** 이번 호출이 새로 등록한 PDF 잡. */
  pdfJobId: string | null;
  /** PDF 잡 등록 실패 안내(관리자 재처리 대상). */
  pdfError: string | null;
  /** 결제는 확정됐지만 되돌릴 수 없는 이상 — 관리자 확인 필요(포인트 부족 등). */
  issues: string[];
  /** 일시 실패 — 다음 finalize 호출에서 다시 시도된다. */
  retryable: string[];
}

interface FinalizeOrderRow {
  id: string;
  user_id: string;
  project_id: string;
  status: OrderStatus;
  qty: number;
  amount: number;
  address: unknown;
  toss_order_id: string | null;
  points_used: number;
  discount_code_id: string | null;
  paid_at: string | null;
  finalized_at?: string | null;
  finalize_started_at?: string | null;
}

const BASE_COLUMNS =
  "id, user_id, project_id, status, qty, amount, address, toss_order_id, points_used, discount_code_id, paid_at";
const LEASE_COLUMNS = `${BASE_COLUMNS}, finalized_at, finalize_started_at`;

/** 타입 정의에 없는 테이블(pdf_build_jobs·funnel_events) 조회용 느슨한 빌더. */
type LooseSelect = {
  from: (t: string) => {
    select: (cols: string) => {
      eq: (k: string, v: string) => LooseFilter;
    };
  };
};
type LooseFilter = {
  eq: (k: string, v: string) => LooseFilter;
  limit: (n: number) => PromiseLike<{
    data: Array<{ id: string }> | null;
    error: { code?: string; message: string } | null;
  }>;
};

function msg(e: unknown): string {
  if (e && typeof e === "object" && "message" in e) {
    return String((e as { message: unknown }).message);
  }
  return String(e);
}

async function loadOrder(
  admin: Admin,
  orderId: string,
): Promise<{ row: FinalizeOrderRow | null; leaseMode: "column" | "legacy"; error?: string }> {
  const withLease = await admin
    .from("orders")
    .select(LEASE_COLUMNS)
    .eq("id", orderId)
    .maybeSingle();
  if (!withLease.error) {
    return {
      row: (withLease.data as unknown as FinalizeOrderRow | null) ?? null,
      leaseMode: "column",
    };
  }
  if (!isMissingDbObjectError(withLease.error)) {
    return { row: null, leaseMode: "column", error: withLease.error.message };
  }
  const base = await admin
    .from("orders")
    .select(BASE_COLUMNS)
    .eq("id", orderId)
    .maybeSingle();
  if (base.error) return { row: null, leaseMode: "legacy", error: base.error.message };
  return {
    row: (base.data as unknown as FinalizeOrderRow | null) ?? null,
    leaseMode: "legacy",
  };
}

export async function finalizePaidOrder(
  admin: Admin,
  orderId: string,
  opts: FinalizePaidOrderOptions,
): Promise<FinalizePaidOrderResult> {
  const now = (opts.now ?? (() => new Date()))();
  const result: FinalizePaidOrderResult = {
    outcome: "skipped",
    leaseMode: "column",
    pdfJobId: null,
    pdfError: null,
    issues: [],
    retryable: [],
  };
  const skip = (reason: FinalizeSkipReason): FinalizePaidOrderResult => ({
    ...result,
    outcome: "skipped",
    skipReason: reason,
  });

  try {
    const loaded = await loadOrder(admin, orderId);
    result.leaseMode = loaded.leaseMode;
    if (loaded.error) {
      console.error("[orders/finalize] 주문 조회 실패:", orderId, loaded.error);
      return skip("load_failed");
    }
    const order = loaded.row;
    if (!order) return skip("not_found");
    if (!isPaidLikeStatus(order.status)) return skip("not_paid");
    if (order.finalized_at) return skip("already_finalized");

    const paidAtMs = order.paid_at ? new Date(order.paid_at).getTime() : Number.NaN;
    const ageMs = Number.isFinite(paidAtMs) ? now.getTime() - paidAtMs : 0;
    if (!opts.claimed && ageMs > FINALIZE_RECOVERY_MAX_AGE_MS) {
      return skip("too_old");
    }

    // ── 단일 실행 게이트 ────────────────────────────────────────────
    if (loaded.leaseMode === "column") {
      const cutoff = new Date(now.getTime() - FINALIZE_LEASE_MS).toISOString();
      const leasePatch: Record<string, unknown> = {
        finalize_started_at: now.toISOString(),
      };
      const { data: leased, error: leaseErr } = await admin
        .from("orders")
        .update(leasePatch)
        .eq("id", order.id)
        .in("status", [...PAID_LIKE_STATUSES])
        .is("finalized_at", null)
        .or(`finalize_started_at.is.null,finalize_started_at.lt."${cutoff}"`)
        .select("id")
        .maybeSingle();
      if (leaseErr) {
        console.error("[orders/finalize] 리스 획득 실패:", order.id, leaseErr.message);
        return skip("load_failed");
      }
      if (!leased) return skip("in_progress");
    } else if (!opts.claimed && ageMs < FINALIZE_LEASE_MS) {
      // 미적용 폴백 — 클레임 승자가 아직 부수효과를 실행 중일 수 있는 구간.
      return skip("in_progress");
    }

    // ── 효과 실행 (각자 마커로 멱등) ─────────────────────────────────
    await ensurePointsDeducted(admin, order, result);
    await ensureDiscountRecorded(admin, order, result);
    await markProjectOrdered(admin, order);
    await awardReferral(admin, order);
    await ensureFunnelOrderPaid(admin, order);
    await ensurePdfJob(admin, order, result);
    await ensurePaidEmail(admin, order, result, opts.sendEmail);

    result.outcome = result.retryable.length === 0 ? "finalized" : "incomplete";

    if (loaded.leaseMode === "column") {
      // 완료면 마커, 일시 실패가 남았으면 리스를 풀어 다음 트리거가 바로 재시도하게.
      const donePatch: Record<string, unknown> =
        result.outcome === "finalized"
          ? { finalized_at: new Date().toISOString() }
          : { finalize_started_at: null };
      const { error: doneErr } = await admin
        .from("orders")
        .update(donePatch)
        .eq("id", order.id);
      if (doneErr) {
        console.warn("[orders/finalize] 완료 마커 기록 실패:", order.id, doneErr.message);
      }
    }

    if (result.issues.length > 0) {
      console.error("[orders/finalize] 결제 확정 후 이상 — 관리자 확인 필요", {
        orderId: order.id,
        trigger: opts.trigger,
        issues: result.issues,
      });
    }
    if (result.retryable.length > 0) {
      console.warn("[orders/finalize] 일시 실패 — 다음 트리거에서 재시도", {
        orderId: order.id,
        trigger: opts.trigger,
        retryable: result.retryable,
      });
    }
    return result;
  } catch (e) {
    console.error("[orders/finalize] 예외:", orderId, msg(e));
    return { ...result, outcome: "incomplete", retryable: [...result.retryable, msg(e)] };
  }
}

// =====================================================================
// 효과
// =====================================================================

async function ensurePointsDeducted(
  admin: Admin,
  order: FinalizeOrderRow,
  out: FinalizePaidOrderResult,
): Promise<void> {
  if (!(order.points_used > 0)) return;
  let held: number;
  try {
    held = await sumHeldOrderPoints(admin, order.id);
  } catch (e) {
    out.retryable.push(`points_query: ${msg(e)}`);
    return;
  }
  // 캡처 전 선점(0033)된 주문은 여기서 끝난다.
  if (held >= order.points_used) return;

  const need = order.points_used - held;
  const { data: newBalance, error } = await admin.rpc("deduct_user_points_v2", {
    p_user_id: order.user_id,
    p_amount: need,
    p_reason: "order_use",
    p_ref_type: "orders",
    p_ref_id: order.id,
    p_memo: `주문 ${order.id.slice(0, 8)} 결제 시 포인트 사용`,
  });
  if (error) {
    out.retryable.push(`points_deduct: ${error.message}`);
    return;
  }
  if (typeof newBalance === "number" && newBalance < 0) {
    // 결제는 확정 — 차감 못 한 사실을 남긴다. 원장에 기록이 없으므로 환불 시에도 복원되지 않는다.
    out.issues.push(`POINTS_NOT_DEDUCTED:${need}`);
  }
}

async function ensureDiscountRecorded(
  admin: Admin,
  order: FinalizeOrderRow,
  out: FinalizePaidOrderResult,
): Promise<void> {
  if (!order.discount_code_id) return;
  const { count, error } = await admin
    .from("discount_uses")
    .select("id", { count: "exact", head: true })
    .eq("order_id", order.id);
  if (error) {
    out.retryable.push(`discount_query: ${error.message}`);
    return;
  }
  // 캡처 전 선점(0033)된 주문은 여기서 끝난다.
  if ((count ?? 0) > 0) return;

  const { error: useErr } = await admin.from("discount_uses").insert({
    code_id: order.discount_code_id,
    user_id: order.user_id,
    order_id: order.id,
  });
  if (useErr) {
    if ((useErr as { code?: string }).code === "23505") {
      // 같은 사용자가 다른 주문에서 이미 쓴 코드로 결제가 확정됨(폴백 경로의 동시 confirm).
      out.issues.push("DISCOUNT_ALREADY_USED_BY_OTHER_ORDER");
    } else {
      out.retryable.push(`discount_insert: ${useErr.message}`);
    }
    return;
  }
  const { error: incErr } = await admin.rpc("increment_discount_used", {
    p_code_id: order.discount_code_id,
  });
  if (incErr) {
    // 사용 기록은 남긴다(실제로 할인 결제됨). 한도 초과·비활성이면 카운트만 못 올린 것.
    out.issues.push(`DISCOUNT_COUNT_NOT_INCREMENTED:${incErr.message}`);
  }
}

async function markProjectOrdered(admin: Admin, order: FinalizeOrderRow): Promise<void> {
  // 마이페이지 표시용 — 실패해도 결제 확정에는 영향 없음.
  // 복구 호출이 여러 번 와도 이미 ordered 인 행은 건드리지 않는다(updated_at 불필요 갱신 방지).
  const { error } = await admin
    .from("projects")
    .update({ status: "ordered" })
    .eq("id", order.project_id)
    .eq("status", "draft");
  if (error) {
    console.warn("[orders/finalize] projects.status 갱신 실패:", error.message);
  }
}

async function awardReferral(admin: Admin, order: FinalizeOrderRow): Promise<void> {
  // award_referral_reward_v2 는 referee 의 pending referral 1건만 rewarded 로 전이 —
  // 같은 주문으로 여러 번 불려도(복구 경로) 중복 지급이 없다. 실패해도 결제는 살림.
  try {
    const { data: referrerId, error } = await admin.rpc("award_referral_reward_v2", {
      p_referee_id: order.user_id,
      p_reward: REFERRAL_REWARD,
    });
    if (error) {
      console.warn("[orders/finalize] award_referral_reward 실패:", error.message);
    } else if (referrerId) {
      console.info(`[orders/finalize] 추천 보상 +${REFERRAL_REWARD}P 지급`, {
        referrerId,
        refereeId: order.user_id,
        orderId: order.id,
      });
    }
  } catch (e) {
    console.warn("[orders/finalize] 추천 보상 처리 예외:", msg(e));
  }
}

async function ensureFunnelOrderPaid(admin: Admin, order: FinalizeOrderRow): Promise<void> {
  const { data, error } = await (admin as unknown as LooseSelect)
    .from("funnel_events")
    .select("id")
    .eq("event", "order_paid")
    .eq("props->>orderId", order.id)
    .limit(1);
  if (!error && (data ?? []).length > 0) return;
  // 조회 실패 시에도 기록 시도 — 0033 부분 유니크가 중복을 막는다(23505 는 헬퍼가 무시).
  await trackFunnelEvent({
    event: "order_paid",
    userId: order.user_id,
    projectId: order.project_id,
    props: { orderId: order.id, amount: order.amount },
  });
}

async function ensurePdfJob(
  admin: Admin,
  order: FinalizeOrderRow,
  out: FinalizePaidOrderResult,
): Promise<void> {
  const { data: jobs, error } = await (admin as unknown as LooseSelect)
    .from("pdf_build_jobs")
    .select("id")
    .eq("order_id", order.id)
    .limit(1);
  if (error) {
    out.retryable.push(`pdf_job_query: ${error.message}`);
    return;
  }
  // 이미 잡이 있으면 재시도는 관리자 retry-pdf / rebuild-pdf 경로가 담당.
  if ((jobs ?? []).length > 0) return;

  try {
    const { jobId } = await enqueuePdfJob({
      orderId: order.id,
      projectId: order.project_id,
      userId: order.user_id,
      target: "all",
    });
    out.pdfJobId = jobId;
    // 등록만 동기로, 빌드는 waitUntil 백그라운드(응답 비블로킹, 함수 수명은 빌드 완료까지).
    waitUntil(
      runPdfJob(jobId, {
        signUrls: false,
        uploadPath: (key) => `${order.user_id}/${order.id}/${key}`,
        meta: { author: "100p_books" },
        onSuccess: async (r) => {
          const patch = storigeOrderPatch(r, new Date().toISOString());
          if (Object.keys(patch).length === 0) return;
          // 실패 시 throw — job-runner 가 잡을 failed 로 남겨 재시도 가능하게.
          const { error: upErr } = await admin
            .from("orders")
            .update(patch)
            .eq("id", order.id);
          if (upErr) {
            throw new Error(`orders storige update failed: ${upErr.message}`);
          }
        },
      })
        .then(() => undefined)
        .catch((e: unknown) => {
          console.error(
            "[orders/finalize] background PDF build failed for order",
            order.id,
            msg(e),
          );
        }),
    );
  } catch (e) {
    out.pdfError = "PDF 작업 등록 실패";
    out.retryable.push(`pdf_job_enqueue: ${msg(e)}`);
  }
}

async function ensurePaidEmail(
  admin: Admin,
  order: FinalizeOrderRow,
  out: FinalizePaidOrderResult,
  enqueueEmail: PaidOrderEmailSender,
): Promise<void> {
  const { count, error } = await admin
    .from("email_jobs")
    .select("id", { count: "exact", head: true })
    .eq("related_type", "order")
    .eq("related_id", order.id)
    .eq("template", "order.paid");
  if (error) {
    out.retryable.push(`email_query: ${error.message}`);
    return;
  }
  if ((count ?? 0) > 0) return;

  const [{ data: profile }, { data: project }, { count: pageCount }] = await Promise.all([
    admin
      .from("profiles")
      .select("email, display_name")
      .eq("id", order.user_id)
      .maybeSingle(),
    admin
      .from("projects")
      .select("title, book_size_id")
      .eq("id", order.project_id)
      .maybeSingle(),
    admin
      .from("pages")
      .select("id", { count: "exact", head: true })
      .eq("project_id", order.project_id),
  ]);

  // 수신자 — profiles.email 이 비어 있으면 auth 계정 이메일(기존 confirm 의 session user.email 과 동일).
  // 카카오 로그인 등으로 이메일이 아예 없으면 조용히 건너뛴다.
  let recipientEmail = profile?.email ?? "";
  if (!recipientEmail) {
    try {
      const { data: authUser, error: authErr } = await admin.auth.admin.getUserById(
        order.user_id,
      );
      if (authErr) {
        out.retryable.push(`email_recipient: ${authErr.message}`);
        return;
      }
      recipientEmail = authUser?.user?.email ?? "";
    } catch (e) {
      out.retryable.push(`email_recipient: ${msg(e)}`);
      return;
    }
  }
  if (!recipientEmail) return;

  const { data: bookSize } = project?.book_size_id
    ? await admin
        .from("book_sizes")
        .select("name")
        .eq("id", project.book_size_id)
        .maybeSingle()
    : { data: null };

  const addr = (order.address ?? {}) as { name?: string };
  const customerName =
    addr?.name ?? profile?.display_name ?? (recipientEmail.split("@")[0] || "고객");

  const sent = await enqueueEmail({
    template: "order.paid",
    to: { email: recipientEmail, name: customerName },
    context: {
      kind: "order",
      orderId: order.id,
      tossOrderId: order.toss_order_id ?? undefined,
      customerName,
      bookSizeName: bookSize?.name ?? "포토북",
      pageCount: pageCount ?? 0,
      qty: order.qty,
      amount: order.amount,
    },
    relatedType: "order",
    relatedId: order.id,
  });
  if (!sent.ok) {
    out.retryable.push(`email_enqueue: ${sent.error ?? "unknown"}`);
  }
}

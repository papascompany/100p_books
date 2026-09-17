/**
 * 결제 테스트 공용 하네스 (테스트 전용).
 *
 *   - resetHarness({ atomic }) : 0033 적용(atomic) / 미적용(legacy) 인메모리 DB 로 초기화.
 *   - seedProject / seedOrder  : orders/create 와 같은 규칙(quoteOrder·표지 규격)으로 픽스처 생성.
 *   - fakes                    : PDF 잡·메일·퍼널·waitUntil 을 인메모리 DB 에 기록.
 *   - TossSim                  : 결제 인증(IN_PROGRESS) → 승인(DONE) 상태와 멱등키 재생을 흉내.
 *
 * 테스트 파일은 vi.mock 팩토리에서 이 모듈을 동적 import 해 harness.db 를 공유한다.
 */

import type { BookSize, DiscountCode } from "@/lib/db/types";
import { calcCoverDimensions } from "@/lib/layout/cover";
import { PAGEDOC_VERSION } from "@/lib/layout/types";
import { quoteOrder } from "@/lib/orders/pricing";
import {
  TossError,
  type TossConfirmArgs,
  type TossConfirmResponse,
} from "@/lib/payments/toss";

import {
  installBaseRpcs,
  installCreditRpcs,
  MemoryDb,
  type Row,
} from "./memory-supabase";

export const USER_ID = "11111111-1111-4111-8111-111111111111";
export const USER_EMAIL = "buyer@example.com";

export const A5: Omit<BookSize, "id" | "created_at"> = {
  name: "A5",
  width_mm: 148,
  height_mm: 210,
  cover_width_mm: 302,
  cover_height_mm: 214,
  spine_formula_per_page: 0.09,
  active: true,
  display_order: 10,
};

// =====================================================================
// 토스 시뮬레이터
// =====================================================================

interface SimPayment {
  paymentKey: string;
  orderId: string;
  totalAmount: number;
  status: string;
}

export class TossSim {
  payments = new Map<string, SimPayment>();
  idempotent = new Map<string, TossConfirmResponse>();
  confirmCalls: TossConfirmArgs[] = [];
  fetchCalls: string[] = [];
  /** 다음 confirm 1회에 던질 오류 (캡처 여부는 captureBeforeThrow 로). */
  nextConfirmError: { error: TossError; captureBeforeThrow: boolean } | null = null;
  /** 승인 응답 금액을 조작(금액 불일치 시나리오). */
  overrideTotalAmount: number | null = null;
  /** confirm 시점 훅 — 선점이 캡처 전에 끝났는지 관찰용. */
  onConfirm: ((args: TossConfirmArgs) => void) | null = null;
  /** 다음 결제 조회 1회에 던질 오류 (조회 장애 시나리오). */
  nextFetchError: TossError | null = null;
  /**
   * 승인 전(READY·IN_PROGRESS) 결제 조회 응답 — 토스 조회 API 는 "승인된 결제" 대상이라
   * 404 일 수 있다. "status" 는 상태를 그대로, "not_found" 는 404 NOT_FOUND_PAYMENT.
   */
  unconfirmedLookup: "status" | "not_found" = "status";

  /** 사용자가 결제창에서 인증을 마친 상태 (successUrl 로 paymentKey 가 온 시점). */
  authorize(paymentKey: string, orderId: string, amount: number): void {
    this.payments.set(paymentKey, { paymentKey, orderId, totalAmount: amount, status: "IN_PROGRESS" });
  }

  confirm = async (args: TossConfirmArgs): Promise<TossConfirmResponse> => {
    this.confirmCalls.push(args);
    this.onConfirm?.(args);
    await Promise.resolve();
    if (args.idempotencyKey && this.idempotent.has(args.idempotencyKey)) {
      return { ...this.idempotent.get(args.idempotencyKey)! };
    }
    const p = this.payments.get(args.paymentKey);
    if (this.nextConfirmError) {
      const { error, captureBeforeThrow } = this.nextConfirmError;
      this.nextConfirmError = null;
      if (captureBeforeThrow && p) p.status = "DONE";
      throw error;
    }
    if (!p || p.orderId !== args.orderId || p.totalAmount !== args.amount) {
      throw new TossError({ code: "NOT_FOUND_PAYMENT_SESSION", message: "결제 세션 없음", status: 404 });
    }
    if (p.status === "DONE") {
      throw new TossError({ code: "ALREADY_PROCESSED_PAYMENT", message: "이미 처리된 결제 입니다.", status: 400 });
    }
    p.status = "DONE";
    const res: TossConfirmResponse = {
      paymentKey: p.paymentKey,
      orderId: p.orderId,
      status: "DONE",
      totalAmount: this.overrideTotalAmount ?? p.totalAmount,
    };
    if (args.idempotencyKey) this.idempotent.set(args.idempotencyKey, res);
    return { ...res };
  };

  /** lib/payments/toss-cancel cancelTossPaymentFully 흉내 — 호출 기록 + DONE→CANCELED. */
  cancelCalls: Array<{ paymentKey: string; cancelReason: string; idempotencyKey: string }> = [];
  /** 다음 전액 취소 1회에 던질 오류. */
  nextCancelError: TossError | null = null;
  /** 취소 직후(응답 전) 훅 — 경합 흉내. */
  onCancel: ((paymentKey: string) => void) | null = null;

  cancelFully = async (args: {
    paymentKey: string;
    cancelReason: string;
    idempotencyKey: string;
  }): Promise<{ outcome: "canceled" | "already_canceled"; payment: TossConfirmResponse }> => {
    this.cancelCalls.push(args);
    await Promise.resolve();
    if (this.nextCancelError) {
      const error = this.nextCancelError;
      this.nextCancelError = null;
      throw error;
    }
    const p = this.payments.get(args.paymentKey);
    if (!p) {
      throw new TossError({ code: "NOT_FOUND_PAYMENT", message: "결제 없음", status: 400 });
    }
    let outcome: "canceled" | "already_canceled";
    if (p.status === "DONE") {
      p.status = "CANCELED";
      outcome = "canceled";
    } else if (p.status === "CANCELED") {
      outcome = "already_canceled";
    } else {
      throw new TossError({ code: "NOT_CANCELABLE_PAYMENT", message: "취소 불가 결제", status: 400 });
    }
    this.onCancel?.(args.paymentKey);
    return { outcome, payment: { ...p } };
  };

  /** 결제 조회 시점 훅 — 조회와 클레임 사이 경합 흉내. */
  onFetch: ((paymentKey: string) => void) | null = null;

  fetch = async (paymentKey: string): Promise<TossConfirmResponse> => {
    this.fetchCalls.push(paymentKey);
    this.onFetch?.(paymentKey);
    await Promise.resolve();
    if (this.nextFetchError) {
      const error = this.nextFetchError;
      this.nextFetchError = null;
      throw error;
    }
    const p = this.payments.get(paymentKey);
    const unconfirmed = p && (p.status === "READY" || p.status === "IN_PROGRESS");
    if (!p || (unconfirmed && this.unconfirmedLookup === "not_found")) {
      throw new TossError({ code: "NOT_FOUND_PAYMENT", message: "결제 없음", status: 404 });
    }
    return { ...p, totalAmount: this.overrideTotalAmount ?? p.totalAmount };
  };
}

// =====================================================================
// 하네스 상태
// =====================================================================

export const harness: {
  db: MemoryDb;
  toss: TossSim;
  background: Promise<unknown>[];
  pdfRuns: string[];
} = {
  db: new MemoryDb(),
  toss: new TossSim(),
  background: [],
  pdfRuns: [],
};

export function resetHarness(opts: { atomic: boolean }): MemoryDb {
  const db = new MemoryDb({
    missingColumns: opts.atomic ? {} : { orders: ["finalized_at", "finalize_started_at"] },
    uniques: { discount_uses: [["code_id", "user_id"]] },
  });
  installBaseRpcs(db);
  if (opts.atomic) installCreditRpcs(db);
  harness.db = db;
  harness.toss = new TossSim();
  harness.background = [];
  harness.pdfRuns = [];
  return db;
}

// =====================================================================
// 부수효과 fake (vi.mock 팩토리에서 사용)
// =====================================================================

export const fakes = {
  async enqueuePdfJob(args: {
    orderId?: string | null;
    projectId: string;
    userId: string;
    target: string;
  }): Promise<{ jobId: string }> {
    const { data, error } = await harness.db
      .client()
      .from("pdf_build_jobs")
      .insert({
        order_id: args.orderId ?? null,
        project_id: args.projectId,
        user_id: args.userId,
        target: args.target,
        status: "pending",
      })
      .select("id")
      .single();
    if (error || !data) throw new Error(error?.message ?? "enqueue failed");
    return { jobId: String((data as Row).id) };
  },
  async runPdfJob(jobId: string): Promise<Row> {
    harness.pdfRuns.push(jobId);
    return { id: jobId, status: "success" };
  },
  async enqueueEmail(args: {
    template: string;
    to: { email: string; name?: string };
    relatedType?: string;
    relatedId?: string;
  }): Promise<{ ok: boolean; jobId: string | null; sent: boolean; error?: string }> {
    const { data, error } = await harness.db
      .client()
      .from("email_jobs")
      .insert({
        template: args.template,
        to_email: args.to.email,
        related_type: args.relatedType ?? null,
        related_id: args.relatedId ?? null,
        status: "pending",
      })
      .select("id")
      .single();
    if (error || !data) return { ok: false, jobId: null, sent: false, error: error?.message };
    return { ok: true, jobId: String((data as Row).id), sent: false };
  },
  async trackFunnelEvent(input: {
    event: string;
    userId?: string | null;
    projectId?: string | null;
    props?: Record<string, unknown>;
  }): Promise<void> {
    await harness.db
      .client()
      .from("funnel_events")
      .insert({
        event: input.event,
        user_id: input.userId ?? null,
        project_id: input.projectId ?? null,
        props: input.props ?? {},
      });
  },
  waitUntil(p: Promise<unknown>): void {
    harness.background.push(p);
  },
};

// =====================================================================
// 픽스처
// =====================================================================

let tossSeq = 0;

export function seedProject(
  db: MemoryDb,
  opts: { pages?: number; coverPages?: number } = {},
): { projectId: string; bookSizeId: string; pages: number } {
  const pages = opts.pages ?? 50;
  const size = db.seed("book_sizes", { ...A5, created_at: "2026-01-01T00:00:00Z" });
  const dims = calcCoverDimensions({ bookSize: A5, pageCount: opts.coverPages ?? pages });
  const project = db.seed("projects", {
    user_id: USER_ID,
    book_size_id: size.id,
    title: "우리 가족 앨범",
    status: "draft",
    cover_json: {
      version: PAGEDOC_VERSION,
      bookSizeId: size.id,
      pageNo: 0,
      layoutMode: "cover",
      widthMm: dims.totalWidthMm,
      heightMm: dims.totalHeightMm,
      bleedMm: 2,
      backgroundColor: "#ffffff",
      objects: [],
    },
    updated_at: "2026-09-17T00:00:00Z",
  });
  for (let i = 1; i <= pages; i += 1) {
    db.seed("pages", { project_id: project.id, page_no: i });
  }
  if (!db.find("profiles", (r) => r.id === USER_ID)) {
    db.seed("profiles", { id: USER_ID, email: USER_EMAIL, display_name: "구매자" });
  }
  return { projectId: String(project.id), bookSizeId: String(size.id), pages };
}

export function seedDiscountCode(
  db: MemoryDb,
  over: Partial<DiscountCode> = {},
): Row {
  return db.seed("discount_codes", {
    code: `WELCOME${db.table("discount_codes").length}`,
    type: "amount",
    value: 3000,
    max_uses: null,
    used_count: 0,
    expires_at: null,
    active: true,
    created_by: null,
    created_at: "2026-09-01T00:00:00Z",
    ...over,
  });
}

export function seedBalance(db: MemoryDb, balance: number): void {
  db.seed("user_points", { user_id: USER_ID, balance, updated_at: "2026-09-17T00:00:00Z" });
}

export interface SeedOrderOptions {
  projectId: string;
  pages: number;
  qty?: number;
  requestedPoints?: number;
  discount?: Row | null;
  status?: string;
  tossPaymentKey?: string | null;
  paidAt?: string | null;
  atomic?: boolean;
}

/** orders/create 와 같은 규칙으로 금액을 매긴 주문. */
export function seedOrder(db: MemoryDb, opts: SeedOrderOptions): Row {
  const quote = quoteOrder({
    bookSize: A5.name,
    pageCount: opts.pages,
    qty: opts.qty ?? 1,
    discount: opts.discount
      ? { type: opts.discount.type as DiscountCode["type"], value: Number(opts.discount.value) }
      : null,
    requestedPoints: opts.requestedPoints ?? 0,
  });
  tossSeq += 1;
  const row: Row = {
    project_id: opts.projectId,
    user_id: USER_ID,
    qty: opts.qty ?? 1,
    amount: quote.finalAmount,
    address: { name: "홍길동", phone: "010-1234-5678", zip: "12345", addr1: "서울시" },
    status: opts.status ?? "pending",
    toss_payment_key: opts.tossPaymentKey ?? null,
    toss_order_id: `100p-t${String(tossSeq).padStart(6, "0")}`,
    cover_pdf_key: null,
    interior_pdf_key: null,
    paid_at: opts.paidAt ?? null,
    discount_code_id: opts.discount ? opts.discount.id : null,
    discount_amount: quote.discountAmount,
    points_used: quote.pointsUsed,
    created_at: "2026-09-17T00:00:00Z",
    updated_at: "2026-09-17T00:00:00Z",
  };
  if (opts.atomic !== false) {
    row.finalized_at = null;
    row.finalize_started_at = null;
  }
  return db.seed("orders", row);
}

export function jsonRequest(path: string, body: unknown): Request {
  return new Request(`https://100pbooks.vercel.app${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

export async function readJson(res: Response): Promise<{
  ok: boolean;
  data?: Record<string, unknown>;
  error?: { code: string; message: string; details?: unknown };
}> {
  return (await res.json()) as {
    ok: boolean;
    data?: Record<string, unknown>;
    error?: { code: string; message: string; details?: unknown };
  };
}

/** 사용자 포인트 잔액. */
export function balanceOf(db: MemoryDb): number {
  return Number(db.find("user_points", (r) => r.user_id === USER_ID)?.balance ?? 0);
}

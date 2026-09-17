// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  balanceOf,
  harness,
  jsonRequest,
  readJson,
  resetHarness,
  seedBalance,
  seedDiscountCode,
  seedOrder,
  seedProject,
  USER_ID,
} from "@/app/api/payments/_test/harness";
import type { MemoryDb, Row } from "@/app/api/payments/_test/memory-supabase";
import type * as TossModule from "@/lib/payments/toss";

/**
 * POST /api/payments/webhook — SEC-8(주문 대조) + paid 전이 시 finalize + 환불·취소 복원.
 */

vi.mock("@/lib/security/rate-limit", () => ({
  enforceRateLimit: vi.fn(async () => ({ success: true, reset: 0, limit: 100 })),
}));
vi.mock("@/lib/db/admin", async () => {
  const { harness: h } = await import("@/app/api/payments/_test/harness");
  return { createAdminSupabase: () => h.db.client() };
});
vi.mock("@/lib/payments/toss", async (importOriginal) => {
  const actual = await importOriginal<typeof TossModule>();
  return {
    ...actual,
    fetchTossPayment: async (paymentKey: string) =>
      (await import("@/app/api/payments/_test/harness")).harness.toss.fetch(paymentKey),
  };
});
vi.mock("@vercel/functions", async () => {
  const { fakes } = await import("@/app/api/payments/_test/harness");
  return { waitUntil: (p: Promise<unknown>) => fakes.waitUntil(p) };
});
vi.mock("@/lib/pdf/job-runner", async () => {
  const { fakes } = await import("@/app/api/payments/_test/harness");
  return { enqueuePdfJob: fakes.enqueuePdfJob, runPdfJob: fakes.runPdfJob };
});
vi.mock("@/lib/email/queue", async () => {
  const { fakes } = await import("@/app/api/payments/_test/harness");
  return { enqueueEmail: fakes.enqueueEmail };
});
vi.mock("@/lib/analytics/funnel", async () => {
  const { fakes } = await import("@/app/api/payments/_test/harness");
  return { trackFunnelEvent: fakes.trackFunnelEvent };
});

import { POST } from "./route";

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "info").mockImplementation(() => undefined);
});

function setup(opts: { status?: string; points?: number; paymentKey?: string | null; discount?: boolean } = {}) {
  const db = resetHarness({ atomic: true });
  const { projectId, pages } = seedProject(db);
  seedBalance(db, 5000);
  const code = opts.discount ? seedDiscountCode(db, { max_uses: 10 }) : null;
  const order = seedOrder(db, {
    projectId,
    pages,
    requestedPoints: opts.points ?? 0,
    discount: code,
    status: opts.status ?? "pending",
    tossPaymentKey: opts.paymentKey === undefined ? "pk-1" : opts.paymentKey,
    paidAt: opts.status && opts.status !== "pending" ? new Date().toISOString() : null,
  });
  return { db, order, code };
}

/** 캡처 전 선점(0033)이 끝난 상태를 재현. */
function reserveCredits(db: MemoryDb, order: Row, points: number, code: Row | null) {
  const bal = db.find("user_points", (r) => r.user_id === USER_ID)!;
  if (points > 0) {
    bal.balance = Number(bal.balance) - points;
    db.seed("point_ledger", {
      user_id: USER_ID,
      amount: -points,
      reason: "order_use",
      ref_type: "orders",
      ref_id: order.id,
      balance_after: bal.balance,
    });
  }
  if (code) {
    db.seed("discount_uses", { code_id: code.id, user_id: USER_ID, order_id: order.id });
    code.used_count = Number(code.used_count) + 1;
  }
}

function webhook(paymentKey: string, orderId: string, status = "DONE") {
  return POST(
    jsonRequest("/api/payments/webhook", {
      eventType: "PAYMENT_STATUS_CHANGED",
      data: { paymentKey, orderId, status },
    }),
  );
}

function tossHas(paymentKey: string, orderId: string, amount: number, status: string) {
  harness.toss.payments.set(paymentKey, { paymentKey, orderId, totalAmount: amount, status });
}

describe("SEC-8 — 재조회한 결제가 이 주문의 결제인지 대조", () => {
  it("같은 금액이지만 토스 주문번호가 다른 DONE 결제 → 400, 주문은 pending 유지", async () => {
    const { db, order } = setup({ paymentKey: null });
    tossHas("pk-forged", "100p-someone-else", Number(order.amount), "DONE");

    const res = await webhook("pk-forged", String(order.toss_order_id));
    expect(res.status).toBe(400);
    expect((await readJson(res)).error?.code).toBe("TOSS_ORDER_MISMATCH");
    expect(order.status).toBe("pending");
    expect(order.toss_payment_key).toBeNull();
    expect(db.table("pdf_build_jobs")).toHaveLength(0);
  });

  it("주문에 다른 paymentKey 가 묶여 있으면 그 결제의 상태로 덮어쓰지 않음", async () => {
    const { order } = setup({ paymentKey: "pk-current" });
    tossHas("pk-old", String(order.toss_order_id), Number(order.amount), "EXPIRED");
    const res = await webhook("pk-old", String(order.toss_order_id), "EXPIRED");
    expect(res.status).toBe(200);
    expect((await readJson(res)).data).toMatchObject({ ignored: true });
    expect(order.status).toBe("pending");
  });
});

describe("DONE → paid 전이 시 finalize (DEBT-1)", () => {
  it("confirm 이 캡처 후 중단된 pending 주문 → 웹훅이 확정 + 부수효과, 선점분은 재차감 안 함", async () => {
    const { db, order, code } = setup({ points: 3000, discount: true });
    reserveCredits(db, order, 3000, code);
    tossHas("pk-1", String(order.toss_order_id), Number(order.amount), "DONE");

    const res = await webhook("pk-1", String(order.toss_order_id));
    const json = await readJson(res);
    expect(res.status).toBe(200);
    expect(json.data).toMatchObject({ mapped: "paid", transitioned: true, finalize: "finalized" });
    expect(order.status).toBe("paid");
    expect(order.finalized_at).toBeTruthy();
    expect(balanceOf(db)).toBe(2000);
    expect(code!.used_count).toBe(1);
    expect(db.table("pdf_build_jobs").filter((j) => j.order_id === order.id)).toHaveLength(1);
    expect(db.table("email_jobs").filter((j) => j.related_id === order.id)).toHaveLength(1);
    expect(
      db.table("funnel_events").filter((e) => e.event === "order_paid" && (e.props as Row).orderId === order.id),
    ).toHaveLength(1);
  });

  it("confirm 이 부수효과 실행 중(리스 보유) → 503 으로 토스 재전송 유도, 효과 중복 없음", async () => {
    const { db, order } = setup({ status: "paid" });
    order.finalize_started_at = new Date().toISOString();
    tossHas("pk-1", String(order.toss_order_id), Number(order.amount), "DONE");

    const res = await webhook("pk-1", String(order.toss_order_id));
    expect(res.status).toBe(503);
    expect((await readJson(res)).error?.code).toBe("FINALIZE_IN_PROGRESS");
    expect(db.table("pdf_build_jobs")).toHaveLength(0);
  });

  it("이미 확정·완료된 주문의 재전송 → 200, 아무것도 다시 하지 않음", async () => {
    const { db, order } = setup({ status: "paid" });
    order.finalized_at = new Date().toISOString();
    tossHas("pk-1", String(order.toss_order_id), Number(order.amount), "DONE");

    const res = await webhook("pk-1", String(order.toss_order_id));
    expect(res.status).toBe(200);
    expect((await readJson(res)).data).toMatchObject({ transitioned: false, finalize: "skipped" });
    expect(db.table("pdf_build_jobs")).toHaveLength(0);
  });
});

describe("finalize 미완료 → 503 으로 토스 재전송 유도", () => {
  it("클레임 승자인데 PDF 잡 조회가 일시 실패 → 503 FINALIZE_INCOMPLETE · 재전송 때 남은 효과만 실행", async () => {
    const { db, order } = setup({ points: 1000 });
    reserveCredits(db, order, 1000, null);
    tossHas("pk-1", String(order.toss_order_id), Number(order.amount), "DONE");
    db.failOnce.set("select:pdf_build_jobs", { message: "connection reset" });

    const first = await webhook("pk-1", String(order.toss_order_id));
    expect(first.status).toBe(503);
    expect((await readJson(first)).error?.code).toBe("FINALIZE_INCOMPLETE");
    expect(order.status).toBe("paid");
    expect(order.finalized_at).toBeNull();
    expect(db.table("pdf_build_jobs")).toHaveLength(0);

    const retry = await webhook("pk-1", String(order.toss_order_id));
    expect(retry.status).toBe(200);
    expect((await readJson(retry)).data).toMatchObject({ transitioned: false, finalize: "finalized" });
    expect(db.table("pdf_build_jobs").filter((j) => j.order_id === order.id)).toHaveLength(1);
    expect(db.table("email_jobs").filter((j) => j.related_id === order.id)).toHaveLength(1);
    expect(balanceOf(db)).toBe(4000);
  });

  it("리스 갱신 DB 오류(load_failed) → 503", async () => {
    const { db, order } = setup({ status: "paid" });
    tossHas("pk-1", String(order.toss_order_id), Number(order.amount), "DONE");
    db.failOnce.set("update:orders", { message: "connection reset" });

    const res = await webhook("pk-1", String(order.toss_order_id));
    expect(res.status).toBe(503);
    expect((await readJson(res)).error?.code).toBe("FINALIZE_INCOMPLETE");
    expect(db.table("pdf_build_jobs")).toHaveLength(0);
  });
});

describe("확정 전 pending 주문의 결제가 토스에서 취소됨", () => {
  it("CANCELED → 상태는 pending 유지, 선점 크레딧만 해제(키 유지) · 재전송 멱등", async () => {
    const { db, order, code } = setup({ points: 2000, discount: true });
    reserveCredits(db, order, 2000, code);
    tossHas("pk-1", String(order.toss_order_id), Number(order.amount), "CANCELED");

    const res = await webhook("pk-1", String(order.toss_order_id), "CANCELED");
    expect(res.status).toBe(200);
    expect((await readJson(res)).data).toMatchObject({ transitioned: false, creditsReleased: true });
    expect(order.status).toBe("pending");
    expect(order.toss_payment_key).toBe("pk-1");
    expect(balanceOf(db)).toBe(5000);
    expect(code!.used_count).toBe(0);

    await webhook("pk-1", String(order.toss_order_id), "CANCELED");
    expect(balanceOf(db)).toBe(5000);
  });
});

describe("환불·취소 전이 — 실제로 잡힌 크레딧만 복원", () => {
  it("CANCELED(paid) → refunded + 선점분 정확히 복원", async () => {
    const { db, order, code } = setup({ status: "paid", points: 3000, discount: true });
    reserveCredits(db, order, 3000, code);
    tossHas("pk-1", String(order.toss_order_id), Number(order.amount), "CANCELED");

    const res = await webhook("pk-1", String(order.toss_order_id), "CANCELED");
    expect(res.status).toBe(200);
    expect(order.status).toBe("refunded");
    expect(balanceOf(db)).toBe(5000);
    expect(code!.used_count).toBe(0);

    // 재전송 — 조건부 클레임 + 멱등 복원으로 이중 지급 없음
    await webhook("pk-1", String(order.toss_order_id), "CANCELED");
    expect(balanceOf(db)).toBe(5000);
  });

  it("CANCELED 인데 차감 기록이 없던 주문 → points_used 를 지급하지 않음", async () => {
    const { db, order } = setup({ status: "paid", points: 3000 });
    tossHas("pk-1", String(order.toss_order_id), Number(order.amount), "CANCELED");
    await webhook("pk-1", String(order.toss_order_id), "CANCELED");
    expect(order.status).toBe("refunded");
    expect(balanceOf(db)).toBe(5000);
  });

  it("EXPIRED(pending, 선점 후 승인 못 함) → cancelled + 선점 해제", async () => {
    const { db, order } = setup({ points: 2000 });
    reserveCredits(db, order, 2000, null);
    tossHas("pk-1", String(order.toss_order_id), Number(order.amount), "EXPIRED");

    const res = await webhook("pk-1", String(order.toss_order_id), "EXPIRED");
    expect(res.status).toBe(200);
    expect(order.status).toBe("cancelled");
    expect(balanceOf(db)).toBe(5000);
  });
});

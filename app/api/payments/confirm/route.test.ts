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
  USER_EMAIL,
  USER_ID,
} from "@/app/api/payments/_test/harness";
import type { MemoryDb, Row } from "@/app/api/payments/_test/memory-supabase";
import type * as TossModule from "@/lib/payments/toss";
import { buildConfirmIdempotencyKey, TossError } from "@/lib/payments/toss";
import type * as TossCancelModule from "@/lib/payments/toss-cancel";
import { cancelledOrderCancelIdempotencyKey } from "@/lib/payments/toss-cancel";

/**
 * POST /api/payments/confirm — 결제 무결성 (DEBT-1, DEBT-2, DEBT-7, SEC-7).
 *
 * 서비스 롤·RLS 클라이언트 모두 인메모리 DB, 토스는 인증→승인 상태와 멱등키 재생을 흉내 내는
 * 시뮬레이터로 바꾼다. 포인트·할인 RPC 는 SQL 과 같은 규칙으로 흉내 낸다.
 */

vi.mock("@/lib/auth/session", () => ({
  requireActiveUser: vi.fn(async () => ({ id: "11111111-1111-4111-8111-111111111111", email: "buyer@example.com" })),
}));
vi.mock("@/lib/db/admin", async () => {
  const { harness: h } = await import("@/app/api/payments/_test/harness");
  return { createAdminSupabase: () => h.db.client() };
});
vi.mock("@/lib/db/server", async () => {
  const { harness: h } = await import("@/app/api/payments/_test/harness");
  return { createServerSupabase: () => h.db.client() };
});
vi.mock("@/lib/payments/toss", async (importOriginal) => {
  const actual = await importOriginal<typeof TossModule>();
  return {
    ...actual,
    confirmTossPayment: async (args: Parameters<typeof actual.confirmTossPayment>[0]) =>
      (await import("@/app/api/payments/_test/harness")).harness.toss.confirm(args),
    fetchTossPayment: async (paymentKey: string) =>
      (await import("@/app/api/payments/_test/harness")).harness.toss.fetch(paymentKey),
  };
});
vi.mock("@/lib/payments/toss-cancel", async (importOriginal) => {
  const actual = await importOriginal<typeof TossCancelModule>();
  return {
    ...actual,
    cancelTossPaymentFully: async (args: Parameters<typeof actual.cancelTossPaymentFully>[0]) =>
      (await import("@/app/api/payments/_test/harness")).harness.toss.cancelFully(args),
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

interface Scenario {
  db: MemoryDb;
  projectId: string;
  pages: number;
}

function scenario(opts: { atomic?: boolean; balance?: number } = {}): Scenario {
  const db = resetHarness({ atomic: opts.atomic ?? true });
  const { projectId, pages } = seedProject(db);
  seedBalance(db, opts.balance ?? 5000);
  return { db, projectId, pages };
}

function order(
  s: Scenario,
  opts: { points?: number; discount?: Row | null } = {},
): Row {
  return seedOrder(s.db, {
    projectId: s.projectId,
    pages: s.pages,
    requestedPoints: opts.points ?? 0,
    discount: opts.discount ?? null,
    atomic: s.db.missingColumns.orders === undefined,
  });
}

/** 결제창 인증까지 마친 상태 → successUrl 에서 confirm 호출. */
function authorizeAndConfirm(o: Row, paymentKey: string) {
  harness.toss.authorize(paymentKey, String(o.toss_order_id), Number(o.amount));
  return confirm(o, paymentKey);
}

function confirm(o: Row, paymentKey: string) {
  return POST(
    jsonRequest("/api/payments/confirm", {
      orderId: o.id,
      paymentKey,
      amount: o.amount,
      tossOrderId: o.toss_order_id,
    }),
  );
}

function jobsFor(db: MemoryDb, o: Row) {
  return {
    pdf: db.table("pdf_build_jobs").filter((j) => j.order_id === o.id).length,
    email: db.table("email_jobs").filter((j) => j.related_id === o.id).length,
    funnel: db.table("funnel_events").filter((e) => (e.props as Row).orderId === o.id).length,
    ledger: db.table("point_ledger").filter((l) => l.ref_id === o.id).length,
  };
}

describe("정상 결제 — 크레딧 선점이 캡처보다 먼저", () => {
  it("포인트·할인을 캡처 전에 잡고, 멱등키로 승인한 뒤 확정·부수효과 1회", async () => {
    const s = scenario();
    const code = seedDiscountCode(s.db, { max_uses: 10 });
    const o = order(s, { points: 3000, discount: code });

    let balanceAtCapture: number | null = null;
    let usesAtCapture: number | null = null;
    harness.toss.onConfirm = () => {
      balanceAtCapture = balanceOf(s.db);
      usesAtCapture = s.db.table("discount_uses").length;
    };

    const res = await authorizeAndConfirm(o, "pk-1");
    const json = await readJson(res);
    expect(res.status).toBe(200);
    expect(json.data).toMatchObject({ orderId: o.id, status: "paid", pdfError: null });

    // SEC-7: 캡처 시점에 이미 차감·기록돼 있다.
    expect(balanceAtCapture).toBe(2000);
    expect(usesAtCapture).toBe(1);
    expect(harness.toss.confirmCalls).toHaveLength(1);
    expect(harness.toss.confirmCalls[0]!.idempotencyKey).toBe(
      buildConfirmIdempotencyKey(String(o.id), "pk-1"),
    );

    expect(o.status).toBe("paid");
    expect(o.toss_payment_key).toBe("pk-1");
    expect(o.finalized_at).toBeTruthy();
    expect(balanceOf(s.db)).toBe(2000);
    expect(code.used_count).toBe(1);
    expect(jobsFor(s.db, o)).toEqual({ pdf: 1, email: 1, funnel: 1, ledger: 1 });
    expect(s.db.find("email_jobs", (j) => j.related_id === o.id)?.to_email).toBe(USER_EMAIL);
  });
});

describe("선점 롤백 — 캡처되지 않으면 크레딧을 되돌린다", () => {
  it("토스 거절(카드 거절 등) → 포인트·할인 원복 + paymentKey 해제, 주문은 pending", async () => {
    const s = scenario();
    const code = seedDiscountCode(s.db, { max_uses: 10 });
    const o = order(s, { points: 3000, discount: code });
    harness.toss.nextConfirmError = {
      error: new TossError({ code: "REJECT_CARD_PAYMENT", message: "한도 초과", status: 400 }),
      captureBeforeThrow: false,
    };

    const res = await authorizeAndConfirm(o, "pk-1");
    expect(res.status).toBe(400);
    expect((await readJson(res)).error?.code).toBe("PAYMENT_VERIFY_FAILED");
    expect(o.status).toBe("pending");
    expect(o.toss_payment_key).toBeNull();
    expect(balanceOf(s.db)).toBe(5000);
    expect(code.used_count).toBe(0);
    expect(s.db.table("discount_uses")).toHaveLength(0);
    expect(jobsFor(s.db, o).pdf).toBe(0);
  });

  it("토스 응답 금액 불일치 → 선점 원복, 추적용 paymentKey 는 유지, 확정하지 않음", async () => {
    const s = scenario();
    const o = order(s, { points: 3000 });
    harness.toss.authorize("pk-1", String(o.toss_order_id), Number(o.amount));
    harness.toss.overrideTotalAmount = Number(o.amount) + 1000;

    const res = await confirm(o, "pk-1");
    expect(res.status).toBe(400);
    expect((await readJson(res)).error?.code).toBe("AMOUNT_MISMATCH");
    expect(o.status).toBe("pending");
    expect(o.toss_payment_key).toBe("pk-1");
    expect(balanceOf(s.db)).toBe(5000);
    expect(jobsFor(s.db, o).pdf).toBe(0);
  });
});

describe("캡처 결과 불명·재시도 수렴 (DEBT-1)", () => {
  it("타임아웃(캡처는 됨) → 선점 유지 · 새로고침하면 재캡처 없이 확정, 차감은 1회", async () => {
    const s = scenario();
    const o = order(s, { points: 3000 });
    harness.toss.nextConfirmError = {
      error: new TossError({ code: "TOSS_TIMEOUT", message: "토스 응답 시간 초과", status: 504 }),
      captureBeforeThrow: true,
    };

    const first = await authorizeAndConfirm(o, "pk-1");
    expect(first.status).toBe(504);
    expect((await readJson(first)).error?.code).toBe("PAYMENT_STATUS_UNKNOWN");
    expect(o.status).toBe("pending");
    expect(o.toss_payment_key).toBe("pk-1");
    expect(balanceOf(s.db)).toBe(2000);

    const retry = await confirm(o, "pk-1");
    expect(retry.status).toBe(200);
    expect(o.status).toBe("paid");
    expect(harness.toss.confirmCalls).toHaveLength(1); // 조회로 DONE 확인 — 재승인 안 함
    expect(balanceOf(s.db)).toBe(2000);
    expect(jobsFor(s.db, o)).toEqual({ pdf: 1, email: 1, funnel: 1, ledger: 1 });
  });

  it("ALREADY_PROCESSED_PAYMENT → 결제 조회로 DONE 확인 후 확정", async () => {
    const s = scenario();
    const o = order(s);
    harness.toss.nextConfirmError = {
      error: new TossError({ code: "ALREADY_PROCESSED_PAYMENT", message: "이미 처리된 결제 입니다.", status: 400 }),
      captureBeforeThrow: true,
    };
    const res = await authorizeAndConfirm(o, "pk-1");
    expect(res.status).toBe(200);
    expect(o.status).toBe("paid");
    expect(harness.toss.fetchCalls).toContain("pk-1");
  });

  it("클레임 DB 오류 → 500(결제는 캡처) · 새로고침으로 복구, 부수효과 1회", async () => {
    const s = scenario();
    const o = order(s, { points: 1000 });
    // 선점 RPC 가 아니라 클레임 UPDATE 만 실패시킨다(선점은 RPC 경로).
    s.db.failOnce.set("update:orders", { message: "canceling statement due to statement timeout" });

    const first = await authorizeAndConfirm(o, "pk-1");
    expect(first.status).toBe(500);
    expect((await readJson(first)).error?.code).toBe("ORDER_UPDATE_FAILED");
    expect(o.status).toBe("pending");

    const retry = await confirm(o, "pk-1");
    expect(retry.status).toBe(200);
    expect(o.status).toBe("paid");
    expect(balanceOf(s.db)).toBe(4000);
    expect(jobsFor(s.db, o)).toEqual({ pdf: 1, email: 1, funnel: 1, ledger: 1 });
  });

  it("이미 paid 인 주문 재호출 → 멱등 성공 + 빠진 부수효과 복구", async () => {
    const s = scenario();
    const o = order(s);
    await authorizeAndConfirm(o, "pk-1");
    // 부수효과 도중 중단된 상황 재현: 메일 기록·완료 마커가 없다.
    s.db.tables.email_jobs = [];
    o.finalized_at = null;
    o.finalize_started_at = null;

    const res = await confirm(o, "pk-1");
    const json = await readJson(res);
    expect(res.status).toBe(200);
    expect(json.data).toMatchObject({ idempotent: true, status: "paid" });
    expect(jobsFor(s.db, o)).toMatchObject({ pdf: 1, email: 1, funnel: 1 });
  });
});

describe("바인딩된 재시도 — 캡처됐을 수 있는 결제의 선점·키를 풀지 않는다", () => {
  it("타임아웃(캡처됨) → 재시도 때 토스 조회 실패 + 편집으로 가격 기준 변경 → 502, 선점·키 유지 · 조회가 돌아오면 확정", async () => {
    const s = scenario();
    const o = order(s, { points: 3000 });
    harness.toss.nextConfirmError = {
      error: new TossError({ code: "TOSS_TIMEOUT", message: "토스 응답 시간 초과", status: 504 }),
      captureBeforeThrow: true,
    };
    expect((await authorizeAndConfirm(o, "pk-1")).status).toBe(504);

    // 결제 결과를 기다리는 사이 사용자가 페이지를 추가(가격 기준 드리프트)
    for (let i = 0; i < 10; i += 1) s.db.seed("pages", { project_id: s.projectId, page_no: 200 + i });
    harness.toss.nextFetchError = new TossError({ code: "TOSS_TIMEOUT", message: "조회 시간 초과", status: 504 });

    const retry = await confirm(o, "pk-1");
    expect(retry.status).toBe(502);
    expect((await readJson(retry)).error?.code).toBe("PAYMENT_STATUS_UNKNOWN");
    expect(o.status).toBe("pending");
    expect(o.toss_payment_key).toBe("pk-1");
    expect(balanceOf(s.db)).toBe(2000);
    expect(harness.toss.confirmCalls).toHaveLength(1);

    // 조회가 회복되면 캡처된 결제로 확정 — 드리프트로 막지 않는다(돈은 이미 캡처됨).
    const again = await confirm(o, "pk-1");
    expect(again.status).toBe(200);
    expect(o.status).toBe("paid");
    expect(balanceOf(s.db)).toBe(2000);
    expect(harness.toss.confirmCalls).toHaveLength(1);
    expect(jobsFor(s.db, o)).toEqual({ pdf: 1, email: 1, funnel: 1, ledger: 1 });
  });

  it("요청이 토스에 닿지 못함 → 재시도 때 조회 404(승인 전) + pages 조회 DB 오류여도 같은 멱등키로 승인해 확정", async () => {
    const s = scenario();
    const o = order(s, { points: 1000 });
    harness.toss.unconfirmedLookup = "not_found";
    harness.toss.nextConfirmError = {
      error: new TossError({ code: "TOSS_NETWORK_ERROR", message: "fetch failed", status: 502 }),
      captureBeforeThrow: false,
    };
    expect((await authorizeAndConfirm(o, "pk-1")).status).toBe(502);
    expect(o.toss_payment_key).toBe("pk-1");
    expect(balanceOf(s.db)).toBe(4000);

    // 재시도에서 가격 재검증을 했다면 이 주입으로 500 + 선점 해제가 났다.
    s.db.failOnce.set("select:pages", { message: "canceling statement due to statement timeout" });
    const retry = await confirm(o, "pk-1");
    expect(retry.status).toBe(200);
    expect(o.status).toBe("paid");
    expect(balanceOf(s.db)).toBe(4000);
    expect(harness.toss.confirmCalls).toHaveLength(2);
    const key = buildConfirmIdempotencyKey(String(o.id), "pk-1");
    expect(harness.toss.confirmCalls.map((c) => c.idempotencyKey)).toEqual([key, key]);
    expect(jobsFor(s.db, o).ledger).toBe(1);
  });

  it("클레임 실패로 pending 에 남은 결제를 토스에서 취소 → 재호출해도 승인 재시도·확정 안 함, 크레딧만 복원", async () => {
    const s = scenario();
    const o = order(s, { points: 1000 });
    s.db.failOnce.set("update:orders", { message: "canceling statement due to statement timeout" });
    expect((await authorizeAndConfirm(o, "pk-1")).status).toBe(500);
    expect(o.status).toBe("pending");
    expect(balanceOf(s.db)).toBe(4000);

    harness.toss.payments.get("pk-1")!.status = "CANCELED";
    const retry = await confirm(o, "pk-1");
    const json = await readJson(retry);
    expect(retry.status).toBe(400);
    expect(json.error?.code).toBe("PAYMENT_NOT_DONE");
    expect(json.error?.details).toMatchObject({ tossStatus: "CANCELED" });
    expect(o.status).toBe("pending");
    expect(harness.toss.confirmCalls).toHaveLength(1); // 멱등키 재생(DONE) 경로를 타지 않음
    expect(balanceOf(s.db)).toBe(5000);
    expect(o.toss_payment_key).toBe("pk-1"); // 추적용 유지 → 주문서 재사용·재결제 대상 아님
    expect(jobsFor(s.db, o).pdf).toBe(0);

    // 다시 불러도 이중 복원 없음
    await confirm(o, "pk-1");
    expect(balanceOf(s.db)).toBe(5000);
  });

  it("부분 취소 등 자동 처리할 수 없는 상태 → 승인 재시도·해제 없이 400", async () => {
    const s = scenario();
    const o = order(s, { points: 1000 });
    s.db.failOnce.set("update:orders", { message: "timeout" });
    await authorizeAndConfirm(o, "pk-1");
    harness.toss.payments.get("pk-1")!.status = "PARTIAL_CANCELED";

    const retry = await confirm(o, "pk-1");
    expect(retry.status).toBe(400);
    expect((await readJson(retry)).error?.code).toBe("PAYMENT_NOT_DONE");
    expect(harness.toss.confirmCalls).toHaveLength(1);
    expect(balanceOf(s.db)).toBe(4000);
    expect(o.toss_payment_key).toBe("pk-1");
  });
});

describe("캡처 ↔ 주문 취소 경합 — 돈은 빠졌는데 주문은 취소 상태를 남기지 않는다", () => {
  it("토스 승인 호출 사이 주문이 cancelled → 확정하지 않고 전액 취소 + 크레딧 복원, 409 ORDER_CANCELLED", async () => {
    const s = scenario();
    const code = seedDiscountCode(s.db, { max_uses: 10 });
    const o = order(s, { points: 3000, discount: code });
    // 선점·바인딩 뒤, 캡처 직전에 관리자가 주문을 취소한 상황
    harness.toss.onConfirm = () => {
      o.status = "cancelled";
    };

    const res = await authorizeAndConfirm(o, "pk-1");
    const json = await readJson(res);
    expect(res.status).toBe(409);
    expect(json.error?.code).toBe("ORDER_CANCELLED");
    expect(o.status).toBe("cancelled");
    expect(harness.toss.payments.get("pk-1")?.status).toBe("CANCELED");
    expect(harness.toss.cancelCalls).toEqual([
      expect.objectContaining({
        paymentKey: "pk-1",
        idempotencyKey: cancelledOrderCancelIdempotencyKey(String(o.id), "pk-1"),
      }),
    ]);
    expect(balanceOf(s.db)).toBe(5000);
    expect(code.used_count).toBe(0);
    expect(jobsFor(s.db, o)).toMatchObject({ pdf: 0, email: 0, funnel: 0 });
  });

  it("자동 취소가 토스 오류로 실패 → 502 PAYMENT_CANCEL_PENDING(선점 유지) · 새로고침이 다시 취소해 수렴", async () => {
    const s = scenario();
    const o = order(s, { points: 3000 });
    harness.toss.onConfirm = () => {
      o.status = "cancelled";
    };
    harness.toss.nextCancelError = new TossError({ code: "TOSS_TIMEOUT", message: "시간 초과", status: 504 });

    const first = await authorizeAndConfirm(o, "pk-1");
    expect(first.status).toBe(502);
    expect((await readJson(first)).error?.code).toBe("PAYMENT_CANCEL_PENDING");
    expect(harness.toss.payments.get("pk-1")?.status).toBe("DONE");
    expect(balanceOf(s.db)).toBe(2000);

    const retry = await confirm(o, "pk-1");
    expect(retry.status).toBe(409);
    expect((await readJson(retry)).error?.code).toBe("ORDER_CANCELLED");
    expect(harness.toss.payments.get("pk-1")?.status).toBe("CANCELED");
    expect(harness.toss.confirmCalls).toHaveLength(1); // 재승인 없음
    expect(balanceOf(s.db)).toBe(5000);

    // 다시 불러도 이미 취소 — 크레딧 이중 복원 없음
    const again = await confirm(o, "pk-1");
    expect((await readJson(again)).error?.code).toBe("ORDER_CANCELLED");
    expect(balanceOf(s.db)).toBe(5000);
  });

  it("바인딩된 채 취소된 주문 + 결제가 승인된 적 없음(조회 404) → 409 ORDER_NOT_PENDING, 토스 취소·승인 없음", async () => {
    const s = scenario();
    const o = order(s);
    harness.toss.authorize("pk-1", String(o.toss_order_id), Number(o.amount));
    harness.toss.unconfirmedLookup = "not_found";
    o.status = "cancelled";
    o.toss_payment_key = "pk-1";

    const res = await confirm(o, "pk-1");
    expect(res.status).toBe(409);
    expect((await readJson(res)).error?.code).toBe("ORDER_NOT_PENDING");
    expect(harness.toss.cancelCalls).toHaveLength(0);
    expect(harness.toss.confirmCalls).toHaveLength(0);
  });

  it("취소된 주문 재호출 때 토스 조회 실패 → 502 PAYMENT_STATUS_UNKNOWN, 아무것도 바꾸지 않음", async () => {
    const s = scenario();
    const o = order(s, { points: 3000 });
    harness.toss.onConfirm = () => {
      o.status = "cancelled";
    };
    harness.toss.nextCancelError = new TossError({ code: "PROVIDER_ERROR", message: "일시 오류", status: 502 });
    expect((await authorizeAndConfirm(o, "pk-1")).status).toBe(502);

    harness.toss.nextFetchError = new TossError({ code: "TOSS_TIMEOUT", message: "조회 시간 초과", status: 504 });
    const retry = await confirm(o, "pk-1");
    expect(retry.status).toBe(502);
    expect((await readJson(retry)).error?.code).toBe("PAYMENT_STATUS_UNKNOWN");
    expect(harness.toss.cancelCalls).toHaveLength(1);
    expect(balanceOf(s.db)).toBe(2000);
  });

  it("클레임이 빗나간 뒤 주문 재조회가 DB 오류 → 500 ORDER_UPDATE_FAILED(재시도 가능), 결제 취소하지 않음", async () => {
    const s = scenario();
    const o = order(s);
    harness.toss.onConfirm = () => {
      o.status = "in_production";
      s.db.failOnce.set("select:orders", { message: "connection reset" });
    };
    const res = await authorizeAndConfirm(o, "pk-1");
    expect(res.status).toBe(500);
    expect((await readJson(res)).error?.code).toBe("ORDER_UPDATE_FAILED");
    expect(harness.toss.cancelCalls).toHaveLength(0);
  });
});

describe("선점 해제 실패 — 재시도 가능한 코드로 응답", () => {
  it("토스 거절 뒤 해제 RPC 오류 → 503 CREDITS_RELEASE_FAILED(키·선점 유지) · 새로고침하면 해제로 수렴", async () => {
    const s = scenario();
    const o = order(s, { points: 3000 });
    harness.toss.nextConfirmError = {
      error: new TossError({ code: "REJECT_CARD_PAYMENT", message: "한도 초과", status: 400 }),
      captureBeforeThrow: false,
    };
    s.db.failOnce.set("rpc:release_order_credits", { message: "connection reset" });

    const first = await authorizeAndConfirm(o, "pk-1");
    const json = await readJson(first);
    expect(first.status).toBe(503);
    expect(json.error?.code).toBe("CREDITS_RELEASE_FAILED");
    expect(json.error?.details).toMatchObject({ reason: "PAYMENT_VERIFY_FAILED" });
    expect(o.toss_payment_key).toBe("pk-1");
    expect(balanceOf(s.db)).toBe(2000);

    // 토스는 거절된 결제를 ABORTED 로 남긴다 → 바인딩된 재시도가 조회로 해제
    harness.toss.payments.get("pk-1")!.status = "ABORTED";
    const retry = await confirm(o, "pk-1");
    expect(retry.status).toBe(400);
    expect((await readJson(retry)).error?.code).toBe("PAYMENT_NOT_DONE");
    expect(o.toss_payment_key).toBeNull();
    expect(o.status).toBe("pending");
    expect(balanceOf(s.db)).toBe(5000);
  });

  it("금액 불일치 뒤 해제 RPC 오류 → 503 CREDITS_RELEASE_FAILED", async () => {
    const s = scenario();
    const o = order(s, { points: 3000 });
    harness.toss.authorize("pk-1", String(o.toss_order_id), Number(o.amount));
    harness.toss.overrideTotalAmount = Number(o.amount) + 1000;
    s.db.failOnce.set("rpc:release_order_credits", { message: "connection reset" });

    const res = await confirm(o, "pk-1");
    expect(res.status).toBe(503);
    expect((await readJson(res)).error).toMatchObject({
      code: "CREDITS_RELEASE_FAILED",
      details: { reason: "AMOUNT_MISMATCH" },
    });
    expect(balanceOf(s.db)).toBe(2000);
  });
});

describe("결제 키·경합 정합성", () => {
  it("같은 결제의 다른 요청이 선점 직전에 확정 → NOT_PENDING 대신 멱등 성공", async () => {
    const s = scenario();
    const o = order(s);
    harness.toss.authorize("pk-1", String(o.toss_order_id), Number(o.amount));
    const reserve = s.db.rpcs.reserve_order_credits!;
    s.db.rpcs.reserve_order_credits = (args, db) => {
      // 웹훅이 먼저 pending→paid 클레임
      o.status = "paid";
      o.toss_payment_key = "pk-1";
      o.paid_at = new Date().toISOString();
      return reserve(args, db);
    };

    const res = await confirm(o, "pk-1");
    const json = await readJson(res);
    expect(res.status).toBe(200);
    expect(json.data).toMatchObject({ idempotent: true, status: "paid" });
    expect(harness.toss.confirmCalls).toHaveLength(0);
  });

  it("이미 다른 주문에 묶인 paymentKey 로 confirm → 바인딩·선점 전에 409", async () => {
    const s = scenario();
    const paid = seedOrder(s.db, {
      projectId: s.projectId,
      pages: s.pages,
      status: "paid",
      tossPaymentKey: "pk-A",
      paidAt: new Date().toISOString(),
    });
    const b = order(s, { points: 1000 });

    const res = await confirm(b, "pk-A");
    expect(res.status).toBe(409);
    expect((await readJson(res)).error?.code).toBe("PAYMENT_KEY_CONFLICT");
    expect(b.toss_payment_key).toBeNull();
    expect(balanceOf(s.db)).toBe(5000);
    expect(harness.toss.confirmCalls).toHaveLength(0);
    expect(s.db.table("orders").filter((r) => r.toss_payment_key === "pk-A")).toEqual([paid]);
  });

  it("토스가 돌려준 결제가 다른 주문번호 → 선점 해제 + 바인딩도 해제(한 키가 두 주문에 남지 않음)", async () => {
    const s = scenario();
    const o = order(s, { points: 1000 });
    harness.toss.payments.set("pk-x", {
      paymentKey: "pk-x",
      orderId: "100p-someone-else",
      totalAmount: Number(o.amount),
      status: "DONE",
    });
    harness.toss.nextConfirmError = {
      error: new TossError({ code: "ALREADY_PROCESSED_PAYMENT", message: "이미 처리된 결제 입니다.", status: 400 }),
      captureBeforeThrow: false,
    };

    const res = await confirm(o, "pk-x");
    expect(res.status).toBe(400);
    expect((await readJson(res)).error?.code).toBe("TOSS_PAYMENT_MISMATCH");
    expect(o.status).toBe("pending");
    expect(o.toss_payment_key).toBeNull();
    expect(balanceOf(s.db)).toBe(5000);
  });
});

describe("동시성 (SEC-7)", () => {
  it("같은 포인트를 쓴 서로 다른 주문 2건 동시 confirm → 1건만 캡처, 포인트 1회만 사용", async () => {
    const s = scenario({ balance: 3000 });
    const a = order(s, { points: 3000 });
    const b = order(s, { points: 3000 });
    harness.toss.authorize("pk-a", String(a.toss_order_id), Number(a.amount));
    harness.toss.authorize("pk-b", String(b.toss_order_id), Number(b.amount));

    const [ra, rb] = await Promise.all([confirm(a, "pk-a"), confirm(b, "pk-b")]);
    const statuses = [ra.status, rb.status].sort();
    expect(statuses).toEqual([200, 400]);
    const loser = ra.status === 400 ? ra : rb;
    expect((await readJson(loser)).error?.code).toBe("POINTS_INSUFFICIENT");
    expect(harness.toss.confirmCalls).toHaveLength(1);
    expect(balanceOf(s.db)).toBe(0);
    expect([a.status, b.status].sort()).toEqual(["paid", "pending"]);
  });

  it("1인 1회 할인 코드를 쓴 주문 2건 동시 confirm → 1건만 캡처", async () => {
    const s = scenario();
    const code = seedDiscountCode(s.db);
    const a = order(s, { discount: code });
    const b = order(s, { discount: code });
    harness.toss.authorize("pk-a", String(a.toss_order_id), Number(a.amount));
    harness.toss.authorize("pk-b", String(b.toss_order_id), Number(b.amount));

    const [ra, rb] = await Promise.all([confirm(a, "pk-a"), confirm(b, "pk-b")]);
    expect([ra.status, rb.status].sort()).toEqual([200, 400]);
    expect(harness.toss.confirmCalls).toHaveLength(1);
    expect(code.used_count).toBe(1);
    expect(s.db.table("discount_uses")).toHaveLength(1);
  });

  it("같은 주문 이중 confirm 동시 → 둘 다 성공 응답, 차감·잡·메일은 1회", async () => {
    const s = scenario();
    const o = order(s, { points: 2000 });
    harness.toss.authorize("pk-1", String(o.toss_order_id), Number(o.amount));

    const [r1, r2] = await Promise.all([confirm(o, "pk-1"), confirm(o, "pk-1")]);
    expect([r1.status, r2.status]).toEqual([200, 200]);
    expect(o.status).toBe("paid");
    expect(balanceOf(s.db)).toBe(3000);
    expect(jobsFor(s.db, o)).toEqual({ pdf: 1, email: 1, funnel: 1, ledger: 1 });
  });
});

describe("결제 시점 재검증 (DEBT-2) · 할인 재검증 (DEBT-7 b)", () => {
  it("주문 후 페이지가 늘어 금액 기준이 바뀌면 캡처하지 않고 409 ORDER_PRICING_CHANGED", async () => {
    const s = scenario();
    const o = order(s, { points: 1000 });
    for (let i = 0; i < 10; i += 1) {
      s.db.seed("pages", { project_id: s.projectId, page_no: 100 + i });
    }
    // 표지는 새 페이지 수 규격으로 다시 만든 상태(표지 게이트가 아니라 금액 드리프트를 본다)
    const project = s.db.find("projects", (p) => p.id === s.projectId)!;
    (project.cover_json as Row).widthMm = 302 + 60 * 0.09;

    const res = await authorizeAndConfirm(o, "pk-1");
    const json = await readJson(res);
    expect(res.status).toBe(409);
    expect(json.error?.code).toBe("ORDER_PRICING_CHANGED");
    expect(json.error?.message).toContain("새로고침");
    expect(harness.toss.confirmCalls).toHaveLength(0);
    expect(balanceOf(s.db)).toBe(5000);
    expect(o.toss_payment_key).toBeNull();
  });

  it("표지 규격이 현재 페이지 수와 맞지 않으면 409 COVER_FORMAT_OUTDATED (캡처 안 함)", async () => {
    const s = scenario();
    const o = order(s);
    const project = s.db.find("projects", (p) => p.id === s.projectId)!;
    (project.cover_json as Row).widthMm = 604;
    const res = await authorizeAndConfirm(o, "pk-1");
    expect(res.status).toBe(409);
    expect((await readJson(res)).error?.code).toBe("COVER_FORMAT_OUTDATED");
    expect(harness.toss.confirmCalls).toHaveLength(0);
  });

  it("선착순 코드가 주문 생성 후 한도에 도달하면 캡처 전에 거부", async () => {
    const s = scenario();
    const code = seedDiscountCode(s.db, { max_uses: 1 });
    const o = order(s, { discount: code });
    code.used_count = 1;
    const res = await authorizeAndConfirm(o, "pk-1");
    const json = await readJson(res);
    expect(res.status).toBe(400);
    expect(json.error?.code).toBe("DISCOUNT_INVALID");
    expect(harness.toss.confirmCalls).toHaveLength(0);
  });
});

describe("0033 미적용 폴백", () => {
  it("기존 경로로 결제 확정 — 캡처 후 차감·할인 기록, 부수효과 1회", async () => {
    const s = scenario({ atomic: false });
    const code = seedDiscountCode(s.db, { max_uses: 10 });
    const o = order(s, { points: 3000, discount: code });

    let balanceAtCapture: number | null = null;
    harness.toss.onConfirm = () => {
      balanceAtCapture = balanceOf(s.db);
    };
    const res = await authorizeAndConfirm(o, "pk-1");
    expect(res.status).toBe(200);
    expect(balanceAtCapture).toBe(5000); // 폴백은 캡처 후 차감
    expect(o.status).toBe("paid");
    expect(balanceOf(s.db)).toBe(2000);
    expect(code.used_count).toBe(1);
    expect(jobsFor(s.db, o)).toEqual({ pdf: 1, email: 1, funnel: 1, ledger: 1 });
  });

  it("폴백에서도 토스 거절이면 paymentKey 바인딩을 풀어 재결제 가능", async () => {
    const s = scenario({ atomic: false });
    const o = order(s);
    harness.toss.nextConfirmError = {
      error: new TossError({ code: "REJECT_CARD_PAYMENT", message: "거절", status: 400 }),
      captureBeforeThrow: false,
    };
    const res = await authorizeAndConfirm(o, "pk-1");
    expect(res.status).toBe(400);
    expect(o.toss_payment_key).toBeNull();
  });
});

describe("권한·입력", () => {
  it("다른 사용자의 주문 → 403, 아무것도 선점하지 않음", async () => {
    const s = scenario();
    const o = order(s, { points: 1000 });
    o.user_id = "22222222-2222-4222-8222-222222222222";
    const res = await authorizeAndConfirm(o, "pk-1");
    expect(res.status).toBe(403);
    expect(balanceOf(s.db)).toBe(5000);
    expect(USER_ID).not.toBe(o.user_id);
  });

  it("다른 paymentKey 로 이미 진행 중인 주문 → 409 PAYMENT_KEY_CONFLICT", async () => {
    const s = scenario();
    const o = order(s);
    o.toss_payment_key = "pk-other";
    const res = await authorizeAndConfirm(o, "pk-1");
    expect(res.status).toBe(409);
    expect((await readJson(res)).error?.code).toBe("PAYMENT_KEY_CONFLICT");
    expect(harness.toss.confirmCalls).toHaveLength(0);
  });
});

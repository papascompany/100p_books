// @vitest-environment node
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import {
  balanceOf,
  fakes,
  harness,
  resetHarness,
  seedBalance,
  seedDiscountCode,
  seedOrder,
  seedProject,
  USER_ID,
} from "@/app/api/payments/_test/harness";
import type { MemoryDb, Row } from "@/app/api/payments/_test/memory-supabase";
import type { Database } from "@/lib/db/types";

/**
 * finalizePaidOrder — 결제 확정 후 부수효과 멱등 실행 (DEBT-1, SEC-8).
 *
 * PDF 잡·메일·퍼널·waitUntil 은 인메모리 DB 에 기록하는 fake 로 바꾸고,
 * 포인트·할인 RPC 는 SQL 규칙대로 흉내 낸 DB 를 쓴다.
 */

vi.mock("@vercel/functions", async () => {
  const { fakes } = await import("@/app/api/payments/_test/harness");
  return { waitUntil: (p: Promise<unknown>) => fakes.waitUntil(p) };
});
vi.mock("@/lib/pdf/job-runner", async () => {
  const { fakes } = await import("@/app/api/payments/_test/harness");
  return { enqueuePdfJob: fakes.enqueuePdfJob, runPdfJob: fakes.runPdfJob };
});
vi.mock("@/lib/analytics/funnel", async () => {
  const { fakes } = await import("@/app/api/payments/_test/harness");
  return { trackFunnelEvent: fakes.trackFunnelEvent };
});

import { FINALIZE_LEASE_MS, finalizePaidOrder } from "./finalize-paid";

const sendEmail = fakes.enqueueEmail;

function adminOf(db: MemoryDb): SupabaseClient<Database> {
  return db.client() as unknown as SupabaseClient<Database>;
}

function paidOrder(
  db: MemoryDb,
  opts: { atomic: boolean; points?: number; discount?: Row | null; paidAt?: string },
): Row {
  const { projectId, pages } = seedProject(db);
  return seedOrder(db, {
    projectId,
    pages,
    requestedPoints: opts.points ?? 0,
    discount: opts.discount ?? null,
    status: "paid",
    tossPaymentKey: "pk-1",
    paidAt: opts.paidAt ?? new Date().toISOString(),
    atomic: opts.atomic,
  });
}

function effectCounts(db: MemoryDb, orderId: unknown) {
  return {
    pdfJobs: db.table("pdf_build_jobs").filter((j) => j.order_id === orderId).length,
    emails: db
      .table("email_jobs")
      .filter((j) => j.related_id === orderId && j.template === "order.paid").length,
    funnel: db
      .table("funnel_events")
      .filter((e) => e.event === "order_paid" && (e.props as Row).orderId === orderId).length,
    ledger: db.table("point_ledger").filter((l) => l.ref_id === orderId).length,
    uses: db.table("discount_uses").filter((u) => u.order_id === orderId).length,
  };
}

describe("finalizePaidOrder — 0033 적용(리스 컬럼)", () => {
  it("클레임 승자가 모든 효과를 1회 실행하고 finalized_at 을 남긴다 · 두 번째 호출은 건너뜀", async () => {
    const db = resetHarness({ atomic: true });
    const order = paidOrder(db, { atomic: true });
    const admin = adminOf(db);

    const r1 = await finalizePaidOrder(admin, String(order.id), { claimed: true, trigger: "confirm", sendEmail });
    expect(r1.outcome).toBe("finalized");
    expect(r1.leaseMode).toBe("column");
    expect(r1.pdfJobId).toBeTruthy();
    expect(effectCounts(db, order.id)).toMatchObject({ pdfJobs: 1, emails: 1, funnel: 1 });
    expect(order.finalized_at).toBeTruthy();
    expect(db.find("projects", (p) => p.id === order.project_id)?.status).toBe("ordered");
    await Promise.all(harness.background);
    expect(harness.pdfRuns).toEqual([r1.pdfJobId]);

    const r2 = await finalizePaidOrder(admin, String(order.id), { claimed: false, trigger: "webhook", sendEmail });
    expect(r2).toMatchObject({ outcome: "skipped", skipReason: "already_finalized", pdfJobId: null });
    expect(effectCounts(db, order.id)).toMatchObject({ pdfJobs: 1, emails: 1, funnel: 1 });
  });

  it("동시에 두 곳(confirm·webhook)에서 불려도 효과는 한 번만 — 진 쪽은 in_progress", async () => {
    const db = resetHarness({ atomic: true });
    const order = paidOrder(db, { atomic: true });
    const admin = adminOf(db);

    const [a, b] = await Promise.all([
      finalizePaidOrder(admin, String(order.id), { claimed: true, trigger: "confirm", sendEmail }),
      finalizePaidOrder(admin, String(order.id), { claimed: false, trigger: "webhook", sendEmail }),
    ]);
    const outcomes = [a, b].map((r) => r.skipReason ?? r.outcome).sort();
    expect(outcomes).toEqual(["finalized", "in_progress"]);
    expect(effectCounts(db, order.id)).toMatchObject({ pdfJobs: 1, emails: 1, funnel: 1 });
  });

  it("일시 실패는 리스를 풀어 다음 트리거가 빠진 효과만 다시 실행", async () => {
    const db = resetHarness({ atomic: true });
    const order = paidOrder(db, { atomic: true });
    const admin = adminOf(db);
    db.failOnce.set("insert:email_jobs", { message: "connection reset" });

    const r1 = await finalizePaidOrder(admin, String(order.id), { claimed: true, trigger: "confirm", sendEmail });
    expect(r1.outcome).toBe("incomplete");
    expect(r1.retryable.join()).toContain("email_enqueue");
    expect(order.finalized_at).toBeNull();
    expect(order.finalize_started_at).toBeNull();
    expect(effectCounts(db, order.id)).toMatchObject({ pdfJobs: 1, emails: 0, funnel: 1 });

    const r2 = await finalizePaidOrder(admin, String(order.id), {
      claimed: false,
      trigger: "confirm_retry",
      sendEmail,
    });
    expect(r2.outcome).toBe("finalized");
    expect(r2.pdfJobId).toBeNull();
    expect(effectCounts(db, order.id)).toMatchObject({ pdfJobs: 1, emails: 1, funnel: 1 });
  });

  it("리스가 만료된(실행자가 죽은) 주문은 복구 호출이 이어받는다", async () => {
    const db = resetHarness({ atomic: true });
    const order = paidOrder(db, { atomic: true });
    order.finalize_started_at = new Date(Date.now() - FINALIZE_LEASE_MS - 1000).toISOString();
    const r = await finalizePaidOrder(adminOf(db), String(order.id), {
      claimed: false,
      trigger: "webhook",
      sendEmail,
    });
    expect(r.outcome).toBe("finalized");
    expect(effectCounts(db, order.id).pdfJobs).toBe(1);
  });

  it("선점(0033)으로 이미 잡힌 크레딧은 다시 차감·기록하지 않는다", async () => {
    const db = resetHarness({ atomic: true });
    seedBalance(db, 5000);
    const code = seedDiscountCode(db);
    const order = paidOrder(db, { atomic: true, points: 3000, discount: code });
    // 캡처 전 선점 결과를 재현
    db.seed("point_ledger", {
      user_id: USER_ID,
      amount: -3000,
      reason: "order_use",
      ref_type: "orders",
      ref_id: order.id,
      balance_after: 2000,
    });
    db.find("user_points", (r) => r.user_id === USER_ID)!.balance = 2000;
    db.seed("discount_uses", { code_id: code.id, user_id: USER_ID, order_id: order.id });
    code.used_count = 1;

    const r = await finalizePaidOrder(adminOf(db), String(order.id), { claimed: true, trigger: "confirm", sendEmail });
    expect(r.outcome).toBe("finalized");
    expect(balanceOf(db)).toBe(2000);
    expect(code.used_count).toBe(1);
    expect(effectCounts(db, order.id)).toMatchObject({ ledger: 1, uses: 1 });
    expect(db.calls).not.toContain("rpc:deduct_user_points_v2");
    expect(db.calls).not.toContain("rpc:increment_discount_used");
  });

  it("profiles.email 이 비면 auth 계정 이메일로 주문 확인 메일 · 둘 다 없으면 건너뜀 · auth 조회 오류는 재시도 대상", async () => {
    const db = resetHarness({ atomic: true });
    const order = paidOrder(db, { atomic: true });
    db.find("profiles", (p) => p.id === USER_ID)!.email = null;
    db.authUsers.set(USER_ID, { id: USER_ID, email: "kakao-user@example.com" });

    db.failOnce.set("auth:getUserById", { message: "auth service unavailable" });
    const r1 = await finalizePaidOrder(adminOf(db), String(order.id), { claimed: true, trigger: "confirm", sendEmail });
    expect(r1.outcome).toBe("incomplete");
    expect(r1.retryable.join()).toContain("email_recipient");

    const r2 = await finalizePaidOrder(adminOf(db), String(order.id), {
      claimed: false,
      trigger: "confirm_retry",
      sendEmail,
    });
    expect(r2.outcome).toBe("finalized");
    expect(db.find("email_jobs", (j) => j.related_id === order.id)?.to_email).toBe(
      "kakao-user@example.com",
    );

    const noEmail = paidOrder(db, { atomic: true });
    db.authUsers.set(USER_ID, { id: USER_ID });
    const r3 = await finalizePaidOrder(adminOf(db), String(noEmail.id), { claimed: true, trigger: "confirm", sendEmail });
    expect(r3.outcome).toBe("finalized");
    expect(effectCounts(db, noEmail.id).emails).toBe(0);
  });

  it("결제 확정 상태가 아니면 아무것도 하지 않는다", async () => {
    const db = resetHarness({ atomic: true });
    const order = paidOrder(db, { atomic: true });
    order.status = "pending";
    const r = await finalizePaidOrder(adminOf(db), String(order.id), { claimed: true, trigger: "confirm", sendEmail });
    expect(r).toMatchObject({ outcome: "skipped", skipReason: "not_paid" });
    expect(effectCounts(db, order.id).pdfJobs).toBe(0);
  });
});

describe("finalizePaidOrder — 0033 미적용 폴백", () => {
  it("캡처 후 포인트 차감·할인 기록을 실행하고, 중복 호출에도 한 번만", async () => {
    const db = resetHarness({ atomic: false });
    seedBalance(db, 5000);
    const code = seedDiscountCode(db, { max_uses: 5 });
    const order = paidOrder(db, { atomic: false, points: 3000, discount: code });
    const admin = adminOf(db);

    const r1 = await finalizePaidOrder(admin, String(order.id), { claimed: true, trigger: "confirm", sendEmail });
    expect(r1).toMatchObject({ outcome: "finalized", leaseMode: "legacy", issues: [] });
    expect(balanceOf(db)).toBe(2000);
    expect(code.used_count).toBe(1);

    // 폴백에는 완료 마커가 없다 — 효과별 마커가 재실행을 막는다.
    const r2 = await finalizePaidOrder(admin, String(order.id), { claimed: true, trigger: "confirm", sendEmail });
    expect(r2.outcome).toBe("finalized");
    expect(balanceOf(db)).toBe(2000);
    expect(code.used_count).toBe(1);
    expect(effectCounts(db, order.id)).toMatchObject({
      pdfJobs: 1,
      emails: 1,
      funnel: 1,
      ledger: 1,
      uses: 1,
    });
  });

  it("복구 호출은 paid_at 이 리스 시간 안이면 in_progress, 지나면 실행, 72h 넘으면 too_old", async () => {
    const db = resetHarness({ atomic: false });
    const admin = adminOf(db);
    const fresh = paidOrder(db, { atomic: false });
    expect(
      await finalizePaidOrder(admin, String(fresh.id), { claimed: false, trigger: "webhook", sendEmail }),
    ).toMatchObject({ outcome: "skipped", skipReason: "in_progress" });

    const stale = paidOrder(db, {
      atomic: false,
      paidAt: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
    });
    expect(
      (await finalizePaidOrder(admin, String(stale.id), { claimed: false, trigger: "webhook", sendEmail })).outcome,
    ).toBe("finalized");

    const old = paidOrder(db, {
      atomic: false,
      paidAt: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString(),
    });
    expect(
      await finalizePaidOrder(admin, String(old.id), { claimed: false, trigger: "confirm_retry", sendEmail }),
    ).toMatchObject({ outcome: "skipped", skipReason: "too_old" });
    expect(effectCounts(db, old.id).pdfJobs).toBe(0);
  });

  it("캡처 후 잔액이 부족하면 결제는 유지하고 이상으로 보고(원장 없음 → 환불 때 복원 안 됨)", async () => {
    const db = resetHarness({ atomic: false });
    seedBalance(db, 1000);
    const order = paidOrder(db, { atomic: false, points: 3000 });
    const r = await finalizePaidOrder(adminOf(db), String(order.id), { claimed: true, trigger: "confirm", sendEmail });
    expect(r.outcome).toBe("finalized");
    expect(r.issues).toEqual(["POINTS_NOT_DEDUCTED:3000"]);
    expect(balanceOf(db)).toBe(1000);
    expect(effectCounts(db, order.id).ledger).toBe(0);
  });
});

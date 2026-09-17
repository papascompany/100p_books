// @vitest-environment node
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";

import {
  balanceOf,
  resetHarness,
  seedBalance,
  seedDiscountCode,
  seedOrder,
  seedProject,
  USER_ID,
} from "@/app/api/payments/_test/harness";
import type { MemoryDb, Row } from "@/app/api/payments/_test/memory-supabase";
import type { Database } from "@/lib/db/types";

import {
  releaseOrderCredits,
  reserveOrderCredits,
  restoreOrderCredits,
  sumHeldOrderPoints,
} from "./refund";

/**
 * 주문 크레딧 선점·해제·복원 (SEC-7, DEBT-7).
 *
 *   - atomic: 0033 RPC 가 있는 DB (RPC 는 SQL 과 같은 규칙으로 흉내 — 한 번 = 한 트랜잭션).
 *   - legacy: RPC·컬럼이 없는 DB (마이그레이션 적용 전 폴백 경로).
 */

function adminOf(db: MemoryDb): SupabaseClient<Database> {
  return db.client() as unknown as SupabaseClient<Database>;
}

function orderRef(o: Row) {
  return {
    id: String(o.id),
    user_id: USER_ID,
    points_used: Number(o.points_used),
    discount_code_id: (o.discount_code_id as string | null) ?? null,
  };
}

function setup(opts: { atomic: boolean; balance?: number; points?: number; discount?: boolean }) {
  const db = resetHarness({ atomic: opts.atomic });
  const { projectId, pages } = seedProject(db);
  seedBalance(db, opts.balance ?? 5000);
  const code = opts.discount ? seedDiscountCode(db, { max_uses: 10 }) : null;
  const order = seedOrder(db, {
    projectId,
    pages,
    requestedPoints: opts.points ?? 3000,
    discount: code,
    atomic: opts.atomic,
  });
  return { db, admin: adminOf(db), order, code, projectId, pages };
}

function reserveArgs(order: Row, paymentKey = "pk-1") {
  return {
    orderId: String(order.id),
    paymentKey,
    amount: Number(order.amount),
    tossOrderId: String(order.toss_order_id),
  };
}

describe("reserveOrderCredits — 원자 모드(0033)", () => {
  it("캡처 전 포인트 차감 + 할인 사용 기록 + paymentKey 바인딩, 재호출은 no-op", async () => {
    const { db, admin, order, code } = setup({ atomic: true, discount: true });

    const first = await reserveOrderCredits(admin, reserveArgs(order));
    expect(first).toMatchObject({ ok: true, mode: "atomic", pointsReserved: 3000, discountReserved: true });
    expect(balanceOf(db)).toBe(2000);
    expect(db.table("discount_uses")).toHaveLength(1);
    expect(code!.used_count).toBe(1);
    expect(order.toss_payment_key).toBe("pk-1");

    const again = await reserveOrderCredits(admin, reserveArgs(order));
    expect(again).toMatchObject({ ok: true, pointsReserved: 0, discountReserved: false });
    expect(balanceOf(db)).toBe(2000);
    expect(db.table("point_ledger")).toHaveLength(1);
    expect(code!.used_count).toBe(1);
  });

  it("주문 간 같은 포인트 — 두 번째 주문은 잔액 부족으로 아무것도 바꾸지 않음", async () => {
    const { db, admin, order, projectId, pages } = setup({ atomic: true, balance: 3000 });
    const other = seedOrder(db, { projectId, pages, requestedPoints: 3000 });

    const [a, b] = await Promise.all([
      reserveOrderCredits(admin, reserveArgs(order, "pk-a")),
      reserveOrderCredits(admin, reserveArgs(other, "pk-b")),
    ]);
    const results = [a, b];
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    const failed = results.find((r) => !r.ok);
    expect(failed).toMatchObject({ ok: false, code: "POINTS_INSUFFICIENT", balance: 0, requested: 3000 });
    expect(balanceOf(db)).toBe(0);
    expect(db.table("point_ledger")).toHaveLength(1);
    // 진 쪽 주문은 paymentKey 도 묶이지 않는다.
    const losers = [order, other].filter((o) => !o.toss_payment_key);
    expect(losers).toHaveLength(1);
  });

  it("1인 1회 코드를 다른 주문에 이미 선점했으면 already_used", async () => {
    const { db, admin, order, code, projectId, pages } = setup({ atomic: true, points: 0, discount: true });
    const other = seedOrder(db, { projectId, pages, discount: code });
    expect((await reserveOrderCredits(admin, reserveArgs(order, "pk-a"))).ok).toBe(true);
    const r = await reserveOrderCredits(admin, reserveArgs(other, "pk-b"));
    expect(r).toMatchObject({ ok: false, code: "DISCOUNT_INVALID", reason: "already_used" });
    expect(code!.used_count).toBe(1);
  });

  it("max_uses 도달·만료·비활성 코드는 캡처 전에 거부 (DEBT-7 b)", async () => {
    const { db, admin, projectId, pages } = setup({ atomic: true, points: 0 });
    const cases: Array<[Partial<Record<string, unknown>>, string]> = [
      [{ max_uses: 1, used_count: 1 }, "limit_reached"],
      [{ expires_at: "2020-01-01T00:00:00Z" }, "expired"],
      [{ active: false }, "inactive"],
    ];
    for (const [over, reason] of cases) {
      const code = seedDiscountCode(db, over);
      const o = seedOrder(db, { projectId, pages, discount: code });
      const r = await reserveOrderCredits(admin, reserveArgs(o, `pk-${reason}`));
      expect(r).toMatchObject({ ok: false, code: "DISCOUNT_INVALID", reason });
      expect(o.toss_payment_key).toBeNull();
    }
    expect(db.table("discount_uses")).toHaveLength(0);
  });

  it("다른 paymentKey 로 묶인 주문·금액이 바뀐 주문은 거부", async () => {
    const { admin, order } = setup({ atomic: true });
    expect((await reserveOrderCredits(admin, reserveArgs(order, "pk-1"))).ok).toBe(true);
    expect(await reserveOrderCredits(admin, reserveArgs(order, "pk-2"))).toMatchObject({
      ok: false,
      code: "PAYMENT_KEY_CONFLICT",
    });
    expect(
      await reserveOrderCredits(admin, { ...reserveArgs(order, "pk-1"), amount: 1 }),
    ).toMatchObject({ ok: false, code: "ORDER_CHANGED" });
  });
});

describe("releaseOrderCredits — 캡처 실패 롤백", () => {
  it("선점한 만큼 정확히 되돌리고 paymentKey 를 풀며, 두 번째 호출은 no-op", async () => {
    const { db, admin, order, code } = setup({ atomic: true, discount: true });
    await reserveOrderCredits(admin, reserveArgs(order));

    const r1 = await releaseOrderCredits(admin, {
      orderId: String(order.id),
      paymentKey: "pk-1",
      clearPaymentKey: true,
    });
    expect(r1).toMatchObject({ ok: true, pointsRestored: 3000, discountUsesRestored: 1 });
    expect(balanceOf(db)).toBe(5000);
    expect(code!.used_count).toBe(0);
    expect(db.table("discount_uses")).toHaveLength(0);
    expect(order.toss_payment_key).toBeNull();
    expect(await sumHeldOrderPoints(admin, String(order.id))).toBe(0);

    // 같은 주문을 새 paymentKey 로 다시 결제할 수 있다.
    expect((await reserveOrderCredits(admin, reserveArgs(order, "pk-2"))).ok).toBe(true);
    expect(balanceOf(db)).toBe(2000);
  });

  it("그 사이 paid 로 확정된 주문은 되돌리지 않는다", async () => {
    const { db, admin, order } = setup({ atomic: true });
    await reserveOrderCredits(admin, reserveArgs(order));
    order.status = "paid";
    const r = await releaseOrderCredits(admin, {
      orderId: String(order.id),
      paymentKey: "pk-1",
      clearPaymentKey: true,
    });
    expect(r).toMatchObject({ ok: false, code: "NOT_PENDING" });
    expect(balanceOf(db)).toBe(2000);
  });
});

describe("restoreOrderCredits — 환불 시 실제 적용분만 복원 (DEBT-7 a·d)", () => {
  for (const atomic of [true, false]) {
    const label = atomic ? "원자 모드" : "폴백(0033 미적용)";

    it(`${label}: 차감·기록된 크레딧만 복원하고 두 번 불러도 한 번만`, async () => {
      const { db, admin, order, code } = setup({ atomic, discount: true });
      // 결제 확정 때 실제로 차감·기록된 상태를 만든다(원장 order_use + 사용 기록 + 카운트).
      await admin.rpc("deduct_user_points_v2", {
        p_user_id: USER_ID,
        p_amount: 3000,
        p_reason: "order_use",
        p_ref_type: "orders",
        p_ref_id: String(order.id),
        p_memo: null,
      });
      db.seed("discount_uses", { code_id: code!.id, user_id: USER_ID, order_id: order.id });
      code!.used_count = 4;
      order.status = "refunded";

      const r1 = await restoreOrderCredits(admin, orderRef(order));
      expect(r1).toMatchObject({ ok: true, pointsRestored: 3000, discountUsesRestored: 1 });
      expect(balanceOf(db)).toBe(5000);
      expect(code!.used_count).toBe(3);

      const r2 = await restoreOrderCredits(admin, orderRef(order));
      expect(r2).toMatchObject({ ok: true, pointsRestored: 0, discountUsesRestored: 0 });
      expect(balanceOf(db)).toBe(5000);
      expect(code!.used_count).toBe(3);
    });

    it(`${label}: 차감에 실패했던 주문(원장 없음)은 points_used 를 복원하지 않음`, async () => {
      const { db, admin, order, code } = setup({ atomic, discount: true });
      // 할인 사용 기록도 23505 로 남지 않았던 주문 — used_count 를 깎으면 안 된다.
      code!.used_count = 2;
      order.status = "refunded";
      const r = await restoreOrderCredits(admin, orderRef(order));
      expect(r).toMatchObject({ ok: true, pointsRestored: 0, discountUsesRestored: 0 });
      expect(balanceOf(db)).toBe(5000);
      expect(code!.used_count).toBe(2);
      expect(db.table("point_ledger")).toHaveLength(0);
    });

    it(`${label}: 환불/취소 상태가 아닌 주문은 복원하지 않음`, async () => {
      const { db, admin, order } = setup({ atomic });
      await admin.rpc("deduct_user_points_v2", {
        p_user_id: USER_ID,
        p_amount: 3000,
        p_reason: "order_use",
        p_ref_type: "orders",
        p_ref_id: String(order.id),
        p_memo: null,
      });
      order.status = "paid";
      const r = await restoreOrderCredits(admin, orderRef(order));
      expect(r).toMatchObject({ ok: false, code: "NOT_RELEASABLE_STATE" });
      expect(balanceOf(db)).toBe(2000);
    });
  }
});

describe("reserveOrderCredits — 폴백(0033 미적용)", () => {
  it("사전 검사만 하고(차감 없음) paymentKey 를 바인딩한다", async () => {
    const { db, admin, order } = setup({ atomic: false, discount: true });
    const r = await reserveOrderCredits(admin, reserveArgs(order));
    expect(r).toMatchObject({ ok: true, mode: "legacy", pointsReserved: 0 });
    expect(balanceOf(db)).toBe(5000);
    expect(order.toss_payment_key).toBe("pk-1");
  });

  it("한도에 도달한 코드는 폴백에서도 캡처 전에 거부", async () => {
    const { db, admin, projectId, pages } = setup({ atomic: false, points: 0 });
    const code = seedDiscountCode(db, { max_uses: 2, used_count: 2 });
    const o = seedOrder(db, { projectId, pages, discount: code, atomic: false });
    const r = await reserveOrderCredits(admin, reserveArgs(o));
    expect(r).toMatchObject({ ok: false, mode: "legacy", code: "DISCOUNT_INVALID", reason: "limit_reached" });
    expect(o.toss_payment_key).toBeNull();
  });

  it("잔액 부족은 폴백에서도 거부", async () => {
    const { admin, order } = setup({ atomic: false, balance: 1000 });
    const r = await reserveOrderCredits(admin, reserveArgs(order));
    expect(r).toMatchObject({ ok: false, code: "POINTS_INSUFFICIENT", balance: 1000, requested: 3000 });
  });
});

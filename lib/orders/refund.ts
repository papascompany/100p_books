import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/db/types";

/**
 * 환불 시 사용 포인트 + 할인 복원 (best-effort).
 *
 *   - order.points_used > 0 → add_user_points_v2(reason='order_refund') 로 복원.
 *   - order.discount_code_id 존재 → discount_uses 행 삭제(사용자 재사용 가능) +
 *     discount_codes.used_count 감액(read-modify-write — 환불은 저빈도라 race 무시 가능).
 *
 * ⚠️ 멱등 아님 — 호출 측이 "refunded 로의 1회 전이"를 조건부 클레임으로 보장해야
 *    이중 복원이 발생하지 않는다(orders.status='refunded' 는 종착 상태라 재진입 불가 +
 *    조건부 UPDATE 로 동시 중복까지 차단).
 */
export async function restoreOrderCredits(
  admin: SupabaseClient<Database>,
  order: {
    id: string;
    user_id: string;
    points_used: number;
    discount_code_id: string | null;
  },
): Promise<void> {
  if (order.points_used && order.points_used > 0) {
    const { error } = await admin.rpc("add_user_points_v2", {
      p_user_id: order.user_id,
      p_amount: order.points_used,
      p_reason: "order_refund",
      p_ref_type: "orders",
      p_ref_id: order.id,
      p_memo: `주문 ${order.id.slice(0, 8)} 환불 — 사용 포인트 복원`,
    });
    if (error) {
      console.warn("[orders/refund] 포인트 복원 실패:", error.message);
    }
  }

  if (order.discount_code_id) {
    await admin
      .from("discount_uses")
      .delete()
      .eq("code_id", order.discount_code_id)
      .eq("user_id", order.user_id)
      .eq("order_id", order.id);
    const { data: dc } = await admin
      .from("discount_codes")
      .select("used_count")
      .eq("id", order.discount_code_id)
      .maybeSingle();
    if (dc && typeof dc.used_count === "number") {
      await admin
        .from("discount_codes")
        .update({ used_count: Math.max(0, dc.used_count - 1) })
        .eq("id", order.discount_code_id);
    }
  }
}

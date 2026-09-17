import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/db/types";
import type { PaidOrderEmailSender } from "@/lib/orders/finalize-paid";

/**
 * 주문 환불 완료 고객 알림 (order.refunded).
 *
 * refunded 로의 **조건부 클레임 승자만** 호출한다 — 관리자 전액 환불(api/admin/orders/[id]/refund)과
 * 토스 웹훅(CANCELED → refunded) 중 먼저 전이한 쪽이 한 번 보낸다. 진 쪽은 보내지 않으므로
 * 같은 주문에 환불 메일이 두 번 가지 않고, 웹훅이 먼저 전이해도 메일이 빠지지 않는다.
 *
 * 발송 함수는 라우트가 넘긴다(`enqueueEmail`) — lib/email/queue 를 직접 import 하지 않는 이유는
 * lib/orders/finalize-paid.ts PaidOrderEmailSender 주석과 같다(즉시 발송이 호출 라우트의 maxDuration
 * 안에서 끝나는지 lib/email/worker.test.ts 가 import 기준으로 검사한다).
 *
 * 관리자 사유는 내부 메모일 수 있어 싣지 않는다. 실패해도 throw 하지 않는다(환불 응답을 막지 않음).
 */
export interface RefundedEmailOrder {
  id: string;
  user_id: string;
  project_id: string;
  qty: number;
  amount: number;
  address: { name?: string } | null;
  toss_order_id: string | null;
}

export async function enqueueOrderRefundedEmail(
  admin: SupabaseClient<Database>,
  order: RefundedEmailOrder,
  sendEmail: PaidOrderEmailSender,
): Promise<void> {
  try {
    const [{ data: profile }, { data: project }, { count: pageCount }] = await Promise.all([
      admin.from("profiles").select("email, display_name").eq("id", order.user_id).maybeSingle(),
      admin.from("projects").select("title, book_size_id").eq("id", order.project_id).maybeSingle(),
      admin
        .from("pages")
        .select("id", { count: "exact", head: true })
        .eq("project_id", order.project_id),
    ]);
    const recipientEmail = profile?.email ?? "";
    if (!recipientEmail) return;

    const { data: bookSize } = project?.book_size_id
      ? await admin.from("book_sizes").select("name").eq("id", project.book_size_id).maybeSingle()
      : { data: null };

    const customerName =
      order.address?.name ?? profile?.display_name ?? (recipientEmail.split("@")[0] || "고객");

    await sendEmail({
      template: "order.refunded",
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
  } catch (e) {
    console.warn(
      "[orders/refunded-email] enqueue email failed:",
      e instanceof Error ? e.message : String(e),
    );
  }
}

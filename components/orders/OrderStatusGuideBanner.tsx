import Link from "next/link";

import type { OrderStatus } from "@/lib/db/types";
import { CUSTOMER_CENTER_TEL, CUSTOMER_CENTER_TEL_HREF } from "@/lib/orders/customer-center";
import { orderStatusGuide } from "@/lib/orders/state";

/**
 * 주문 상세의 상태별 취소·환불 안내 배너. 문구는 lib/orders/state.ts orderStatusGuide 가 정본이고,
 * 문구 안의 고객센터 번호는 tel: 링크로 바꿔 그린다.
 */
export default function OrderStatusGuideBanner({ status }: { status: OrderStatus }) {
  const guide = orderStatusGuide(status);
  if (!guide) return null;

  const parts = guide.message.split(CUSTOMER_CENTER_TEL);

  return (
    <p className="mt-4 rounded-2xl border border-sky-200 bg-sky-50 p-4 text-sm text-sky-900 dark:border-sky-800 dark:bg-sky-950 dark:text-sky-200">
      {parts.map((text, i) => (
        <span key={i}>
          {text}
          {i < parts.length - 1 ? (
            <a
              href={CUSTOMER_CENTER_TEL_HREF}
              className="font-medium underline underline-offset-2 hover:no-underline"
            >
              {CUSTOMER_CENTER_TEL}
            </a>
          ) : null}
        </span>
      ))}
      {guide.showRefundPolicyLink ? (
        <>
          {" "}
          <Link
            href="/refund"
            className="font-medium underline underline-offset-2 hover:no-underline"
          >
            교환·환불 정책 보기
          </Link>
        </>
      ) : null}
    </p>
  );
}

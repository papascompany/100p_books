import Link from "next/link";

import SuccessClient from "./SuccessClient";
import { Button } from "@/components/ui/button";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface PageProps {
  params: { projectId: string };
  searchParams: {
    paymentKey?: string;
    orderId?: string; // toss orderId (토스가 successUrl 에 append)
    amount?: string;
    ourOrderId?: string; // 우리 내부 orders.id (OrderForm 이 successUrl 에 미리 첨부)
  };
}

/**
 * /order/[projectId]/success
 *
 *   토스 successUrl 콜백 — query 에 paymentKey/orderId(=tossOrderId)/amount.
 *   클라에서 /api/payments/confirm 호출. 성공 시 마이페이지로 안내.
 *
 *   (서버 confirm 도 가능하지만 인증 쿠키/토큰 새로고침 측면에서 클라 호출이 단순.)
 */
export default function OrderSuccessPage({ params, searchParams }: PageProps) {
  const paymentKey = searchParams.paymentKey ?? "";
  const tossOrderId = searchParams.orderId ?? "";
  const amount = Number(searchParams.amount ?? "0");
  const ourOrderId = searchParams.ourOrderId ?? "";

  if (!paymentKey || !tossOrderId || !amount || !ourOrderId) {
    return (
      <div className="container py-10">
        <div className="mx-auto max-w-xl rounded-2xl border bg-card p-6 text-center">
          <h1 className="font-display text-xl font-semibold">잘못된 접근</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            결제 콜백 정보가 누락되었습니다.
          </p>
          <div className="mt-4 flex justify-center gap-2">
            <Button asChild variant="outline">
              <Link href={`/order/${params.projectId}`}>주문서로 돌아가기</Link>
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="container py-10">
      <SuccessClient
        projectId={params.projectId}
        orderId={ourOrderId}
        paymentKey={paymentKey}
        tossOrderId={tossOrderId}
        amount={amount}
      />
    </div>
  );
}

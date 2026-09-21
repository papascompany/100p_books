import { XCircle } from "lucide-react";
import Link from "next/link";

import FailPendingOrderNotice from "./FailPendingOrderNotice";
import { Button } from "@/components/ui/button";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface PageProps {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{
    code?: string;
    message?: string;
    orderId?: string;
    ourOrderId?: string;
  }>;
}

/**
 * /order/[projectId]/fail
 *   토스 failUrl 콜백. query 에 code/message (+ OrderForm 이 붙인 ourOrderId).
 *   대기 주문은 자동 취소하지 않는다 — 재시도 시 주문서 재사용, 명시적 취소 버튼, 24h 만료 cron (DEBT-6).
 */
export default async function OrderFailPage(props: PageProps) {
  const searchParams = await props.searchParams;
  const params = await props.params;
  return (
    <div className="container py-10">
      <div className="mx-auto max-w-xl rounded-2xl border bg-card p-8 text-center">
        <XCircle className="mx-auto h-10 w-10 text-destructive" />
        <h1 className="mt-4 font-display text-xl font-semibold">
          결제에 실패했습니다
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {searchParams.message ?? "결제가 정상적으로 처리되지 않았습니다."}
        </p>
        {searchParams.code ? (
          <p className="mt-1 text-xs text-muted-foreground/80">
            오류 코드: {searchParams.code}
          </p>
        ) : null}
        <FailPendingOrderNotice orderId={searchParams.ourOrderId} />
        <div className="mt-5 flex justify-center gap-2">
          <Button asChild variant="outline">
            <Link href={`/order/${params.projectId}`}>다시 시도</Link>
          </Button>
          <Button asChild>
            <Link href="/mypage/orders">주문 내역</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}

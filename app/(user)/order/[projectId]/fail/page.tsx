import { Undo2, XCircle } from "lucide-react";
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
/** 사용자가 결제창을 직접 닫은 경우의 토스 code — 실패가 아니라 취소로 보여준다. */
const USER_CANCEL_CODES = new Set(["PAY_PROCESS_CANCELED", "USER_CANCEL"]);

export default async function OrderFailPage(props: PageProps) {
  const searchParams = await props.searchParams;
  const params = await props.params;
  const userCancelled = USER_CANCEL_CODES.has(searchParams.code ?? "");
  return (
    <div className="container py-10">
      <div className="mx-auto max-w-xl rounded-2xl border bg-card p-8 text-center">
        {userCancelled ? (
          <>
            <Undo2 className="mx-auto h-10 w-10 text-muted-foreground" aria-hidden />
            <h1 className="mt-4 font-display text-xl font-semibold">결제를 취소했어요</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              결제창을 닫아 결제가 진행되지 않았어요. 준비되면 다시 결제해 주세요.
            </p>
          </>
        ) : (
          <>
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
          </>
        )}
        <FailPendingOrderNotice
          orderId={searchParams.ourOrderId}
          retryLabel={userCancelled ? "다시 결제하기" : "다시 시도"}
        />
        <div className="mt-5 flex justify-center gap-2">
          {userCancelled ? (
            <>
              <Button asChild variant="coral">
                <Link href={`/order/${params.projectId}`}>다시 결제하기</Link>
              </Button>
              <Button asChild variant="outline">
                <Link href="/mypage/orders">주문 내역</Link>
              </Button>
            </>
          ) : (
            <>
              <Button asChild variant="outline">
                <Link href={`/order/${params.projectId}`}>다시 시도</Link>
              </Button>
              <Button asChild>
                <Link href="/mypage/orders">주문 내역</Link>
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

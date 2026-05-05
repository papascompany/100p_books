import { XCircle } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface PageProps {
  params: { projectId: string };
  searchParams: {
    code?: string;
    message?: string;
    orderId?: string;
    ourOrderId?: string;
  };
}

/**
 * /order/[projectId]/fail
 *   토스 failUrl 콜백. query 에 code/message.
 */
export default function OrderFailPage({ params, searchParams }: PageProps) {
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

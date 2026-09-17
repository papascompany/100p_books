"use client";

import ErrorFallback, { type RouteError } from "@/components/errors/ErrorFallback";

/**
 * 주문·결제 결과 화면 오류 경계.
 * 결제 직후(success/fail) 화면에서 예외가 나면 사용자는 결제됐는지 모른다 —
 * 다시 결제하기 전에 주문 내역부터 확인하도록 안내한다(중복 결제 방지).
 */
export default function OrderError({
  error,
  reset,
}: {
  error: RouteError;
  reset: () => void;
}) {
  return (
    <ErrorFallback
      scope="order"
      error={error}
      reset={reset}
      title="주문 화면에 문제가 생겼어요"
      description="이미 결제를 진행했다면 다시 결제하기 전에 주문 내역에서 결제 상태를 먼저 확인해 주세요."
      primaryLink={{ href: "/mypage/orders", label: "주문 내역 확인" }}
      secondaryLink={{ href: "/", label: "홈으로 가기" }}
    />
  );
}

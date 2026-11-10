import { buildAmountLines, type AmountLinesInput } from "@/lib/orders/amount-lines";
import { cn } from "@/lib/utils";

/**
 * 주문 금액 내역 공용 표기 — 주문서·결제 완료·주문 상세(UX P15).
 * 훅이 없어 서버·클라이언트 컴포넌트 어디서나 쓸 수 있다. `<dl>` 안에 넣는다.
 *
 * - `variant="summary"`(주문서): 최종 금액을 강조 박스로 크게.
 * - `variant="compact"`(완료·상세): 같은 줄 구성을 작은 크기로.
 */
export default function OrderAmountLines(props: {
  input: AmountLinesInput;
  variant?: "summary" | "compact";
}) {
  const variant = props.variant ?? "compact";
  const lines = buildAmountLines(props.input);
  return (
    <>
      {lines.map((line) => {
        if (line.kind === "total") {
          return variant === "summary" ? (
            <div
              key={line.key}
              className="mt-2 flex items-baseline justify-between rounded-lg border-t border-border bg-coral-50 px-3 py-2 dark:bg-coral-950/20"
            >
              <dt className="text-sm font-semibold text-ink">{line.label}</dt>
              <dd className="font-display text-2xl font-bold tracking-tight text-coral-700 dark:text-coral-300">
                {line.value}
              </dd>
            </div>
          ) : (
            <div
              key={line.key}
              className="flex items-baseline justify-between gap-3 border-t border-border pt-2 text-sm"
            >
              <dt className="font-semibold text-foreground">{line.label}</dt>
              <dd className="text-right font-semibold text-foreground">{line.value}</dd>
            </div>
          );
        }
        return (
          <div
            key={line.key}
            className={cn(
              "flex items-baseline justify-between gap-3 text-sm",
              line.kind === "subtotal" && "border-t border-border pt-2",
            )}
          >
            <dt className="text-muted-foreground">{line.label}</dt>
            <dd
              className={cn(
                "text-right",
                line.kind === "minus"
                  ? "font-semibold text-coral-600 dark:text-coral-400"
                  : "text-foreground",
              )}
            >
              {line.value}
            </dd>
          </div>
        );
      })}
    </>
  );
}

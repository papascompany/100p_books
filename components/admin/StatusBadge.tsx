import type { OrderStatus } from "@/lib/db/types";
import { ORDER_STATUS_BADGE, ORDER_STATUS_LABEL } from "@/lib/orders/state";
import { cn } from "@/lib/utils";

export default function StatusBadge({
  status,
  className,
}: {
  status: OrderStatus;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium",
        ORDER_STATUS_BADGE[status],
        className,
      )}
    >
      {ORDER_STATUS_LABEL[status]}
    </span>
  );
}

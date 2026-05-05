import { cn } from "@/lib/utils";

/**
 * 관리자 대시보드 통계 카드.
 * 살짝 그라디언트 배경으로 인스타 감성 유지.
 */
export interface StatCardProps {
  label: string;
  value: string | number;
  hint?: string;
  /** 그라디언트 톤. */
  tone?: "rose" | "sky" | "amber" | "violet" | "emerald";
}

const TONE: Record<NonNullable<StatCardProps["tone"]>, string> = {
  rose: "from-rose-50 via-rose-100/40 to-orange-50",
  sky: "from-sky-50 via-sky-100/40 to-indigo-50",
  amber: "from-amber-50 via-orange-100/30 to-rose-50",
  violet: "from-violet-50 via-purple-100/40 to-fuchsia-50",
  emerald: "from-emerald-50 via-teal-100/40 to-cyan-50",
};

export default function StatCard({
  label,
  value,
  hint,
  tone = "rose",
}: StatCardProps) {
  return (
    <div
      className={cn(
        "rounded-2xl border bg-gradient-to-br p-5 shadow-soft",
        TONE[tone],
      )}
    >
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="mt-2 font-display text-3xl font-semibold tracking-tight">
        {value}
      </p>
      {hint ? (
        <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

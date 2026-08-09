import { getLaunchStatus, type LaunchItemStatus } from "@/lib/admin/launch-status";
import { cn } from "@/lib/utils";

const DOT: Record<LaunchItemStatus, string> = {
  ok: "bg-emerald-500",
  warn: "bg-amber-500",
  off: "bg-red-500",
};

const TEXT: Record<LaunchItemStatus, string> = {
  ok: "정상",
  warn: "주의",
  off: "꺼짐",
};

/**
 * 서비스 런치 체크 카드 (RSC).
 * env 스위치·필수 데이터 상태를 보여주고, 조치 절차는 레포의
 * docs/LAUNCH-RUNBOOK.md 섹션 번호로 안내한다.
 */
export default async function LaunchChecklist() {
  const items = await getLaunchStatus();
  const blockers = items.filter((i) => i.blocking && i.status !== "ok");

  return (
    <section>
      <div className="mb-2 flex items-baseline justify-between">
        <h2 className="text-base font-semibold">서비스 런치 체크</h2>
        <span
          className={cn(
            "text-xs font-medium",
            blockers.length === 0 ? "text-emerald-600" : "text-red-600",
          )}
        >
          {blockers.length === 0
            ? "차단 항목 없음 — 서비스 가능"
            : `차단 ${blockers.length}건`}
        </span>
      </div>
      <ul className="divide-y rounded-2xl border bg-card shadow-soft">
        {items.map((it) => (
          <li
            key={it.key}
            className="flex items-center justify-between gap-3 px-4 py-2.5"
          >
            <div className="flex min-w-0 items-center gap-2.5">
              <span
                aria-hidden
                className={cn("size-2 shrink-0 rounded-full", DOT[it.status])}
              />
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">
                  {it.label}
                  {it.blocking ? (
                    <span className="ml-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                      필수
                    </span>
                  ) : null}
                </p>
                {it.status !== "ok" ? (
                  <p className="truncate text-xs text-muted-foreground">
                    {it.impact} · 조치: LAUNCH-RUNBOOK {it.runbook}
                  </p>
                ) : null}
              </div>
            </div>
            <span
              className={cn(
                "shrink-0 text-xs font-semibold",
                it.status === "ok"
                  ? "text-emerald-600"
                  : it.status === "warn"
                    ? "text-amber-600"
                    : "text-red-600",
              )}
            >
              {TEXT[it.status]}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

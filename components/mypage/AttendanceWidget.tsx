"use client";

import { CalendarDays, Check, Loader2 } from "lucide-react";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/use-toast";

// canvas-confetti: 설치됨 (pnpm add canvas-confetti @types/canvas-confetti)
import type confettiType from "canvas-confetti";
type ConfettiModule = { default: typeof confettiType };

interface AttendanceData {
  month: string;
  checkedDates: string[];
  totalThisMonth: number;
  totalAllTime: number;
}

interface CheckResponse {
  alreadyChecked: boolean;
  checkedDate: string;
  totalThisMonth: number;
  totalAllTime: number;
  pointsAwarded: number;
  tenDayBonus: boolean;
}

/**
 * KST(UTC+9) 기준 오늘 날짜를 YYYY-MM-DD 형식으로 반환.
 */
function kstTodayStr(): string {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/**
 * 해당 월(YYYY-MM)의 1일부터 말일까지 날짜 배열 생성.
 * 주 시작: 일요일 — 앞부분은 null 패딩.
 */
function buildCalendarDays(month: string): (string | null)[] {
  const parts = month.split("-").map(Number);
  const y = parts[0] ?? new Date().getFullYear();
  const m = parts[1] ?? new Date().getMonth() + 1;
  const firstDay = new Date(y, m - 1, 1);
  const daysInMonth = new Date(y, m, 0).getDate();
  const startOffset = firstDay.getDay(); // 0=일, 6=토

  const cells: (string | null)[] = Array<null>(startOffset).fill(null);
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push(`${month}-${String(d).padStart(2, "0")}`);
  }
  // 마지막 행 빈 칸 채우기 (7의 배수로 맞춤)
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

const DAY_LABELS = ["일", "월", "화", "수", "목", "금", "토"];

export default function AttendanceWidget() {
  const today = kstTodayStr();
  const currentMonth = today.slice(0, 7); // YYYY-MM

  const [data, setData] = React.useState<AttendanceData | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [checking, setChecking] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // 데이터 로드
  React.useEffect(() => {
    let mounted = true;
    fetch(`/api/attendance/me?month=${currentMonth}`)
      .then((r) => r.json() as Promise<{ ok: boolean; data: AttendanceData }>)
      .then((json) => {
        if (!mounted) return;
        if (json.ok) {
          setData(json.data);
        } else {
          setError("출석 정보를 불러오지 못했습니다.");
        }
      })
      .catch(() => {
        if (mounted) setError("네트워크 오류가 발생했습니다.");
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [currentMonth]);

  const checkedSet = React.useMemo(
    () => new Set(data?.checkedDates ?? []),
    [data],
  );
  const todayChecked = checkedSet.has(today);
  const calendarDays = React.useMemo(
    () => buildCalendarDays(currentMonth),
    [currentMonth],
  );

  async function handleCheck() {
    if (todayChecked || checking) return;

    // 낙관적 업데이트
    setChecking(true);
    if (data) {
      const optimistic: AttendanceData = {
        ...data,
        checkedDates: [...data.checkedDates, today].sort(),
        totalThisMonth: data.totalThisMonth + 1,
        totalAllTime: data.totalAllTime + 1,
      };
      setData(optimistic);
    }

    try {
      const res = await fetch("/api/attendance/check", { method: "POST" });
      const json = (await res.json()) as { ok: boolean; data: CheckResponse; error?: string };

      if (!json.ok) {
        // 롤백
        setData((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            checkedDates: prev.checkedDates.filter((d) => d !== today),
            totalThisMonth: prev.totalThisMonth - 1,
            totalAllTime: prev.totalAllTime - 1,
          };
        });
        toast({
          variant: "destructive",
          title: "출석 실패",
          description: json.error ?? "잠시 후 다시 시도해 주세요.",
        });
        return;
      }

      const result = json.data;

      // 서버 응답으로 정확히 업데이트
      setData((prev) => {
        if (!prev) return prev;
        const newCheckedDates = result.alreadyChecked
          ? prev.checkedDates
          : [...prev.checkedDates.filter((d) => d !== today), today].sort();
        return {
          ...prev,
          checkedDates: newCheckedDates,
          totalThisMonth: result.totalThisMonth,
          totalAllTime: result.totalAllTime,
        };
      });

      if (result.alreadyChecked) {
        toast({
          variant: "default",
          title: "오늘 이미 출석했습니다",
          description: `이번 달 ${result.totalThisMonth}일 출석`,
        });
        return;
      }

      // 성공 토스트
      const bonusDesc = result.tenDayBonus
        ? `+${result.pointsAwarded}P 적립 (10일 달성 보너스 +500P 포함!)`
        : result.pointsAwarded > 0
          ? `+${result.pointsAwarded}P 적립`
          : undefined;

      toast({
        variant: "success",
        title: "출석 완료!",
        description: bonusDesc ?? `이번 달 ${result.totalThisMonth}일째 출석`,
      });

      // confetti 애니메이션 (패키지 없어도 빌드 에러 없도록 dynamic import)
      try {
        const mod = await import("canvas-confetti") as ConfettiModule;
        mod.default({
          particleCount: 80,
          spread: 70,
          origin: { y: 0.6 },
          colors: ["#3b82f6", "#60a5fa", "#93c5fd", "#fbbf24", "#f472b6"],
        });
      } catch {
        // canvas-confetti 미설치 시 무시
      }
    } catch {
      // 낙관적 업데이트 롤백
      setData((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          checkedDates: prev.checkedDates.filter((d) => d !== today),
          totalThisMonth: prev.totalThisMonth - 1,
          totalAllTime: prev.totalAllTime - 1,
        };
      });
      toast({
        variant: "destructive",
        title: "출석 실패",
        description: "네트워크 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.",
      });
    } finally {
      setChecking(false);
    }
  }

  // ── 로딩 상태 ─────────────────────────────────────────────
  if (loading) {
    return (
      <div className="rounded-2xl border bg-card p-5">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          출석 정보를 불러오는 중...
        </div>
      </div>
    );
  }

  // ── 에러 상태 ─────────────────────────────────────────────
  if (error) {
    return (
      <div className="rounded-2xl border bg-card p-5">
        <p className="text-sm text-muted-foreground">{error}</p>
      </div>
    );
  }

  // ── 정상 렌더 ─────────────────────────────────────────────
  const [year, monthNum] = currentMonth.split("-");
  const monthLabel = `${year}년 ${Number(monthNum)}월`;

  return (
    <section
      className="rounded-2xl border bg-card p-5 space-y-5"
      aria-label="출석체크"
    >
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <CalendarDays className="h-5 w-5 text-blue-500" aria-hidden />
          <h2 className="font-semibold text-base">출석체크</h2>
        </div>
        <span className="text-xs text-muted-foreground">{monthLabel}</span>
      </div>

      {/* 캘린더 */}
      <div role="grid" aria-label={`${monthLabel} 출석 캘린더`}>
        {/* 요일 헤더 */}
        <div className="grid grid-cols-7 mb-1" role="row">
          {DAY_LABELS.map((d) => (
            <div
              key={d}
              role="columnheader"
              className="text-center text-xs text-muted-foreground py-1 font-medium"
            >
              {d}
            </div>
          ))}
        </div>

        {/* 날짜 셀 */}
        <div className="grid grid-cols-7 gap-y-1">
          {calendarDays.map((dateStr, idx) => {
            if (!dateStr) {
              return (
                <div key={`empty-${idx}`} role="gridcell" aria-hidden />
              );
            }

            const dayNum = Number(dateStr.slice(8));
            const isToday = dateStr === today;
            const isChecked = checkedSet.has(dateStr);
            const isFuture = dateStr > today;

            return (
              <div
                key={dateStr}
                role="gridcell"
                aria-label={
                  isChecked
                    ? `${dayNum}일 출석 완료`
                    : isToday
                      ? `${dayNum}일 오늘`
                      : isFuture
                        ? `${dayNum}일`
                        : `${dayNum}일 미출석`
                }
                className="flex justify-center py-0.5"
              >
                <div
                  className={[
                    "flex h-9 w-9 items-center justify-center rounded-full text-sm font-medium select-none transition-colors",
                    isChecked
                      ? "bg-blue-500 text-white"
                      : isToday
                        ? "border-2 border-blue-500 text-blue-600 dark:text-blue-400"
                        : isFuture
                          ? "text-muted-foreground/30"
                          : "border border-dashed border-border text-muted-foreground",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                >
                  {isChecked ? (
                    <Check className="h-4 w-4" aria-hidden />
                  ) : (
                    <span>{dayNum}</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 통계 */}
      <div className="flex gap-4 text-sm text-muted-foreground border-t border-border/60 pt-4">
        <span>
          이번달{" "}
          <span className="font-semibold text-foreground">
            {data?.totalThisMonth ?? 0}일
          </span>{" "}
          출석
        </span>
        <span className="text-border">|</span>
        <span>
          누적{" "}
          <span className="font-semibold text-foreground">
            {data?.totalAllTime ?? 0}일
          </span>{" "}
          출석
        </span>
      </div>

      {/* 출석하기 버튼 */}
      <Button
        type="button"
        className={[
          "w-full h-11 rounded-lg text-sm font-semibold transition-all",
          todayChecked
            ? "bg-muted text-muted-foreground cursor-default"
            : "bg-blue-500 hover:bg-blue-600 active:bg-blue-700 text-white shadow-sm",
        ]
          .filter(Boolean)
          .join(" ")}
        disabled={todayChecked || checking}
        onClick={() => void handleCheck()}
        aria-label={todayChecked ? "오늘 이미 출석했습니다" : "오늘 출석하기"}
      >
        {checking ? (
          <span className="flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            출석 중...
          </span>
        ) : todayChecked ? (
          <span className="flex items-center gap-2">
            <Check className="h-4 w-4" aria-hidden />
            오늘 이미 출석했습니다
          </span>
        ) : (
          "출석하기"
        )}
      </Button>

      {/* 포인트 안내 */}
      {!todayChecked && (
        <p className="text-xs text-center text-muted-foreground -mt-2">
          출석 시 <span className="font-semibold text-foreground">+100P</span> 적립 ·
          10일 달성 시 추가 <span className="font-semibold text-foreground">+500P</span>
        </p>
      )}
    </section>
  );
}

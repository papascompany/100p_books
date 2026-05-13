"use client";

import {
  ArrowDownRight,
  ArrowUpRight,
  Coins,
  Loader2,
  RefreshCw,
} from "lucide-react";
import Link from "next/link";
import * as React from "react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

const KRW = new Intl.NumberFormat("ko-KR");

interface LedgerRow {
  id: string;
  amount: number;
  reason: string;
  label: string;
  refType: string | null;
  refId: string | null;
  balanceAfter: number;
  memo: string | null;
  createdAt: string;
}

interface PointsResponse {
  balance: number;
  updatedAt: string | null;
  ledger: LedgerRow[];
  totals: { earned: number; spent: number };
}

function formatRelativeDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const now = Date.now();
  const diffMin = Math.floor((now - d.getTime()) / 60000);
  if (diffMin < 1) return "방금 전";
  if (diffMin < 60) return `${diffMin}분 전`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}시간 전`;
  // 그 이상은 YYYY.MM.DD
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")}`;
}

interface PointHistoryCardProps {
  /** 가져올 ledger 행 수 (기본 20, 최대 200). */
  limit?: number;
  /** "전체 보기" 링크 노출 여부 (기본 false). */
  showViewAll?: boolean;
}

export default function PointHistoryCard({
  limit = 20,
  showViewAll = false,
}: PointHistoryCardProps = {}) {
  const [data, setData] = React.useState<PointsResponse | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/points?limit=${limit}`, { cache: "no-store" });
      const json = (await res.json()) as {
        ok: boolean;
        data?: PointsResponse;
        error?: string;
      };
      if (!json.ok || !json.data) {
        setError(json.error ?? "포인트 내역을 불러오지 못했어요.");
        return;
      }
      setData(json.data);
    } catch {
      setError("네트워크 오류가 발생했습니다.");
    } finally {
      setLoading(false);
    }
  }, [limit]);

  React.useEffect(() => {
    void load();
  }, [load]);

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0">
        <div>
          <CardTitle className="flex items-center gap-2 text-base">
            <Coins className="size-5 text-amber-500" aria-hidden />
            포인트 내역
          </CardTitle>
          <CardDescription className="mt-1.5">
            적립과 사용 이력을 한 눈에 확인하세요.
          </CardDescription>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void load()}
          disabled={loading}
          aria-label="포인트 내역 새로고침"
          className="h-8 px-2 text-xs"
        >
          <RefreshCw
            className={`size-3.5 ${loading ? "animate-spin" : ""}`}
            aria-hidden
          />
          <span className="hidden sm:inline">새로고침</span>
        </Button>
      </CardHeader>
      <CardContent>
        {/* 잔액 + 누적 통계 */}
        {data ? (
          <div className="mb-4 grid grid-cols-3 gap-2 rounded-xl border bg-muted/40 p-3 text-center">
            <div>
              <p className="text-[11px] text-muted-foreground">현재 잔액</p>
              <p className="mt-0.5 text-base font-semibold tabular-nums">
                {KRW.format(data.balance)}P
              </p>
            </div>
            <div>
              <p className="text-[11px] text-muted-foreground">누적 적립</p>
              <p className="mt-0.5 text-base font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
                +{KRW.format(data.totals.earned)}P
              </p>
            </div>
            <div>
              <p className="text-[11px] text-muted-foreground">누적 사용</p>
              <p className="mt-0.5 text-base font-semibold tabular-nums text-rose-600 dark:text-rose-400">
                -{KRW.format(data.totals.spent)}P
              </p>
            </div>
          </div>
        ) : null}

        {loading && !data ? (
          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden /> 불러오는 중...
          </div>
        ) : error ? (
          <p className="py-6 text-center text-sm text-muted-foreground">{error}</p>
        ) : data && data.ledger.length > 0 ? (
          <ul className="divide-y divide-border/60">
            {data.ledger.map((row) => {
              const isCredit = row.amount > 0;
              return (
                <li
                  key={row.id}
                  className="flex items-start justify-between gap-3 py-3"
                >
                  <div className="flex min-w-0 items-start gap-2">
                    <div
                      className={`mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full ${
                        isCredit
                          ? "bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400"
                          : "bg-rose-50 text-rose-600 dark:bg-rose-950/40 dark:text-rose-400"
                      }`}
                      aria-hidden
                    >
                      {isCredit ? (
                        <ArrowUpRight className="size-3.5" />
                      ) : (
                        <ArrowDownRight className="size-3.5" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">
                        {row.label}
                      </p>
                      {row.memo ? (
                        <p className="truncate text-xs text-muted-foreground">
                          {row.memo}
                        </p>
                      ) : null}
                      <p className="mt-0.5 text-[11px] text-muted-foreground">
                        {formatRelativeDate(row.createdAt)}
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p
                      className={`text-sm font-semibold tabular-nums ${
                        isCredit
                          ? "text-emerald-600 dark:text-emerald-400"
                          : "text-rose-600 dark:text-rose-400"
                      }`}
                    >
                      {isCredit ? "+" : ""}
                      {KRW.format(row.amount)}P
                    </p>
                    <p className="text-[11px] text-muted-foreground tabular-nums">
                      잔액 {KRW.format(row.balanceAfter)}P
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="py-6 text-center text-sm text-muted-foreground">
            아직 포인트 내역이 없어요. 출석체크와 친구 추천으로 적립을 시작해보세요!
          </p>
        )}

        {showViewAll && data && data.ledger.length >= limit ? (
          <div className="mt-3 border-t pt-3 text-center">
            <Link
              href="/mypage/points"
              className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              전체 내역 보기
              <span aria-hidden>→</span>
            </Link>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

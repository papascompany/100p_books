"use client";

import { Coins, Loader2 } from "lucide-react";
import * as React from "react";

const KRW = new Intl.NumberFormat("ko-KR");

interface PointsData {
  balance: number;
  updatedAt: string | null;
}

export default function PointsBadge() {
  const [points, setPoints] = React.useState<PointsData | null>(null);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    let mounted = true;
    fetch("/api/points")
      .then((r) => r.json() as Promise<{ ok: boolean; data: PointsData }>)
      .then((json) => {
        if (mounted && json.ok) setPoints(json.data);
      })
      .catch(() => undefined)
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, []);

  if (loading) {
    return (
      <div className="inline-flex items-center gap-1.5 rounded-full border bg-muted/40 px-3 py-1.5 text-xs text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
        로딩 중
      </div>
    );
  }

  const balance = points?.balance ?? 0;

  return (
    <div
      className="inline-flex items-center gap-1.5 rounded-full border bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-800 dark:bg-amber-950/40 dark:text-amber-200"
      aria-label={`보유 포인트 ${KRW.format(balance)}P`}
    >
      <Coins className="h-3.5 w-3.5" aria-hidden />
      {KRW.format(balance)}P
    </div>
  );
}

"use client";

import { Check, Copy, Gift, Loader2, Users } from "lucide-react";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/use-toast";

interface ReferralData {
  referralCode: string;
  referralUrl: string;
  totalReferrals: number;
  totalRewarded: number;
}

interface StatsData {
  totalReferrals: number;
  totalRewarded: number;
  totalPending: number;
  totalEarnedPoints: number;
  pointBalance: number;
  rewardPerReferral: number;
}

const KRW = new Intl.NumberFormat("ko-KR");

export default function ReferralCard() {
  const [referral, setReferral] = React.useState<ReferralData | null>(null);
  const [stats, setStats] = React.useState<StatsData | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [copied, setCopied] = React.useState(false);

  React.useEffect(() => {
    let mounted = true;
    async function load() {
      try {
        const [codeRes, statsRes] = await Promise.all([
          fetch("/api/referrals/my-code"),
          fetch("/api/referrals/stats"),
        ]);
        const [codeJson, statsJson] = await Promise.all([
          codeRes.json() as Promise<{ ok: boolean; data: ReferralData }>,
          statsRes.json() as Promise<{ ok: boolean; data: StatsData }>,
        ]);
        if (mounted && codeJson.ok) setReferral(codeJson.data);
        if (mounted && statsJson.ok) setStats(statsJson.data);
      } catch {
        // 네트워크 오류는 silent — 로딩 실패 UI 에서 처리
      } finally {
        if (mounted) setLoading(false);
      }
    }
    void load();
    return () => {
      mounted = false;
    };
  }, []);

  async function copyLink() {
    if (!referral?.referralUrl) return;
    try {
      await navigator.clipboard.writeText(referral.referralUrl);
      setCopied(true);
      toast({ variant: "success", title: "복사 완료", description: "추천 링크가 클립보드에 복사됐어요." });
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast({ variant: "destructive", title: "복사 실패", description: "수동으로 링크를 복사해 주세요." });
    }
  }

  if (loading) {
    return (
      <div className="rounded-2xl border bg-card p-5">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          추천 정보를 불러오는 중...
        </div>
      </div>
    );
  }

  if (!referral) {
    return (
      <div className="rounded-2xl border bg-card p-5">
        <p className="text-sm text-muted-foreground">추천 링크를 불러오지 못했습니다.</p>
      </div>
    );
  }

  const rewardPerReferral = stats?.rewardPerReferral ?? 5000;

  return (
    <div className="rounded-2xl border bg-card p-5 space-y-5">
      {/* 헤더 */}
      <div className="flex items-center gap-2">
        <Gift className="h-5 w-5 text-rose-500" aria-hidden />
        <h2 className="font-semibold text-base">내 추천 링크</h2>
      </div>

      {/* 설명 */}
      <p className="text-sm text-muted-foreground leading-relaxed">
        아래 링크로 친구가 가입하고 첫 결제를 완료하면 나에게{" "}
        <span className="font-semibold text-rose-600 dark:text-rose-400">
          {KRW.format(rewardPerReferral)}포인트
        </span>
        가 적립돼요.
      </p>

      {/* 링크 복사 */}
      <div className="flex gap-2">
        <div
          className="flex-1 min-w-0 rounded-lg border bg-muted/40 px-3 py-2.5 text-sm font-mono text-muted-foreground truncate select-all"
          aria-label="추천 링크"
        >
          {referral.referralUrl}
        </div>
        <Button
          type="button"
          variant="outline"
          size="default"
          onClick={() => void copyLink()}
          aria-label="추천 링크 복사"
          className="shrink-0"
        >
          {copied ? (
            <Check className="h-4 w-4 text-emerald-600" aria-hidden />
          ) : (
            <Copy className="h-4 w-4" aria-hidden />
          )}
          {copied ? "복사됨" : "복사"}
        </Button>
      </div>

      {/* 코드 표시 */}
      <div className="text-xs text-muted-foreground">
        추천 코드:{" "}
        <span className="font-mono font-semibold tracking-wider text-foreground">
          {referral.referralCode}
        </span>
      </div>

      {/* 통계 */}
      <div className="grid grid-cols-3 gap-3 pt-1 border-t border-border/60">
        <StatItem
          icon={<Users className="h-4 w-4" aria-hidden />}
          label="총 추천인"
          value={`${referral.totalReferrals}명`}
        />
        <StatItem
          icon={<Check className="h-4 w-4 text-emerald-600" aria-hidden />}
          label="보상 완료"
          value={`${referral.totalRewarded}명`}
        />
        <StatItem
          icon={<Gift className="h-4 w-4 text-rose-500" aria-hidden />}
          label="누적 포인트"
          value={`${KRW.format((stats?.totalEarnedPoints) ?? 0)}P`}
        />
      </div>
    </div>
  );
}

function StatItem(props: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="flex flex-col items-center gap-1 rounded-xl bg-muted/40 p-3 text-center">
      <div className="text-muted-foreground">{props.icon}</div>
      <span className="font-semibold text-sm">{props.value}</span>
      <span className="text-xs text-muted-foreground">{props.label}</span>
    </div>
  );
}

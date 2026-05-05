import Link from "next/link";
import { redirect } from "next/navigation";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { requireUser } from "@/lib/auth/session";
import { createServerSupabase } from "@/lib/db/server";

import DeleteAccountCard from "./DeleteAccountCard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const DT = new Intl.DateTimeFormat("ko-KR", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const BLOCKING_STATUSES = ["pending", "paid", "in_production", "shipped"];

export default async function AccountPage() {
  let user;
  try {
    user = await requireUser();
  } catch {
    redirect("/login?next=/mypage/account");
  }

  const supabase = createServerSupabase();
  const [{ data: profile }, { count: orderCount }, { count: blockingCount }] =
    await Promise.all([
      supabase
        .from("profiles")
        .select(
          "email, display_name, created_at, terms_agreed_at, privacy_agreed_at",
        )
        .eq("id", user.id)
        .maybeSingle(),
      supabase
        .from("orders")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user.id),
      supabase
        .from("orders")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user.id)
        .in("status", BLOCKING_STATUSES),
    ]);

  const email = user.email ?? profile?.email ?? "";
  const createdAt = profile?.created_at
    ? DT.format(new Date(profile.created_at))
    : "-";

  return (
    <div className="container mx-auto max-w-3xl px-4 py-10">
      <div className="mb-2 text-sm text-muted-foreground">
        <Link href="/mypage" className="hover:text-foreground">
          마이페이지
        </Link>
        <span className="mx-1">·</span>
        <span>계정 관리</span>
      </div>
      <h1 className="font-display text-3xl font-semibold tracking-tight md:text-4xl">
        계정 관리
      </h1>

      <div className="mt-8 grid gap-6">
        {/* 프로필 카드 */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">프로필</CardTitle>
            <CardDescription>
              로그인 정보와 가입일을 확인하세요.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <ProfileRow label="이메일" value={email || "-"} />
            <ProfileRow label="가입일" value={createdAt} />
            <ProfileRow label="총 주문" value={`${orderCount ?? 0}건`} />
            <ProfileRow
              label="이용약관 동의"
              value={
                profile?.terms_agreed_at
                  ? DT.format(new Date(profile.terms_agreed_at))
                  : "기록 없음"
              }
            />
            <ProfileRow
              label="개인정보 동의"
              value={
                profile?.privacy_agreed_at
                  ? DT.format(new Date(profile.privacy_agreed_at))
                  : "기록 없음"
              }
            />
          </CardContent>
        </Card>

        {/* 회원 탈퇴 카드 */}
        <DeleteAccountCard
          email={email}
          blockingOrderCount={blockingCount ?? 0}
        />

        <p className="text-xs text-muted-foreground">
          탈퇴 정책의 자세한 내용은{" "}
          <Link href="/privacy" className="underline">
            개인정보 처리방침
          </Link>{" "}
          및{" "}
          <Link href="/terms" className="underline">
            이용약관
          </Link>
          을 참고해 주세요.
        </p>

        <div>
          <Button asChild variant="ghost" size="sm">
            <Link href="/mypage">← 마이페이지로</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}

function ProfileRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-border/50 pb-2 last:border-b-0 last:pb-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium">{value}</span>
    </div>
  );
}

import { ChevronRight, Package, UserRound } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { requireUser } from "@/lib/auth/session";
import { createServerSupabase } from "@/lib/db/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * /mypage — 마이페이지 메뉴 그리드.
 * 주문 내역과 계정 관리 카드.
 */
export default async function MyPage() {
  let user;
  try {
    user = await requireUser();
  } catch {
    redirect("/login?next=/mypage");
  }

  const supabase = createServerSupabase();
  const { count: orderCount } = await supabase
    .from("orders")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id);

  return (
    <div className="container mx-auto max-w-3xl px-4 py-10">
      <h1 className="font-display text-3xl font-semibold tracking-tight md:text-4xl">
        마이페이지
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">
        {user.email ? `${user.email}로 로그인되어 있어요.` : "로그인되어 있어요."}
      </p>

      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        <Link href="/mypage/orders" className="group">
          <Card className="h-full transition-colors hover:border-foreground/30 hover:bg-accent/30">
            <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0">
              <div>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Package className="size-5" />
                  주문 내역
                </CardTitle>
                <CardDescription className="mt-1.5">
                  {orderCount ?? 0}건의 주문이 있어요.
                </CardDescription>
              </div>
              <ChevronRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              결제 영수증, 배송 상태, PDF 다운로드를 확인하세요.
            </CardContent>
          </Card>
        </Link>

        <Link href="/mypage/account" className="group">
          <Card className="h-full transition-colors hover:border-foreground/30 hover:bg-accent/30">
            <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0">
              <div>
                <CardTitle className="flex items-center gap-2 text-base">
                  <UserRound className="size-5" />
                  계정 관리
                </CardTitle>
                <CardDescription className="mt-1.5">
                  프로필 확인, 회원 탈퇴
                </CardDescription>
              </div>
              <ChevronRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              탈퇴 시 프로필은 익명화되며, 주문 내역은 전자상거래법에 따라
              5년간 보존됩니다.
            </CardContent>
          </Card>
        </Link>
      </div>
    </div>
  );
}

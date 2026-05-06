import {
  ChevronRight,
  Image as ImageIcon,
  Package,
  Star,
  Trash2,
  UserRound,
} from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import AttendanceWidget from "@/components/mypage/AttendanceWidget";
import PointsBadge from "@/components/mypage/PointsBadge";
import ReferralCard from "@/components/mypage/ReferralCard";
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
  const [{ count: orderCount }, { data: projectIdsRow }] = await Promise.all([
    supabase
      .from("orders")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id),
    supabase.from("projects").select("id").eq("user_id", user.id),
  ]);

  const projectIds = (projectIdsRow ?? []).map((p) => p.id);
  let activePhotoCount = 0;
  let trashCount = 0;
  if (projectIds.length > 0) {
    const [{ count: ac }, { count: tc }] = await Promise.all([
      supabase
        .from("photos")
        .select("id", { count: "exact", head: true })
        .in("project_id", projectIds)
        .is("deleted_at", null),
      supabase
        .from("photos")
        .select("id", { count: "exact", head: true })
        .in("project_id", projectIds)
        .not("deleted_at", "is", null),
    ]);
    activePhotoCount = ac ?? 0;
    trashCount = tc ?? 0;
  }

  return (
    <div className="container mx-auto max-w-3xl px-4 py-10">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">
            마이페이지
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {user.email ? `${user.email}로 로그인되어 있어요.` : "로그인되어 있어요."}
          </p>
        </div>
        <PointsBadge />
      </div>

      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        <Link href="/mypage/orders" className="group">
          <Card className="h-full transition-colors hover:border-[#111111]">
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

        <Link href="/mypage/photos" className="group">
          <Card className="h-full transition-colors hover:border-[#111111]">
            <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0">
              <div>
                <CardTitle className="flex items-center gap-2 text-base">
                  <ImageIcon className="size-5" />
                  사진 라이브러리
                </CardTitle>
                <CardDescription className="mt-1.5">
                  {activePhotoCount}장의 사진이 있어요.
                </CardDescription>
              </div>
              <ChevronRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              모든 프로젝트의 사진을 한 곳에서 관리하고 다른 프로젝트로
              옮길 수 있어요.
            </CardContent>
          </Card>
        </Link>

        <Link href="/mypage/trash" className="group">
          <Card className="h-full transition-colors hover:border-[#111111]">
            <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0">
              <div>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Trash2 className="size-5" />
                  휴지통
                </CardTitle>
                <CardDescription className="mt-1.5">
                  {trashCount}장이 휴지통에 있어요.
                </CardDescription>
              </div>
              <ChevronRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              삭제한 사진은 30일 후 영구 삭제돼요. 그 전에 복원하거나
              직접 영구 삭제할 수 있어요.
            </CardContent>
          </Card>
        </Link>

        <Link href="/mypage/account" className="group">
          <Card className="h-full transition-colors hover:border-[#111111]">
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

        <Link href="/gallery" className="group">
          <Card className="h-full transition-colors hover:border-[#111111]">
            <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0">
              <div>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Star className="size-5" />
                  후기 갤러리
                </CardTitle>
                <CardDescription className="mt-1.5">
                  다른 고객들의 포토북 후기를 확인해 보세요.
                </CardDescription>
              </div>
              <ChevronRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              별점, 사진, 텍스트 후기를 보고 나만의 포토북 제작에 영감을 받으세요.
            </CardContent>
          </Card>
        </Link>
      </div>

      {/* 출석체크 섹션 */}
      <div className="mt-8">
        <AttendanceWidget />
      </div>

      {/* 추천 링크 섹션 */}
      <div className="mt-6">
        <ReferralCard />
      </div>
    </div>
  );
}

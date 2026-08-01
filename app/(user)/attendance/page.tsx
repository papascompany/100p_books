import { redirect } from "next/navigation";

import AttendanceWidget from "@/components/mypage/AttendanceWidget";
import PointsBadge from "@/components/mypage/PointsBadge";
import { requireUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// 루트 템플릿(%s · 100p Books)이 사이트명을 붙이므로 접미사 없이 표기.
export const metadata = {
  title: "출석체크",
  description: "매일 출석체크하고 포인트를 적립하세요.",
};

export default async function AttendancePage() {
  const user = await requireUser().catch(() => null);
  if (!user) redirect("/login?next=/attendance");

  return (
    <div className="container max-w-lg py-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">출석체크</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            매일 출석하고 포인트를 적립하세요
          </p>
        </div>
        <PointsBadge />
      </div>
      <AttendanceWidget />
    </div>
  );
}

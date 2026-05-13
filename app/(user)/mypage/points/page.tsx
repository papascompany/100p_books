import Link from "next/link";
import { redirect } from "next/navigation";

import PointHistoryCard from "@/components/mypage/PointHistoryCard";
import { requireUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * /mypage/points — 포인트 거래 내역 전용 페이지.
 * /mypage 의 인라인 카드(limit=20)와 달리 최근 200건까지 노출.
 */
export default async function MyPointsPage() {
  try {
    await requireUser();
  } catch {
    redirect("/login?next=/mypage/points");
  }

  return (
    <div className="container mx-auto max-w-3xl px-4 py-10">
      <nav className="mb-3 text-xs text-muted-foreground">
        <Link href="/mypage" className="hover:text-foreground">
          ← 마이페이지
        </Link>
      </nav>

      <header className="mb-6">
        <h1 className="font-display text-2xl font-semibold tracking-tight md:text-3xl">
          포인트 내역
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          출석체크와 친구 추천으로 적립한 포인트는 주문 시 1P = 1원으로 사용할 수 있어요.
        </p>
      </header>

      <PointHistoryCard limit={200} />
    </div>
  );
}

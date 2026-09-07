import "server-only";

import { NextResponse } from "next/server";

import { createServerSupabase } from "@/lib/db/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/auth/sign-out
 *
 * - Supabase 세션 종료 → cookie 무효화.
 * - 응답은 홈으로 303 redirect (form action 호환).
 *
 * 호출처: 헤더 계정 드롭다운, 모바일 드로어, /mypage/account 로그아웃 카드,
 *         관리자 사이드바 — 모두 form action.
 */
export async function POST(req: Request) {
  // CSRF — 외부 사이트의 폼 POST 로 임의 로그아웃을 걸 수 없게 동일 출처만 허용.
  // (파괴적이진 않지만 편집 중 강제 로그아웃은 실사용 방해가 된다.)
  // 프록시 뒤에서 req.url 의 프로토콜/호스트가 어긋날 수 있으므로 host 헤더와 비교한다.
  const origin = req.headers.get("origin");
  const host = req.headers.get("host");
  if (origin && host) {
    let originHost: string | null = null;
    try {
      originHost = new URL(origin).host;
    } catch {
      originHost = null;
    }
    if (originHost !== host) {
      return new NextResponse(null, { status: 403 });
    }
  }

  const supabase = createServerSupabase();
  await supabase.auth.signOut().catch(() => {
    /* 이미 로그아웃 상태면 무시 */
  });
  const url = new URL("/", req.url);
  return NextResponse.redirect(url, { status: 303 });
}

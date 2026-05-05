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
 * 관리자 사이드바의 form action 으로도 사용된다.
 */
export async function POST(req: Request) {
  const supabase = createServerSupabase();
  await supabase.auth.signOut().catch(() => {
    /* 이미 로그아웃 상태면 무시 */
  });
  const url = new URL("/", req.url);
  return NextResponse.redirect(url, { status: 303 });
}

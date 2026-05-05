import "server-only";

import { NextResponse, type NextRequest } from "next/server";

import { createServerSupabase } from "@/lib/db/server";

/**
 * Supabase Auth 콜백 엔드포인트.
 * 매직링크 / OAuth (카카오) 에서 code 파라미터를 받아 세션을 교환한다.
 *
 * 매직링크: ?code=...&next=/some-path
 * OAuth   : ?code=...
 */
export async function GET(req: NextRequest) {
  const { searchParams, origin } = req.nextUrl;
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/";

  if (code) {
    const supabase = createServerSupabase();
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (error) {
      const url = new URL("/login", origin);
      url.searchParams.set("error", error.message);
      return NextResponse.redirect(url);
    }
  }

  // 상대 경로 허용, 외부 origin 리다이렉트 방지
  const target = next.startsWith("/") ? next : "/";
  return NextResponse.redirect(new URL(target, origin));
}

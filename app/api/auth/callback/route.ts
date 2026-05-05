import "server-only";

import { NextResponse, type NextRequest } from "next/server";

import { createAdminSupabase } from "@/lib/db/admin";
import { createServerSupabase } from "@/lib/db/server";

/**
 * Supabase Auth 콜백 엔드포인트.
 * 매직링크 / OAuth (카카오) 에서 code 파라미터를 받아 세션을 교환한다.
 *
 * 매직링크: ?code=...&next=/some-path
 * OAuth   : ?code=...
 *
 * 로그인 폼에서 약관에 동의한 후 매직링크가 발송되므로,
 * 세션 교환 직후 record_agreements RPC 로 동의 시각을 채운다 (이미 있으면 no-op).
 */
export async function GET(req: NextRequest) {
  const { searchParams, origin } = req.nextUrl;
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/";

  if (code) {
    const supabase = createServerSupabase();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);

    if (error) {
      const url = new URL("/login", origin);
      url.searchParams.set("error", error.message);
      return NextResponse.redirect(url);
    }

    // 동의 시각 기록 (best-effort, 실패해도 로그인 흐름은 진행)
    const userId = data.user?.id;
    if (userId) {
      try {
        const admin = createAdminSupabase();
        await admin.rpc("record_agreements", { p_user_id: userId });
      } catch {
        /* 무시 — 후속 /api/auth/agree 클라 호출로 보완 가능 */
      }
    }
  }

  // 상대 경로 허용, 외부 origin 리다이렉트 방지
  const target = next.startsWith("/") && !next.startsWith("//") ? next : "/";
  return NextResponse.redirect(new URL(target, origin));
}

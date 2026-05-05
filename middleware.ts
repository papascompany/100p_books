import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import type { Database } from "@/lib/db/types";

/**
 * 세션 쿠키를 새로고침하고 /admin/** · /api/admin/** 는 role=admin 을 강제한다.
 */
export async function middleware(req: NextRequest) {
  // Supabase 매직링크/OAuth 후속 ?code= 가 콜백 경로가 아닌 곳에 도착하면
  // /api/auth/callback 으로 보존하여 라우트 핸들러가 세션 교환을 수행하게 한다.
  // (Supabase Auth 가 redirect_to path 를 일관되게 strip 하는 동작에 대한 우회.)
  const codeParam = req.nextUrl.searchParams.get("code");
  if (codeParam && req.nextUrl.pathname !== "/api/auth/callback") {
    const url = req.nextUrl.clone();
    const next = url.pathname === "/" ? "/" : url.pathname;
    url.pathname = "/api/auth/callback";
    if (!url.searchParams.has("next")) {
      url.searchParams.set("next", next);
    }
    return NextResponse.redirect(url);
  }

  const res = NextResponse.next({
    request: { headers: req.headers },
  });

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // 환경변수 미설정 로컬 부트에서도 빌드가 되게끔 — 인증 검사 스킵
  if (!supabaseUrl || !supabaseAnonKey) {
    return res;
  }

  const supabase = createServerClient<Database>(supabaseUrl, supabaseAnonKey, {
    cookies: {
      get(name: string) {
        return req.cookies.get(name)?.value;
      },
      set(name: string, value: string, options: CookieOptions) {
        req.cookies.set({ name, value, ...options });
        res.cookies.set({ name, value, ...options });
      },
      remove(name: string, options: CookieOptions) {
        req.cookies.set({ name, value: "", ...options });
        res.cookies.set({ name, value: "", ...options });
      },
    },
  });

  // 세션 리프레시 (쿠키에 반영)
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = req.nextUrl;
  const isAdminPage = pathname.startsWith("/admin");
  const isAdminApi = pathname.startsWith("/api/admin");

  if (isAdminPage || isAdminApi) {
    if (!user) {
      if (isAdminApi) {
        return new NextResponse(
          JSON.stringify({ ok: false, error: { code: "UNAUTHORIZED", message: "로그인이 필요합니다." } }),
          { status: 401, headers: { "content-type": "application/json" } },
        );
      }
      const url = req.nextUrl.clone();
      url.pathname = "/login";
      url.searchParams.set("next", pathname);
      return NextResponse.redirect(url);
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();

    if (!profile || profile.role !== "admin") {
      if (isAdminApi) {
        return new NextResponse(
          JSON.stringify({ ok: false, error: { code: "FORBIDDEN", message: "관리자 권한이 필요합니다." } }),
          { status: 403, headers: { "content-type": "application/json" } },
        );
      }
      const url = req.nextUrl.clone();
      url.pathname = "/";
      return NextResponse.redirect(url);
    }
  }

  return res;
}

export const config = {
  // 정적 자산은 매칭하지 않음
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};

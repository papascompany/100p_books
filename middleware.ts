import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import type { Database } from "@/lib/db/types";

/** 친구 추천(M16-4) — ?ref=CODE 를 30일 쿠키에 저장. */
const REFERRAL_COOKIE = "referral_code";
const REFERRAL_COOKIE_MAX_AGE_SEC = 60 * 60 * 24 * 30;
const REFERRAL_CODE_REGEX = /^[A-Z0-9]{4,16}$/;

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

  // 친구 추천 코드 캡처
  //   ?ref=CODE → referral_code 쿠키 (30일).
  //   - 이미 동일 쿠키가 있으면 갱신만, 다른 코드면 덮어쓰기.
  //   - 인증 여부는 아래에서 알 수 있으므로 일단 캡처는 모든 요청에 적용.
  //     (로그인된 사용자에 대한 무시는 아래 user 확인 후 처리.)
  const refParam = req.nextUrl.searchParams.get("ref");

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

  const { pathname } = req.nextUrl;
  const isAdminPage = pathname.startsWith("/admin");
  const isAdminApi = pathname.startsWith("/api/admin");

  if (isAdminPage || isAdminApi) {
    // admin 라우트: 서버 검증 필수 (네트워크 왕복 1회 발생)
    const {
      data: { user: verifiedUser },
    } = await supabase.auth.getUser();

    // 친구 추천 코드 — admin 라우트에서는 저장하지 않음 (로그인 사용자)
    if (!verifiedUser) {
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
      .eq("id", verifiedUser.id)
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
  } else {
    // 일반 라우트: 쿠키에서 세션 읽기만 (네트워크 없음)
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const user = session?.user ?? null;

    // 친구 추천 코드 — 비로그인 사용자에 한해 쿠키 set.
    if (refParam && !user) {
      const code = refParam.trim().toUpperCase();
      if (REFERRAL_CODE_REGEX.test(code)) {
        const existing = req.cookies.get(REFERRAL_COOKIE)?.value;
        if (existing !== code) {
          res.cookies.set({
            name: REFERRAL_COOKIE,
            value: code,
            path: "/",
            maxAge: REFERRAL_COOKIE_MAX_AGE_SEC,
            sameSite: "lax",
            httpOnly: false,
            secure: process.env.NODE_ENV === "production",
          });
        }
      }
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

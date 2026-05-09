import "server-only";

import { NextResponse, type NextRequest } from "next/server";

import { createAdminSupabase } from "@/lib/db/admin";
import { createServerSupabase } from "@/lib/db/server";
import { ensureReferralCode } from "@/lib/referrals/code";

const REFERRAL_COOKIE = "referral_code";

/**
 * Supabase Auth 콜백 엔드포인트.
 * 매직링크 / OAuth (카카오) 에서 code 파라미터를 받아 세션을 교환한다.
 *
 * 매직링크: ?code=...&next=/some-path
 * OAuth   : ?code=...
 *
 * 로그인 폼에서 약관에 동의한 후 매직링크가 발송되므로,
 * 세션 교환 직후 record_agreements RPC 로 동의 시각을 채운다 (이미 있으면 no-op).
 *
 * 친구 추천 (M16-4):
 *   미들웨어가 ?ref=CODE 쿼리를 referral_code 쿠키에 저장한다.
 *   세션 교환에 성공하면:
 *     1. 본인 referral_code 발급 (멱등).
 *     2. referral_code 쿠키가 있고 본인 코드가 아니면 referrals 행 INSERT
 *        (referrer_id, referee_id=신규 사용자, reward_status='pending').
 *     3. 쿠키 제거.
 *   self-referral / 중복 등록은 DB 의 unique + check 제약으로 차단된다.
 */
export async function GET(req: NextRequest) {
  const { searchParams, origin } = req.nextUrl;
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/";

  // 상대 경로 허용, 외부 origin 리다이렉트 방지 (응답 객체 고정)
  const target = next.startsWith("/") && !next.startsWith("//") ? next : "/";
  const redirectUrl = new URL(target, origin);

  if (!code) {
    return NextResponse.redirect(redirectUrl);
  }

  const supabase = createServerSupabase();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    const url = new URL("/login", origin);
    url.searchParams.set("error", error.message);
    return NextResponse.redirect(url);
  }

  const userId = data.user?.id;
  const response = NextResponse.redirect(redirectUrl);

  if (userId) {
    const admin = createAdminSupabase();

    // 동의 시각 기록 (best-effort, 실패해도 로그인 흐름은 진행)
    try {
      await admin.rpc("record_agreements", { p_user_id: userId });
    } catch {
      /* 무시 — 후속 /api/auth/agree 클라 호출로 보완 가능 */
    }

    // OAuth 프로필 동기화 (카카오/구글 등) — display_name / avatar_url 비어있을 때만 채움.
    // 이메일 매직링크의 경우 raw_user_meta_data 가 비어있어 no-op.
    try {
      await admin.rpc("sync_oauth_profile", { p_user_id: userId });
    } catch (e) {
      console.warn(
        "[auth/callback] sync_oauth_profile 실패:",
        e instanceof Error ? e.message : String(e),
      );
    }

    // 본인 추천 코드 발급 (없으면 신규 발급)
    let myCode: string | null = null;
    try {
      const issued = await ensureReferralCode(admin, userId);
      myCode = issued.code;
    } catch (e) {
      console.warn(
        "[auth/callback] ensureReferralCode 실패:",
        e instanceof Error ? e.message : String(e),
      );
    }

    // referral_code 쿠키 처리 (가입 시 referrer 등록)
    const refCookie = req.cookies.get(REFERRAL_COOKIE)?.value?.trim();
    if (refCookie) {
      const refCode = refCookie.toUpperCase();

      // self-referral 차단
      if (myCode && refCode === myCode) {
        // noop
      } else {
        try {
          const { data: refUserId } = await admin.rpc("lookup_referral_code", {
            p_code: refCode,
          });
          if (refUserId && refUserId !== userId) {
            // 멱등: 동일 (referrer, referee) 가 이미 있으면 23505 → 무시
            const { error: insErr } = await admin.from("referrals").insert({
              referrer_id: refUserId,
              referee_id: userId,
              referral_code: refCode,
              reward_status: "pending",
            });
            if (insErr && (insErr as { code?: string }).code !== "23505") {
              console.warn(
                "[auth/callback] referrals insert 실패:",
                insErr.message,
              );
            }
          }
        } catch (e) {
          console.warn(
            "[auth/callback] lookup_referral_code 실패:",
            e instanceof Error ? e.message : String(e),
          );
        }
      }

      // 사용 여부와 무관하게 쿠키 제거 (가입 직후 재유입 방지)
      response.cookies.set({
        name: REFERRAL_COOKIE,
        value: "",
        path: "/",
        maxAge: 0,
      });
    }
  }

  return response;
}

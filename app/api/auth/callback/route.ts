import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";

import { trackFunnelEvent } from "@/lib/analytics/funnel";
import { createAdminSupabase } from "@/lib/db/admin";
import {
  PASSWORD_RECOVERY_COOKIE,
  PASSWORD_RECOVERY_MAX_AGE_SEC,
  shouldIssueRecoveryMarker,
} from "@/lib/auth/recovery";
import { safeRedirectPath } from "@/lib/auth/safe-redirect";
import { createServerSupabase } from "@/lib/db/server";
import type { Database } from "@/lib/db/types";
import { ensureReferralCode } from "@/lib/referrals/code";

const REFERRAL_COOKIE = "referral_code";

type AccountState = "active" | "deleted" | "unknown";

/**
 * profiles.deleted_at 으로 계정 상태를 판정한다.
 * 프로필 행이 아직 없으면(신규 가입 트리거 지연 등) 탈퇴가 아니므로 active.
 * 조회 실패는 unknown — 호출부가 부수효과만 건너뛴다.
 */
async function readAccountState(
  admin: SupabaseClient<Database>,
  userId: string,
): Promise<AccountState> {
  try {
    const { data, error } = await admin
      .from("profiles")
      .select("deleted_at")
      .eq("id", userId)
      .maybeSingle();
    if (error) {
      console.warn("[auth/callback] profiles.deleted_at 조회 실패:", error.message);
      return "unknown";
    }
    return data?.deleted_at ? "deleted" : "active";
  } catch (e) {
    console.warn(
      "[auth/callback] profiles.deleted_at 조회 실패:",
      e instanceof Error ? e.message : String(e),
    );
    return "unknown";
  }
}

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
 *
 * 탈퇴 계정 (DEBT-3):
 *   profiles.deleted_at 이 있으면 위 부수효과(동의 기록·프로필 동기화·가입 계측·추천)와
 *   재설정 마커를 모두 건너뛰고, 방금 만든 세션을 끊은 뒤 /login?error=account_deleted 로 보낸다.
 *   상태 조회가 실패하면(unknown) 로그인과 동의 기록만 진행하고 나머지 부수효과는 건너뛴다.
 */
export async function GET(req: NextRequest) {
  const { searchParams, origin } = req.nextUrl;
  const code = searchParams.get("code");
  // 같은 origin 경로만 허용 — 백슬래시·탭·인코딩 변형 우회 차단 (SEC-3, lib/auth/safe-redirect.ts)
  const target = safeRedirectPath(searchParams.get("next"));
  const redirectUrl = new URL(target, origin);

  if (!code) {
    return NextResponse.redirect(redirectUrl);
  }

  const supabase = createServerSupabase();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    // 원문(영어)은 서버 로그로만 남기고, 클라이언트에는 코드로 전달 —
    // LoginForm 이 한국어 안내문으로 매핑한다. next 도 보존해 재로그인 시 원래 경로로 복귀.
    console.warn("[auth/callback] exchangeCodeForSession 실패:", error.message);
    const url = new URL("/login", origin);
    url.searchParams.set("error", "callback_failed");
    if (target !== "/") url.searchParams.set("next", target);
    return NextResponse.redirect(url);
  }

  const userId = data.user?.id;
  const admin = userId ? createAdminSupabase() : null;

  // 탈퇴(익명화) 계정 확인 — 아래 재설정 마커·부수효과보다 먼저 (DEBT-3).
  // 익명화·콘텐츠 정리는 끝났지만 auth soft delete 가 실패한 중간 상태면 auth.users 가 남아
  // 카카오·매직링크 로그인이 성공한다. 그대로 두면 sync_oauth_profile 이 정리 단계가 지운
  // avatar_url·oauth_provider 를 되살리고, 익명화된 계정에 추천 코드·referrals 행이 생긴다.
  const accountState: AccountState =
    admin && userId ? await readAccountState(admin, userId) : "active";

  if (accountState === "deleted") {
    // 이번 교환으로 만든 세션만 끊는다(scope local — 쿠키 제거 + GoTrue 세션 행 삭제).
    try {
      const { error: signOutErr } = await supabase.auth.signOut({ scope: "local" });
      if (signOutErr) {
        console.warn("[auth/callback] 탈퇴 계정 signOut 실패:", signOutErr.message);
      }
    } catch (e) {
      console.warn(
        "[auth/callback] 탈퇴 계정 signOut 실패:",
        e instanceof Error ? e.message : String(e),
      );
    }
    // next 는 싣지 않는다 — 다시 로그인해도 같은 안내로 돌아온다. LoginForm 이 error 코드를 안내문으로 매핑.
    const url = new URL("/login", origin);
    url.searchParams.set("error", "account_deleted");
    return NextResponse.redirect(url);
  }

  const response = NextResponse.redirect(redirectUrl);

  // 비밀번호 재설정 메일 링크로 만든 세션(AMR=recovery)일 때만 재설정 마커를 굽는다.
  // next=/reset-password 만 보면 OAuth 교환에도 발급된다 (SEC-13).
  // 이 마커가 /reset-password 의 유일한 통과 조건이다 (lib/auth/recovery.ts 참고).
  // access_token 은 방금 GoTrue 로부터 서버가 직접 받은 값이라 서명 재검증 없이 읽는다.
  if (
    userId &&
    shouldIssueRecoveryMarker({
      target,
      accessToken: data.session?.access_token,
    })
  ) {
    response.cookies.set({
      name: PASSWORD_RECOVERY_COOKIE,
      value: userId,
      path: "/",
      maxAge: PASSWORD_RECOVERY_MAX_AGE_SEC,
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
    });
  }

  // 동의 시각 기록 (best-effort, 실패해도 로그인 흐름은 진행) — 계정 상태를 확인하지 못한(unknown) 경우에도 실행한다.
  // 이 RPC 는 profiles 의 terms/privacy_agreed_at 을 coalesce 로 채우기만 해서(멱등) 익명화가 지운 개인정보를
  // 되살리지 않는다. 그리고 동의 시각을 채우는 경로는 사실상 이 콜백뿐이다 — /api/auth/agree 를 부르는
  // 클라이언트는 현재 없다. 여기서 실패하면 다음 콜백 로그인 때 다시 채워진다.
  if (userId && admin) {
    try {
      await admin.rpc("record_agreements", { p_user_id: userId });
    } catch {
      /* 무시 — 다음 콜백 로그인에서 재시도(coalesce 멱등) */
    }
  }

  // 나머지 부수효과는 활성 계정이 확인됐을 때만 — 조회 실패(unknown)면 로그인은 진행하되 건너뛴다.
  // 프로필 동기화는 익명화가 지운 avatar_url 등을 되살릴 수 있고, 추천·계측은 탈퇴 계정에 남으면 안 되기 때문이다.
  // 모두 best-effort 라 다음 로그인에서 다시 실행되며, referral_code 쿠키도 그때 처리되도록 남겨 둔다.
  // 쓰기 API 는 requireActiveUser 가 같은 조회 실패를 503 으로 막는다(fail-closed).
  if (userId && admin && accountState === "active") {
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

    // 퍼널 계측: 가입 완료 (S1-2). created_at 이 최근일 때만 가입으로 간주 —
    // 반복 로그인은 제외되고, (user_id, event) 부분 유니크가 중복 기록도 차단한다.
    const createdAtMs = data.user?.created_at
      ? Date.parse(data.user.created_at)
      : Number.NaN;
    if (Number.isFinite(createdAtMs) && Date.now() - createdAtMs < 10 * 60 * 1000) {
      await trackFunnelEvent({ event: "signup_completed", userId });
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

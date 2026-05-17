import "server-only";

import { cache } from "react";

import type { User } from "@supabase/supabase-js";

import { createServerSupabase } from "@/lib/db/server";

/**
 * 현재 요청의 Supabase 세션을 반환 (없으면 null).
 * React cache()로 같은 요청 내 중복 호출을 1회로 줄임.
 */
export const getSession = cache(async () => {
  const supabase = createServerSupabase();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  return session;
});

/**
 * 인증 에러를 throw 하는 헬퍼.
 */
function authError(
  message: string,
  status: number,
  code: string,
): never {
  const err = new Error(message) as Error & {
    status?: number;
    code?: string;
  };
  err.status = status;
  err.code = code;
  throw err;
}

/**
 * 로그인한 유저를 반환. 없으면 throw.
 *
 * 🚀 성능 — getSession() 기반(cookie only, 0 RTT).
 *   - 기존: supabase.auth.getUser() (API 왕복 1회) + profiles.deleted_at SELECT (RTT 2회)
 *   - 변경: supabase.auth.getSession() (cookie 만, 0 RTT)
 *   - 매 페이지 진입에서 50~400ms 단축. RLS 가 위조 토큰을 차단하므로 페이지 라우트
 *     에서는 cookie session 만으로 충분 (DB 쿼리는 모두 RLS 통과 필요).
 *
 * 🔒 탈퇴 가드가 필요한 곳(account 삭제·민감 액션)은 `requireActiveUser()` 명시 호출.
 *
 * 🛂 cookie 갱신은 middleware 의 createServerClient 가 매 요청마다 수행.
 */
export const requireUser = cache(async (): Promise<User> => {
  const supabase = createServerSupabase();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session?.user) {
    authError("로그인이 필요합니다.", 401, "UNAUTHORIZED");
  }

  return session.user;
});

/**
 * requireUser() 와 동일하지만, 추가로 탈퇴 가드를 적용한다.
 *
 * 사용 시점:
 *   - 회원 탈퇴 직후 잔존 세션이 보낸 위험 액션을 차단해야 할 때
 *   - 계정 관리(/mypage/account), 결제 confirm, gift 받기, sync_oauth_profile 등
 *
 * 사용하지 않는 곳:
 *   - 단순 페이지 진입 / 조회 라우트 (RLS 가 deleted_at 검증된 행만 노출)
 *
 * RTT: getSession (0) + profiles.deleted_at SELECT (1) = 1회.
 */
export const requireActiveUser = cache(async (): Promise<User> => {
  const user = await requireUser();
  const supabase = createServerSupabase();

  const { data: profile } = await supabase
    .from("profiles")
    .select("deleted_at")
    .eq("id", user.id)
    .maybeSingle();

  if (profile?.deleted_at) {
    authError(
      "탈퇴된 계정입니다. 다시 로그인하거나 신규 가입해 주세요.",
      410,
      "ACCOUNT_DELETED",
    );
  }

  return user;
});

/**
 * admin 역할 유저를 반환. 아니면 throw (403).
 * profiles.role 조회 1 RTT 발생. middleware 에서도 admin 라우트는 별도 검증함.
 */
export async function requireAdmin(): Promise<User> {
  const user = await requireUser();
  const supabase = createServerSupabase();

  const { data: profile, error } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (error || !profile || profile.role !== "admin") {
    authError("관리자 권한이 필요합니다.", 403, "FORBIDDEN");
  }

  return user;
}

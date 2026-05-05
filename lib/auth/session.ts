import "server-only";

import type { User } from "@supabase/supabase-js";

import { createServerSupabase } from "@/lib/db/server";

/**
 * 현재 요청의 Supabase 세션을 반환 (없으면 null).
 */
export async function getSession() {
  const supabase = createServerSupabase();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  return session;
}

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
 * 추가 가드:
 *   - profiles.deleted_at IS NOT NULL → 410 GONE (탈퇴 익명화된 계정)
 *
 * Route Handler / Server Action 에서 쓰면 상위 try/catch 가 표준 fail 응답으로 처리.
 */
export async function requireUser(): Promise<User> {
  const supabase = createServerSupabase();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    authError("로그인이 필요합니다.", 401, "UNAUTHORIZED");
  }

  // 탈퇴 가드 — 익명화된 계정으로 잔존 세션이 들어오면 차단
  const { data: profile } = await supabase
    .from("profiles")
    .select("deleted_at")
    .eq("id", user!.id)
    .maybeSingle();

  if (profile?.deleted_at) {
    authError(
      "탈퇴된 계정입니다. 다시 로그인하거나 신규 가입해 주세요.",
      410,
      "ACCOUNT_DELETED",
    );
  }

  return user!;
}

/**
 * admin 역할 유저를 반환. 아니면 throw (403).
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

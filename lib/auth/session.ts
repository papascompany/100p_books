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
 * 로그인한 유저를 반환. 없으면 throw.
 * Route Handler / Server Action 에서 쓰면 상위 try/catch 가 401 응답으로 처리.
 */
export async function requireUser(): Promise<User> {
  const supabase = createServerSupabase();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    const err = new Error("로그인이 필요합니다.") as Error & { status?: number };
    err.status = 401;
    throw err;
  }

  return user;
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
    const err = new Error("관리자 권한이 필요합니다.") as Error & {
      status?: number;
    };
    err.status = 403;
    throw err;
  }

  return user;
}

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
 * 🔒 보안 — getUser() 기반(Auth 서버 왕복으로 JWT 서명 검증).
 *   - getSession() 은 쿠키 JSON 을 그대로 신뢰해 서명을 검증하지 않는다. service_role
 *     (RLS 우회) 클라이언트를 requireUser().id 로 쓰는 라우트(attendance/points/gifts/
 *     orders/photos/account 등)에서는 위조 쿠키로 임의 user.id 를 주입할 수 있어
 *     계정탈취/IDOR 가 가능했다. getUser() 는 GoTrue 가 토큰을 검증하므로 위조 차단.
 *   - 비용: 요청당 GoTrue 왕복 1회(React cache 로 요청 내 1회로 축소). 보안상 불가피.
 *
 * 🔒 탈퇴 가드가 필요한 곳(돈·정체성 변경 액션)은 `requireActiveUser()` 명시 호출.
 *    이 함수는 deleted_at 을 보지 않는다.
 * 🛂 cookie 갱신은 middleware 의 createServerClient 가 매 요청마다 수행.
 */
export const requireUser = cache(async (): Promise<User> => {
  const supabase = createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    authError("로그인이 필요합니다.", 401, "UNAUTHORIZED");
  }

  return user;
});

/**
 * requireUser() 와 동일하지만, 추가로 탈퇴 가드(profiles.deleted_at)를 적용한다.
 *
 * 탈퇴는 익명화(deleted_at) → auth soft delete(세션 전부 삭제) 순서다
 * (lib/auth/account-deletion.ts). soft delete 가 끝나면 getUser() 자체가 실패하지만,
 * auth 단계가 실패해 세션이 남은 사이에는 이 가드만이 탈퇴 회원의 행동을 막는다.
 * RLS 는 deleted_at 을 보지 않는다.
 *
 * 사용 시점 (돈·정체성 변경):
 *   - 결제 confirm, PDF 빌드, 주문 생성, 선물 보내기/받기, 출석 포인트, 할인 검증,
 *     후기 작성·수정·삭제·좋아요, 추천 코드 발급
 *
 * 사용하지 않는 곳:
 *   - 단순 페이지 진입 / 조회 라우트
 *   - 회원 탈퇴 라우트 자체 (재시도로 탈퇴를 끝낼 수 있어야 하므로 requireUser + 자체 판정)
 *
 * 조회 실패 시에는 통과시키지 않는다(fail-closed, 503).
 *
 * RTT: getUser (1) + profiles.deleted_at SELECT (1) = 2회.
 */
export const requireActiveUser = cache(async (): Promise<User> => {
  const user = await requireUser();
  const supabase = createServerSupabase();

  const { data: profile, error } = await supabase
    .from("profiles")
    .select("deleted_at")
    .eq("id", user.id)
    .maybeSingle();

  if (error) {
    authError(
      "계정 상태를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.",
      503,
      "ACCOUNT_STATUS_UNAVAILABLE",
    );
  }

  // 여기까지 온 탈퇴 계정은 getUser() 가 통과한 상태 = 익명화는 끝났지만 auth 단계가 남은 중간 상태다.
  // (soft delete 까지 끝났다면 세션이 없어 위 requireUser 에서 401) → 필요한 조치는 탈퇴 재시도.
  if (profile?.deleted_at) {
    authError(
      "탈퇴 처리가 끝나지 않은 계정이에요. 마이페이지 > 계정 관리에서 회원 탈퇴를 다시 진행해 주세요.",
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
    .select("role, deleted_at")
    .eq("id", user.id)
    .single();

  // 탈퇴/오프보딩(soft-delete)된 관리자는 role 이 admin 이어도 차단.
  if (error || !profile || profile.role !== "admin" || profile.deleted_at) {
    authError("관리자 권한이 필요합니다.", 403, "FORBIDDEN");
  }

  return user;
}

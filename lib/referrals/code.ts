import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/db/types";

/**
 * 친구 추천(M16-4) 관련 헬퍼.
 *
 * 추천 코드 형식: 8자 [A-Z0-9]
 *   - 사용자 UUID 의 첫 6자에서 hex 만 [A-F0-9] 추출 → 대문자
 *   - 부족분은 안전한 알파벳/숫자에서 무작위 보충
 *   - 마지막 2자는 매번 무작위 → 충돌 시 재시도 시드 변경 효과
 */

/** 시각적 혼동 가능 문자(0/O, 1/I/L) 제거. */
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

function pickRandom(len: number): string {
  let out = "";
  for (let i = 0; i < len; i += 1) {
    out += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return out;
}

function uuidPrefix(userId: string): string {
  // hex(0-9, a-f) 만 추출, 대문자, 시각혼동 문자(0,1) → 안전 문자로 치환
  const hex = userId.replace(/-/g, "").toUpperCase().slice(0, 6);
  return hex
    .replace(/0/g, "Q")
    .replace(/1/g, "K");
}

/**
 * UUID 시드 + 랜덤 2자 조합으로 8자 코드를 생성한다.
 */
export function buildReferralCode(userId: string): string {
  const prefix = uuidPrefix(userId).slice(0, 6).padEnd(6, "X");
  return `${prefix}${pickRandom(2)}`;
}

const REFERRAL_REWARD_KRW = 5000;
export const REFERRAL_REWARD = REFERRAL_REWARD_KRW;

/**
 * 사용자에게 추천 코드를 발급(또는 조회)한다.
 *
 * 멱등:
 *   1. profiles.referral_code 가 이미 있으면 그대로 반환.
 *   2. 없으면 buildReferralCode 로 생성 → UNIQUE 충돌 시 최대 5회 재시도.
 *
 * service_role 클라이언트 사용을 권장 (다른 사용자의 referral_code 와의
 * 충돌을 회피하려면 RLS 우회가 안전). 본 함수는 supabase 인자 형태로 받아
 * 호출 측에서 admin/server 모두 선택 가능.
 */
export async function ensureReferralCode(
  supabase: SupabaseClient<Database>,
  userId: string,
): Promise<{ code: string; created: boolean }> {
  const { data: existing, error: readErr } = await supabase
    .from("profiles")
    .select("referral_code")
    .eq("id", userId)
    .maybeSingle();

  if (readErr) {
    throw new Error(`profiles 조회 실패: ${readErr.message}`);
  }
  if (existing?.referral_code) {
    return { code: existing.referral_code, created: false };
  }

  let lastErr: string | null = null;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = buildReferralCode(userId);
    const { data, error } = await supabase
      .from("profiles")
      .update({ referral_code: code })
      .eq("id", userId)
      .is("referral_code", null)
      .select("referral_code")
      .maybeSingle();

    if (!error && data?.referral_code) {
      return { code: data.referral_code, created: true };
    }

    // 23505 = unique_violation → 다른 코드로 재시도
    const pgCode = (error as { code?: string } | null)?.code;
    if (pgCode && pgCode !== "23505") {
      lastErr = error?.message ?? "unknown error";
      break;
    }

    // 다른 사용자가 동일 row 를 race 갱신했을 수 있음 → 한 번 더 읽어본다
    const { data: re } = await supabase
      .from("profiles")
      .select("referral_code")
      .eq("id", userId)
      .maybeSingle();
    if (re?.referral_code) {
      return { code: re.referral_code, created: false };
    }
    lastErr = error?.message ?? null;
  }

  throw new Error(`추천 코드 발급 실패: ${lastErr ?? "5회 재시도 모두 충돌"}`);
}

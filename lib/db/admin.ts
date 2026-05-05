import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "./types";

/**
 * service_role 키를 사용하는 관리자(서버 전용) 클라이언트.
 * RLS 를 우회하므로 주문 write, admin 리소스 관리, 웹훅 등 서버 루트에서만 사용.
 *
 * 보호 장치:
 *   1. `"server-only"` 임포트로 클라이언트 번들에 포함되면 빌드 에러.
 *   2. typeof window !== "undefined" 런타임 체크.
 *   3. 키 존재 확인.
 */
let adminClient: SupabaseClient<Database> | null = null;

export function createAdminSupabase(): SupabaseClient<Database> {
  if (typeof window !== "undefined") {
    throw new Error(
      "[supabase/admin] service_role 클라이언트는 서버에서만 사용 가능합니다.",
    );
  }

  if (adminClient) return adminClient;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error(
      "[supabase/admin] NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 가 누락되었습니다.",
    );
  }

  adminClient = createClient<Database>(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  return adminClient;
}

import "server-only";

import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";

import type { Database } from "./types";

/**
 * SSR / RSC / Route Handler 용 Supabase 클라이언트.
 * 사용자 세션 쿠키를 읽고 쓴다. anon 키 사용.
 *
 * Next 16 부터 `cookies()` 가 Promise 를 반환하므로 이 팩토리도 async 다.
 * 호출부는 반드시 `await createServerSupabase()` 로 받는다.
 * (@supabase/ssr 0.5.2 의 get/set/remove 쿠키 어댑터 형태는 그대로 유지 — 쿠키 인코딩 변경 없음)
 */
export async function createServerSupabase() {
  const cookieStore = await cookies();

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(
      "[supabase/server] NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY 가 누락되었습니다.",
    );
  }

  return createServerClient<Database>(supabaseUrl, supabaseAnonKey, {
    cookies: {
      get(name: string) {
        return cookieStore.get(name)?.value;
      },
      set(name: string, value: string, options: CookieOptions) {
        try {
          cookieStore.set({ name, value, ...options });
        } catch {
          // RSC 에서 쿠키 write 를 호출한 경우 — 무시
          // (미들웨어 / Route Handler / Server Action 에서만 write 가능)
        }
      },
      remove(name: string, options: CookieOptions) {
        try {
          cookieStore.set({ name, value: "", ...options });
        } catch {
          // 상동
        }
      },
    },
  });
}

/**
 * `await createServerSupabase()` 의 결과 타입.
 * 호출부에서 클라이언트를 인자로 넘길 때 `ReturnType<typeof createServerSupabase>`(= Promise) 대신 쓴다.
 */
export type ServerSupabase = Awaited<ReturnType<typeof createServerSupabase>>;

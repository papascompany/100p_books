import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import type { Database } from "./types";

/**
 * SSR / RSC / Route Handler 용 Supabase 클라이언트.
 * 사용자 세션 쿠키를 읽고 쓴다. anon 키 사용.
 *
 * Next 16 부터 `cookies()` 가 Promise 를 반환하므로 이 팩토리도 async 다.
 * 호출부는 반드시 `await createServerSupabase()` 로 받는다.
 *
 * 쿠키 어댑터는 @supabase/ssr 0.12 공식 형태(getAll/setAll)다. 0.5.2 의 get/set/remove 는
 * deprecated(다음 메이저 제거 예정)라 옮겼다. 쿠키 포맷은 그대로다 — cookieEncoding 기본값
 * "base64url", DEFAULT_COOKIE_OPTIONS(path=/, sameSite=lax, httpOnly=false, maxAge 400일),
 * 청크 크기 3180 이 0.5.2 와 동일하다. 삭제는 setAll 에 value "" + maxAge 0 항목으로 온다.
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
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        // 두 번째 인자(no-store 캐시 헤더)는 cookies() 로 응답 헤더를 쓸 수 없어 다루지 않는다 —
        // 토큰 갱신 쿠키는 middleware 가 매 요청 기록하며 그쪽에서 헤더도 붙인다.
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // RSC 에서 쿠키 write 를 호출한 경우 — 무시
          // (미들웨어 / Route Handler / Server Action 에서만 write 가능)
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

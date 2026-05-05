"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "./types";

let client: SupabaseClient<Database> | null = null;

/**
 * 클라이언트(브라우저) 전용 Supabase 싱글톤.
 * anon 키만 사용. service_role 은 절대 여기서 참조하지 않는다.
 */
export function getBrowserSupabase(): SupabaseClient<Database> {
  if (client) return client;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error(
      "[supabase/browser] NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY 가 누락되었습니다.",
    );
  }

  client = createBrowserClient<Database>(url, anonKey);
  return client;
}

import "server-only";

import { NextResponse } from "next/server";

import { createServerSupabase } from "@/lib/db/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface HealthCheck {
  ok: boolean;
  service: "100p_books";
  ts: string;
  db: "ok" | "fail";
  env: {
    supabase: boolean;
    toss: boolean;
    app_url: boolean;
  };
  warning?: string;
}

/**
 * GET /api/health
 *
 * 운영 모니터링용 헬스체크.
 *  - DB: profiles 테이블에 head:true count 쿼리로 가벼운 ping (실패해도 200은 아님)
 *  - env: 필수 환경변수 존재 여부 (값은 노출하지 않음)
 *  - 응답: 200 OK 또는 503 Service Unavailable
 */
export async function GET() {
  const env = {
    supabase: Boolean(
      process.env.NEXT_PUBLIC_SUPABASE_URL &&
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY &&
        process.env.SUPABASE_SERVICE_ROLE_KEY,
    ),
    toss: Boolean(
      process.env.TOSS_SECRET_KEY && process.env.NEXT_PUBLIC_TOSS_CLIENT_KEY,
    ),
    app_url: Boolean(process.env.NEXT_PUBLIC_APP_URL),
  };

  let dbStatus: "ok" | "fail" = "fail";
  let dbErrorMessage: string | undefined;
  if (env.supabase) {
    try {
      const supabase = createServerSupabase();
      const { error } = await supabase
        .from("profiles")
        .select("id", { count: "exact", head: true });
      if (error) {
        dbErrorMessage = error.message;
      } else {
        dbStatus = "ok";
      }
    } catch (err) {
      dbErrorMessage = err instanceof Error ? err.message : String(err);
    }
  } else {
    dbErrorMessage = "supabase env missing";
  }

  const ok = dbStatus === "ok" && env.supabase && env.toss && env.app_url;

  const body: HealthCheck = {
    ok,
    service: "100p_books",
    ts: new Date().toISOString(),
    db: dbStatus,
    env,
    ...(dbErrorMessage && dbStatus === "fail"
      ? { warning: dbErrorMessage }
      : {}),
  };

  return NextResponse.json(body, {
    status: ok ? 200 : 503,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}

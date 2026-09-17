import "server-only";

import { NextResponse } from "next/server";

import { createServerSupabase } from "@/lib/db/server";
import { hasValidCronBearer, isDeployedRuntime } from "@/lib/security/cron-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** 비인증 응답 — 외부 업타임 모니터가 보는 최소 상태만. */
interface PublicHealth {
  ok: boolean;
  status: "ok" | "degraded";
  service: "100p_books";
  ts: string;
}

/** 운영자 응답 — 구성·DB 오류 원문까지. */
interface DetailedHealth extends PublicHealth {
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
 *
 * 노출 범위 (SEC-19):
 *  - 비인증: `{ ok, status: "ok"|"degraded", service, ts }` 만. 어떤 env 가 비었는지(결제키 유무 등),
 *    DB 오류 원문은 정찰 정보라 공개하지 않는다. 상태 코드(200/503)는 그대로라 업타임 모니터는 영향 없음.
 *  - `Authorization: Bearer <CRON_SECRET>` 또는 로컬 개발(`next dev`): `db`, `env`, `warning` 포함.
 *    DB 오류 원문은 비인증 응답에서 빠지는 대신 서버 로그(console.error)에 남긴다.
 */
export async function GET(req: Request) {
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

  if (dbStatus === "fail" && dbErrorMessage) {
    console.error(`[health] db check failed: ${dbErrorMessage}`);
  }

  const summary: PublicHealth = {
    ok,
    status: ok ? "ok" : "degraded",
    service: "100p_books",
    ts: new Date().toISOString(),
  };

  const includeDetails = hasValidCronBearer(req) || !isDeployedRuntime();
  const body: PublicHealth | DetailedHealth = includeDetails
    ? {
        ...summary,
        db: dbStatus,
        env,
        ...(dbErrorMessage && dbStatus === "fail"
          ? { warning: dbErrorMessage }
          : {}),
      }
    : summary;

  return NextResponse.json(body, {
    status: ok ? 200 : 503,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}

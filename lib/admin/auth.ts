import "server-only";

import type { NextRequest, NextResponse } from "next/server";

import { failFromError, type ApiFail } from "@/app/api/_lib/response";
import { requireAdmin } from "@/lib/auth/session";

/**
 * `/api/admin/*` 라우트 공용 래퍼.
 *
 *   - middleware 가 1차 방어 (cookie + role 체크) → 본 래퍼가 2차 방어
 *     (서버 컴포넌트/라우트 핸들러 단에서도 항상 admin 임을 강제).
 *   - throw 된 에러는 표준 fail 응답으로 변환.
 *
 * 사용:
 * ```ts
 * export const GET = withAdmin(async (req, ctx) => {
 *   const supabase = createAdminSupabase();
 *   ...
 *   return ok(...);
 * });
 * ```
 *
 * Next.js 16 의 라우트 핸들러는 컨텍스트의 `params` 를 Promise 로 넘긴다(`AdminRouteCtx`).
 * 이 래퍼가 바깥에서 한 번 await 해서, 내부 handler 에는 종전처럼 평문 `{ params }`(`AdminCtx`)를 넘긴다
 * — 그래서 관리자 라우트들은 `ctx.params.id` 를 그대로 쓸 수 있다.
 */
export type AdminCtx<P extends Record<string, string> = Record<string, string>> = {
  params: P;
};

/** Next.js 가 라우트 핸들러에 실제로 넘기는 컨텍스트 (params 가 Promise). */
export type AdminRouteCtx<P extends Record<string, string> = Record<string, string>> = {
  params: Promise<P>;
};

export function withAdmin<P extends Record<string, string> = Record<string, string>>(
  handler: (
    req: NextRequest,
    ctx: AdminCtx<P>,
    user: Awaited<ReturnType<typeof requireAdmin>>,
  ) => Promise<NextResponse | Response>,
) {
  return async function adminHandler(
    req: NextRequest,
    ctx: AdminRouteCtx<P>,
  ): Promise<NextResponse | Response> {
    try {
      const user = await requireAdmin();
      // 권한 검사 이후에 params 를 푼다 (403 응답 경로는 종전과 동일).
      const params = await ctx.params;
      return await handler(req, { params }, user);
    } catch (err) {
      // failFromError 가 NextResponse<ApiFail> 를 반환
      return failFromError(err) as NextResponse<ApiFail>;
    }
  };
}

/** 명시적 검사용 — withAdmin 으로 감싸지 않은 경우. */
export async function assertAdmin() {
  await requireAdmin();
}

/** 단순 fail 헬퍼 재노출 (admin 라우트 안에서 import 줄이기 용도). */
export { fail, failFromError, ok } from "@/app/api/_lib/response";

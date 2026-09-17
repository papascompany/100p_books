import "server-only";

import { createHash, timingSafeEqual } from "node:crypto";

/**
 * 🛡 Cron 엔드포인트 인증 — `app/api/cron/**` 공용 가드 (SEC-14).
 *
 * 근거 — Vercel 공식 문서 "Managing Cron Jobs › Securing cron jobs" (2026-09-17 확인):
 *   - 프로젝트 env 에 `CRON_SECRET` 이 있으면 Vercel 이 cron 호출 때
 *     `Authorization: Bearer <CRON_SECRET>` 헤더를 **자동으로** 붙인다.
 *   - 문서 권장 코드는 `!cronSecret || authHeader !== Bearer…` 이면 401 — fail-closed.
 *   - `x-vercel-cron` 헤더는 인증 수단이 아니다(클라이언트가 임의로 보낼 수 있다).
 *     문서에 나오는 헤더는 스케줄 식별용 `x-vercel-cron-schedule` 뿐이다.
 *
 * 규칙:
 *   1) CRON_SECRET 이 있으면 환경과 무관하게 `Bearer <CRON_SECRET>` 일치만 통과한다.
 *      비교는 SHA-256 다이제스트끼리 timingSafeEqual — 길이·접두 일치로 시간차가 새지 않게.
 *   2) CRON_SECRET 이 없는데 배포 런타임(production 빌드, 또는 VERCEL_ENV=preview/production)
 *      이면 무조건 거부한다. env 가 빠진 배포가 곧 "누구나 GET 한 번으로 삭제 cron 실행" 이
 *      되지 않게 하기 위함이다(Preview 에 데이터 키를 붙이는 실수 포함).
 *   3) CRON_SECRET 이 없는 로컬 개발(`next dev`, NODE_ENV≠production)에서만
 *      `x-vercel-cron: 1` 수동 호출을 허용한다. localhost 에서만 닿는 서버라 인증 가치는 없고,
 *      헤더는 "의도한 호출" 표시다 — 브라우저 주소창 GET 으로 삭제 cron(orphan-photos 등)이
 *      실수로 도는 것을 막는다. 로컬에서도 CRON_SECRET 을 넣으면 1) 규칙이 적용된다.
 */

export interface CronAuthEnv {
  CRON_SECRET?: string;
  NODE_ENV?: string;
  VERCEL_ENV?: string;
}

export type CronAuthResult =
  | { ok: true; via: "bearer" | "local-dev" }
  | {
      ok: false;
      status: 401 | 500;
      code: "UNAUTHORIZED" | "CRON_NOT_CONFIGURED";
      message: string;
    };

/** 배포된 런타임인가 — 로컬 `next dev`·vitest 가 아니면 true. */
export function isDeployedRuntime(env: CronAuthEnv = process.env): boolean {
  return (
    env.NODE_ENV === "production" ||
    env.VERCEL_ENV === "production" ||
    env.VERCEL_ENV === "preview"
  );
}

function digestEqual(a: string, b: string): boolean {
  // 고정 길이 다이제스트로 바꿔 비교 — timingSafeEqual 은 길이가 다르면 throw 하고,
  // 길이 검사 자체가 secret 길이를 흘릴 수 있다.
  const da = createHash("sha256").update(a).digest();
  const db = createHash("sha256").update(b).digest();
  return timingSafeEqual(da, db);
}

/**
 * `Authorization: Bearer <CRON_SECRET>` 가 정확히 일치하는가.
 * CRON_SECRET 이 없거나 빈 문자열이면 항상 false (로컬 우회 없음).
 * cron 외에 운영자 전용 상세 응답(`/api/health` 상세 등)의 게이트로도 쓴다.
 */
export function hasValidCronBearer(
  req: Request,
  env: CronAuthEnv = process.env,
): boolean {
  const secret = env.CRON_SECRET;
  if (!secret) return false;
  const header = req.headers.get("authorization");
  if (!header) return false;
  return digestEqual(header, `Bearer ${secret}`);
}

/** cron 라우트 진입 가드. 실패 결과는 라우트가 `fail(code, message, status)` 로 응답한다. */
export function verifyCronRequest(
  req: Request,
  env: CronAuthEnv = process.env,
): CronAuthResult {
  if (env.CRON_SECRET) {
    return hasValidCronBearer(req, env)
      ? { ok: true, via: "bearer" }
      : {
          ok: false,
          status: 401,
          code: "UNAUTHORIZED",
          message: "인증 헤더가 올바르지 않습니다.",
        };
  }

  if (!isDeployedRuntime(env) && req.headers.get("x-vercel-cron") === "1") {
    return { ok: true, via: "local-dev" };
  }

  if (isDeployedRuntime(env)) {
    // 운영자에게는 원인이 보여야 한다(응답 코드만으로는 env 누락인지 모름).
    console.error(
      "[cron-auth] CRON_SECRET 미설정 — 배포 환경에서는 모든 cron 호출을 거부합니다.",
    );
  }
  return {
    ok: false,
    status: 500,
    code: "CRON_NOT_CONFIGURED",
    message: "CRON_SECRET 이 설정되지 않았습니다.",
  };
}

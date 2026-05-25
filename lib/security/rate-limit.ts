import "server-only";

import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

/**
 * 🛡 Rate Limit — Upstash Redis (sliding window).
 *
 * 환경변수:
 *   UPSTASH_REDIS_REST_URL
 *   UPSTASH_REDIS_REST_TOKEN
 *
 * 미설정 시 fail-open (no-op) — 인프라 의존 없이 빌드/테스트 통과.
 * 운영 활성화는 Vercel Marketplace 에서 Upstash Redis 구독 + env 등록.
 *
 * 사용:
 *   const result = await enforceRateLimit("photo-upload", request, user.id);
 *   if (!result.success) return fail(429, ...);
 */

const url = process.env.UPSTASH_REDIS_REST_URL;
const token = process.env.UPSTASH_REDIS_REST_TOKEN;
const ENABLED = !!url && !!token;

let redis: Redis | null = null;
if (ENABLED) {
  redis = new Redis({ url: url!, token: token! });
}

/** 인메모리 캐시 — 같은 limiter 인스턴스 재사용. */
const cache = new Map<string, Ratelimit>();

interface LimiterOptions {
  /** 시간 윈도우 내 허용 횟수. */
  limit: number;
  /** 윈도우 길이 (ms·s·m·h·d). 예: "1 m", "60 s". */
  window: `${number} ${"ms" | "s" | "m" | "h" | "d"}`;
  /** prefix — Redis 키 namespace. */
  prefix: string;
}

function getLimiter(opts: LimiterOptions): Ratelimit | null {
  if (!ENABLED || !redis) return null;
  const cached = cache.get(opts.prefix);
  if (cached) return cached;
  const rl = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(opts.limit, opts.window),
    prefix: `100p:${opts.prefix}`,
    analytics: false,
  });
  cache.set(opts.prefix, rl);
  return rl;
}

/**
 * 클라이언트 식별자 — userId 우선, 없으면 IP.
 * IP 는 Vercel `x-forwarded-for` 헤더(첫 토큰) 사용.
 */
export function clientKey(req: Request, userId?: string | null): string {
  if (userId) return `u:${userId}`;
  const xff = req.headers.get("x-forwarded-for") ?? "";
  const ip = xff.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "anon";
  return `ip:${ip}`;
}

export interface RateLimitResult {
  /** true 면 통과, false 면 429 응답해야 함. */
  success: boolean;
  /** 남은 요청 수 (분기 통과 시). */
  remaining: number;
  /** 윈도우 리셋 시각 (epoch ms). */
  reset: number;
  /** 윈도우 한도. */
  limit: number;
  /** Rate limit 인프라가 비활성 상태인가 (env 미설정). */
  disabled: boolean;
}

/**
 * 핵심 진입 함수.
 *   - rl 인프라 미설정 시: success=true, disabled=true 로 통과 (fail-open).
 *   - 인프라 설정 + 한도 초과 시: success=false.
 */
export async function enforceRateLimit(
  preset: keyof typeof PRESETS,
  req: Request,
  userId?: string | null,
): Promise<RateLimitResult> {
  const opts = PRESETS[preset];
  const limiter = getLimiter(opts);
  if (!limiter) {
    return {
      success: true,
      remaining: opts.limit,
      reset: Date.now() + 60_000,
      limit: opts.limit,
      disabled: true,
    };
  }

  const key = clientKey(req, userId);
  const { success, remaining, reset, limit } = await limiter.limit(key);
  return { success, remaining, reset, limit, disabled: false };
}

/**
 * 핵심 라우트별 정책 프리셋.
 *
 *   photo-upload    : 분 당 30회 (한 번에 100장이 1 회 요청, 동시 호출 폭주 차단)
 *   review-upload   : 시간 당 20회 (남용 차단)
 *   account-delete  : 시간 당 5회 (잔존 세션 brute force 차단)
 *
 * userId 가 있는 인증 요청에 한정. IP fallback 은 anon 접근 차단용.
 */
const PRESETS = {
  "photo-upload": { limit: 30, window: "1 m", prefix: "photo-upload" },
  "review-upload": { limit: 20, window: "1 h", prefix: "review-upload" },
  "account-delete": { limit: 5, window: "1 h", prefix: "account-delete" },
} as const satisfies Record<string, LimiterOptions>;

/**
 * 응답 헤더 헬퍼 — RateLimitResult 를 표준 X-RateLimit-* 헤더로.
 */
export function rateLimitHeaders(r: RateLimitResult): Record<string, string> {
  if (r.disabled) return {};
  return {
    "X-RateLimit-Limit": String(r.limit),
    "X-RateLimit-Remaining": String(r.remaining),
    "X-RateLimit-Reset": String(Math.ceil(r.reset / 1000)),
  };
}

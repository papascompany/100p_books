import "server-only";

import { createAdminSupabase } from "@/lib/db/admin";

import { SITE_CONTENT_DEFAULTS } from "./defaults";
import type { SiteContentKey, SiteContentMap } from "./types";

/**
 * 사이트 콘텐츠 조회 (서버 전용).
 *
 *   - DB(site_content)에서 key 값을 읽고, 없으면 defaults fallback.
 *   - 부분 객체도 default 와 얕은 병합(top-level)하여 누락 필드 보강.
 *   - DB 오류/미마이그레이션 시에도 defaults 로 안전 동작.
 *
 * 캐시: force-dynamic 라우트에서도 매 요청 1회만 — admin 단일 조회라 가벼움.
 *       (랜딩이 ISR/정적이 아니라면 페이지 캐시에 따름. 저장 시 revalidatePath 로 무효화.)
 */
export async function getSiteContent<K extends SiteContentKey>(
  key: K,
): Promise<SiteContentMap[K]> {
  const fallback = SITE_CONTENT_DEFAULTS[key];
  try {
    const admin = createAdminSupabase();
    const { data, error } = await admin
      .from("site_content")
      .select("value")
      .eq("key", key)
      .maybeSingle();

    if (error || !data?.value) return fallback;

    const value = data.value as unknown;

    // 배열 타입 key 는 그대로 사용(비어있지 않을 때), 객체는 default 와 병합.
    if (Array.isArray(fallback)) {
      return (Array.isArray(value) && value.length > 0
        ? value
        : fallback) as SiteContentMap[K];
    }
    if (value && typeof value === "object") {
      return { ...(fallback as object), ...(value as object) } as SiteContentMap[K];
    }
    return fallback;
  } catch {
    return fallback;
  }
}

/** 여러 key 를 한 번에. */
export async function getSiteContentMany<K extends SiteContentKey>(
  keys: K[],
): Promise<{ [P in K]: SiteContentMap[P] }> {
  const fallback = (k: K) => SITE_CONTENT_DEFAULTS[k];
  const out = {} as { [P in K]: SiteContentMap[P] };
  try {
    const admin = createAdminSupabase();
    const { data, error } = await admin
      .from("site_content")
      .select("key, value")
      .in("key", keys as string[]);

    const byKey = new Map<string, unknown>();
    if (!error && data) {
      for (const row of data) byKey.set(row.key, row.value);
    }
    for (const k of keys) {
      const fb = fallback(k);
      const v = byKey.get(k);
      if (v == null) {
        out[k] = fb;
      } else if (Array.isArray(fb)) {
        out[k] = (Array.isArray(v) && v.length > 0 ? v : fb) as SiteContentMap[K];
      } else if (typeof v === "object") {
        out[k] = { ...(fb as object), ...(v as object) } as SiteContentMap[K];
      } else {
        out[k] = fb;
      }
    }
    return out;
  } catch {
    for (const k of keys) out[k] = fallback(k);
    return out;
  }
}

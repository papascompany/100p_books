import "server-only";

import { unstable_cache } from "next/cache";

import { createAdminSupabase } from "@/lib/db/admin";

import { SITE_CONTENT_DEFAULTS } from "./defaults";
import type { SiteContentKey, SiteContentMap } from "./types";

/** 캐시 무효화 태그 — CMS 저장 시 revalidateTag(SITE_CONTENT_TAG). */
export const SITE_CONTENT_TAG = "site-content";

/**
 * DB 원본 값 조회 (캐시 래핑 전 raw). key 없거나 오류면 null.
 * unstable_cache 로 감싸 동일 key 는 revalidate(5분) 동안 DB 재조회 없이 재사용.
 * → 랜딩/공통(헤더·푸터)이 매 요청마다 Supabase 왕복하지 않음 (정적/ISR 가능).
 */
const fetchRawCached = unstable_cache(
  async (key: string): Promise<unknown | null> => {
    try {
      const admin = createAdminSupabase();
      const { data, error } = await admin
        .from("site_content")
        .select("value")
        .eq("key", key)
        .maybeSingle();
      if (error || !data?.value) return null;
      return data.value as unknown;
    } catch {
      return null;
    }
  },
  ["site-content"],
  { revalidate: 300, tags: [SITE_CONTENT_TAG] },
);

/** DB 값 + default 얕은 병합 (배열은 비어있지 않을 때만 사용). */
function mergeWithDefault<K extends SiteContentKey>(
  key: K,
  value: unknown,
): SiteContentMap[K] {
  const fallback = SITE_CONTENT_DEFAULTS[key];
  if (value == null) return fallback;
  if (Array.isArray(fallback)) {
    return (Array.isArray(value) && value.length > 0
      ? value
      : fallback) as SiteContentMap[K];
  }
  if (typeof value === "object") {
    return { ...(fallback as object), ...(value as object) } as SiteContentMap[K];
  }
  return fallback;
}

/**
 * 사이트 콘텐츠 조회 (서버 전용, 캐시됨).
 * DB 미적용/오류 시에도 defaults fallback → 항상 안전.
 */
export async function getSiteContent<K extends SiteContentKey>(
  key: K,
): Promise<SiteContentMap[K]> {
  const value = await fetchRawCached(key);
  return mergeWithDefault(key, value);
}

/** 여러 key 를 병렬로 (각 key 캐시 적중). */
export async function getSiteContentMany<K extends SiteContentKey>(
  keys: K[],
): Promise<{ [P in K]: SiteContentMap[P] }> {
  const entries = await Promise.all(
    keys.map(async (k) => [k, await getSiteContent(k)] as const),
  );
  return Object.fromEntries(entries) as { [P in K]: SiteContentMap[P] };
}

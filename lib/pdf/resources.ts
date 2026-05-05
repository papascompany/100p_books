import "server-only";

import { RESOURCES_BUCKET } from "@/lib/admin/resources";
import { createAdminSupabase } from "@/lib/db/admin";

/**
 * 빌드 잡 단위 리소스 (클립아트 / 배경) 다운로드 헬퍼.
 *
 *   - resources 테이블에서 storage_key 조회 (admin client, RLS 우회).
 *   - resources 버킷에서 다운로드 → Buffer 캐싱 (per-job).
 *   - signedUrl 만료 가능성 — resourceId 가 우선, fallback 으로 src URL fetch.
 *
 * 클라이언트 PageDoc 직렬화 시 보존된 resourceId 가 있으면 만료된 signedUrl 도
 * admin storage 에서 다시 읽어들여 정상 렌더가 가능.
 */

interface ResourceMeta {
  storageKey: string;
}

export interface ResourceResolver {
  /** 클립아트 — resourceId 우선, 없으면 src URL fetch. */
  resolveClipart: (input: {
    resourceId?: string;
    src: string;
  }) => Promise<Buffer | null>;
  /** 배경 — resources(id) → storage_key, photoId 는 호출자가 photo resolver 로 처리. */
  resolveBackground: (input: {
    photoId?: string;
    url?: string;
  }) => Promise<Buffer | null>;
}

export function createResourceResolver(): ResourceResolver {
  const admin = createAdminSupabase();
  const cache = new Map<string, Buffer>();
  // resources.id → storage_key 미리 조회 캐시
  const metaCache = new Map<string, ResourceMeta>();

  async function metaOf(resourceId: string): Promise<ResourceMeta | null> {
    const cached = metaCache.get(resourceId);
    if (cached) return cached;
    const { data, error } = await admin
      .from("resources")
      .select("id, storage_key")
      .eq("id", resourceId)
      .maybeSingle();
    if (error || !data || !data.storage_key) return null;
    const m = { storageKey: data.storage_key };
    metaCache.set(resourceId, m);
    return m;
  }

  async function downloadByStorageKey(key: string): Promise<Buffer | null> {
    const cached = cache.get(`key:${key}`);
    if (cached) return cached;
    const { data: blob, error } = await admin.storage
      .from(RESOURCES_BUCKET)
      .download(key);
    if (error || !blob) return null;
    const buf = Buffer.from(await blob.arrayBuffer());
    cache.set(`key:${key}`, buf);
    return buf;
  }

  async function fetchUrl(src: string): Promise<Buffer | null> {
    const cached = cache.get(`url:${src}`);
    if (cached) return cached;
    try {
      const r = await fetch(src);
      if (!r.ok) return null;
      const ab = await r.arrayBuffer();
      const buf = Buffer.from(ab);
      cache.set(`url:${src}`, buf);
      return buf;
    } catch {
      return null;
    }
  }

  /**
   * resources URL 패턴(`/storage/v1/object/(public|sign)/resources/<key>`) 에서
   * storage_key 추출. signedUrl 의 path 도 동일.
   */
  function extractResourceKey(src: string): string | null {
    try {
      const u = new URL(src);
      // /storage/v1/object/sign/resources/<key>?token=...
      // /storage/v1/object/public/resources/<key>
      const m = u.pathname.match(
        /\/storage\/v1\/object\/(?:sign|public)\/resources\/(.+)$/,
      );
      return m && m[1] ? decodeURIComponent(m[1]) : null;
    } catch {
      return null;
    }
  }

  return {
    async resolveClipart({ resourceId, src }) {
      // 1) resourceId 가 명시되어 있으면 storage 직행
      if (resourceId) {
        const m = await metaOf(resourceId);
        if (m) {
          const buf = await downloadByStorageKey(m.storageKey);
          if (buf) return buf;
        }
      }
      // 2) src URL 이 resources 버킷의 signed/public URL 이면 path 추출 후 admin 다운로드
      const keyFromUrl = extractResourceKey(src);
      if (keyFromUrl) {
        const buf = await downloadByStorageKey(keyFromUrl);
        if (buf) return buf;
      }
      // 3) 마지막 수단 — 직접 fetch (외부 URL 또는 만료되지 않은 signedUrl)
      return await fetchUrl(src);
    },

    async resolveBackground({ photoId, url }) {
      // photoId 는 호출자가 photo resolver 로 우선 시도. 본 함수는 url 만 처리.
      if (!url) return null;
      const keyFromUrl = extractResourceKey(url);
      if (keyFromUrl) {
        const buf = await downloadByStorageKey(keyFromUrl);
        if (buf) return buf;
      }
      void photoId; // photoId 는 build-job 에서 photo resolver 가 처리
      return await fetchUrl(url);
    },
  };
}

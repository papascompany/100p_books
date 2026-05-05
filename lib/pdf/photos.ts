import "server-only";

import { createAdminSupabase } from "@/lib/db/admin";
import { ORIGINALS_BUCKET } from "@/lib/image/constants";

import { PHOTO_CACHE_MAX_BYTES } from "./constants";

/**
 * 빌드 잡 단위로 사용하는 사진 원본 다운로드 + 작은 LRU.
 *
 *   - photos 테이블에서 storage_key 조회 (admin client, RLS 우회).
 *   - photo-originals 버킷에서 다운로드 → ArrayBuffer → Buffer.
 *   - 같은 photoId 는 캐시 (page 여러 곳에서 재사용 시 중복 다운로드 방지).
 *   - 빌드 잡이 끝나면 인스턴스째 GC 되도록 모듈 수준 캐시는 사용하지 않는다.
 */

interface CacheEntry {
  buffer: Buffer;
  bytes: number;
}

export class PhotoCache {
  private map = new Map<string, CacheEntry>(); // 삽입 순서 = LRU 후보 순서
  private bytes = 0;
  private readonly maxBytes: number;

  constructor(maxBytes = PHOTO_CACHE_MAX_BYTES) {
    this.maxBytes = maxBytes;
  }

  get(key: string): Buffer | null {
    const hit = this.map.get(key);
    if (!hit) return null;
    // touch — 가장 최근 사용으로 이동
    this.map.delete(key);
    this.map.set(key, hit);
    return hit.buffer;
  }

  set(key: string, buffer: Buffer): void {
    const bytes = buffer.byteLength;
    // 단일 항목이 한도 초과면 캐시 안 함 (다음 호출자에서 재다운로드)
    if (bytes > this.maxBytes) return;

    const existing = this.map.get(key);
    if (existing) {
      this.map.delete(key);
      this.bytes -= existing.bytes;
    }
    this.map.set(key, { buffer, bytes });
    this.bytes += bytes;

    // capacity 초과 시 가장 오래된 항목 evict
    while (this.bytes > this.maxBytes) {
      const first = this.map.keys().next();
      if (first.done) break;
      const oldest = first.value;
      const e = this.map.get(oldest);
      if (!e) break;
      this.map.delete(oldest);
      this.bytes -= e.bytes;
    }
  }

  clear(): void {
    this.map.clear();
    this.bytes = 0;
  }
}

export interface PhotoResolverOpts {
  projectId: string;
  cache?: PhotoCache;
}

/**
 * 빌드 잡 1회용 photo resolver 팩토리.
 *
 *   - photos.id 로 조회.
 *   - 동일 projectId 의 photos 만 허용 (cross-project 사진 참조 방지).
 *   - storage_key → photo-originals 버킷 다운로드.
 */
export function createPhotoResolver(opts: PhotoResolverOpts): {
  resolve: (photoId: string) => Promise<Buffer>;
  cache: PhotoCache;
} {
  const cache = opts.cache ?? new PhotoCache();
  const admin = createAdminSupabase();

  // 동일 photoId 동시 요청 dedupe
  const inflight = new Map<string, Promise<Buffer>>();

  async function fetchOne(photoId: string): Promise<Buffer> {
    const cached = cache.get(photoId);
    if (cached) return cached;

    const inFlight = inflight.get(photoId);
    if (inFlight) return inFlight;

    const p = (async () => {
      // photos 메타 조회
      const { data: row, error } = await admin
        .from("photos")
        .select("id, project_id, storage_key, deleted_at")
        .eq("id", photoId)
        .is("deleted_at", null)
        .maybeSingle();
      if (error || !row) {
        throw new Error(`[pdf/photos] photo not found: ${photoId}`);
      }
      if (row.project_id !== opts.projectId) {
        throw new Error(
          `[pdf/photos] photo ${photoId} does not belong to project ${opts.projectId}`,
        );
      }

      const { data: blob, error: dlErr } = await admin.storage
        .from(ORIGINALS_BUCKET)
        .download(row.storage_key);
      if (dlErr || !blob) {
        throw new Error(
          `[pdf/photos] download failed for ${photoId}: ${dlErr?.message ?? "no blob"}`,
        );
      }
      const ab = await blob.arrayBuffer();
      const buf = Buffer.from(ab);
      cache.set(photoId, buf);
      return buf;
    })();

    inflight.set(photoId, p);
    try {
      return await p;
    } finally {
      inflight.delete(photoId);
    }
  }

  return { resolve: fetchOne, cache };
}

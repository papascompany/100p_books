import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  AccountContentPort,
  PhotoBucketKind,
  PhotoKeyColumn,
  PhotoKeyRow,
} from "@/lib/auth/account-content-purge";
import type { Database } from "@/lib/db/types";
import { ORIGINALS_BUCKET, THUMBS_BUCKET } from "@/lib/image/constants";

/**
 * account-content-purge 포트의 Supabase(service_role) 구현.
 *
 * - IN 절은 URL 길이 제한을 피하려고 청크로 나눈다 (orphan-photos cron 과 같은 이유).
 * - SELECT 는 PostgREST max-rows(기본 1000) 에 잘리지 않도록 range 페이지네이션한다.
 * - 오류는 모두 throw — 호출부(purgeAccountContent)가 필수 단계 실패로 처리한다.
 */

/** UUID IN 절 청크. */
const ID_CHUNK = 100;
/** Storage 키(`uid/pid/photoId.ext`, ~90자) IN 절 청크. */
const KEY_CHUNK = 100;
/** SELECT 페이지 크기 — PostgREST 기본 max-rows 이하. */
const PAGE_SIZE = 1000;

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function fail(step: string, message: string): never {
  throw new Error(`${step}: ${message}`);
}

const BUCKET_BY_KIND: Record<PhotoBucketKind, string> = {
  originals: ORIGINALS_BUCKET,
  thumbs: THUMBS_BUCKET,
};

export function createAccountContentStore(
  admin: SupabaseClient<Database>,
  userId: string,
): AccountContentPort {
  return {
    async listOwnedProjectIds() {
      const ids: string[] = [];
      for (let from = 0; ; from += PAGE_SIZE) {
        const { data, error } = await admin
          .from("projects")
          .select("id")
          .eq("user_id", userId)
          .order("id", { ascending: true })
          .range(from, from + PAGE_SIZE - 1);
        if (error) fail("projects.select", error.message);
        const rows = data ?? [];
        for (const r of rows) ids.push(r.id);
        if (rows.length < PAGE_SIZE) break;
      }
      return ids;
    },

    async revokeShareTokens(projectIds) {
      for (const slice of chunk(projectIds, ID_CHUNK)) {
        const { error } = await admin.from("share_tokens").delete().in("project_id", slice);
        if (error) fail("share_tokens.delete", error.message);
      }
    },

    async clearProfileIdentityFields() {
      const { error } = await admin
        .from("profiles")
        .update({ avatar_url: null, oauth_provider: null })
        .eq("id", userId);
      if (error) fail("profiles.update", error.message);
    },

    async listOrderedProjectIds(projectIds) {
      const ordered = new Set<string>();
      for (const slice of chunk(projectIds, ID_CHUNK)) {
        for (let from = 0; ; from += PAGE_SIZE) {
          const { data, error } = await admin
            .from("orders")
            .select("project_id")
            .in("project_id", slice)
            .order("id", { ascending: true })
            .range(from, from + PAGE_SIZE - 1);
          if (error) fail("orders.select", error.message);
          const rows = data ?? [];
          for (const r of rows) ordered.add(r.project_id);
          if (rows.length < PAGE_SIZE) break;
        }
      }
      return Array.from(ordered);
    },

    async listPhotoKeys(projectIds) {
      const keys: PhotoKeyRow[] = [];
      for (const slice of chunk(projectIds, ID_CHUNK)) {
        for (let from = 0; ; from += PAGE_SIZE) {
          // 휴지통(deleted_at not null) 사진도 포함 — 프로젝트와 함께 사라진다.
          const { data, error } = await admin
            .from("photos")
            .select("storage_key, thumb_key")
            .in("project_id", slice)
            .order("id", { ascending: true })
            .range(from, from + PAGE_SIZE - 1);
          if (error) fail("photos.select", error.message);
          const rows = data ?? [];
          for (const r of rows) keys.push({ storage_key: r.storage_key, thumb_key: r.thumb_key });
          if (rows.length < PAGE_SIZE) break;
        }
      }
      return keys;
    },

    async deleteProjects(projectIds) {
      for (const slice of chunk(projectIds, ID_CHUNK)) {
        // user_id 조건을 겹쳐 본인 소유 외 삭제를 원천 차단. 주문이 새로 붙은 프로젝트는 FK 가 막는다.
        const { error } = await admin
          .from("projects")
          .delete()
          .in("id", slice)
          .eq("user_id", userId);
        if (error) fail("projects.delete", error.message);
      }
    },

    async listReferencedKeys(column: PhotoKeyColumn, keys: string[]) {
      const referenced = new Set<string>();
      for (const slice of chunk(keys, KEY_CHUNK)) {
        const { data, error } = await admin.from("photos").select(column).in(column, slice);
        if (error) fail(`photos.select(${column})`, error.message);
        for (const r of (data ?? []) as Array<Partial<Record<PhotoKeyColumn, string | null>>>) {
          const key = r[column];
          if (typeof key === "string") referenced.add(key);
        }
      }
      return Array.from(referenced);
    },

    async removeStorageObjects(bucket: PhotoBucketKind, keys: string[]) {
      const storage = admin.storage.from(BUCKET_BY_KIND[bucket]);
      for (const slice of chunk(keys, KEY_CHUNK)) {
        const { error } = await storage.remove(slice);
        if (error) fail(`storage.remove(${bucket})`, error.message);
      }
    },
  };
}

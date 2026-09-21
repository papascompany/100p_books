import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { ownStorageKeys } from "@/lib/auth/account-content-purge";
import type { Database } from "@/lib/db/types";
import { ORIGINALS_BUCKET, THUMBS_BUCKET } from "@/lib/image/constants";

/**
 * 휴지통 영구 삭제의 Storage 정리 (POST /api/photos/purge).
 *
 * 왜 필요한가:
 *   photos 행의 storage_key·thumb_key 가 항상 요청 사용자 폴더를 가리키지는 않는다.
 *   선물 수령(app/api/gifts/[token])에서 Storage 복사가 실패하면 **발신자 원본 키를 그대로 참조**하는
 *   행이 생긴다. 예전 purge 는 키를 검증 없이 service_role 로 지워, 수령자가 그 사진을 휴지통 → 영구 삭제하면
 *   발신자의 결제 완료 포토북 원본·썸네일이 사라지고 PDF 재빌드가 실패했다.
 *   반대로 발신자가 영구 삭제해도, 폴백으로 같은 키를 참조하는 수령자 행이 있으면 지우면 안 된다.
 *
 * 규칙 (lib/auth/account-content-purge.ts 탈퇴 정리와 같은 규약):
 *   1. 요청 사용자 폴더(`${userId}/`) 키만 후보 — 경로 조작 흔적(.. · \)이 있는 키는 제외.
 *   2. photos 행을 지운 **뒤** 참조를 조회해, 아직 다른 photos 행이 참조하는 키는 남긴다.
 *   3. best-effort — 조회·삭제가 실패해도 영구 삭제(행 삭제)는 성공으로 둔다. 행이 사라진 객체는
 *      orphan-photos cron 이 참조를 다시 확인한 뒤 회수한다.
 */

export interface PurgedPhotoKeys {
  storage_key: string;
  thumb_key: string | null;
}

export interface RemovablePhotoKeys {
  originals: string[];
  thumbs: string[];
}

/** 순수 판정 — 본인 폴더 키 중 아직 참조되지 않는 키. */
export function selectRemovablePhotoKeys(
  userId: string,
  rows: readonly PurgedPhotoKeys[],
  stillReferenced: { originals: ReadonlySet<string>; thumbs: ReadonlySet<string> },
): RemovablePhotoKeys {
  return {
    originals: ownStorageKeys(
      userId,
      rows.map((r) => r.storage_key),
    ).filter((k) => !stillReferenced.originals.has(k)),
    thumbs: ownStorageKeys(
      userId,
      rows.map((r) => r.thumb_key),
    ).filter((k) => !stillReferenced.thumbs.has(k)),
  };
}

export interface PhotoStorageCleanupReport {
  removedOriginals: number;
  removedThumbs: number;
  /** 본인 폴더가 아니거나 다른 행이 참조해 남긴 키 수(원본+썸네일). */
  keptKeys: number;
  /** 참조 조회·삭제 실패로 정리를 cron 에 맡겼다. */
  deferred: boolean;
}

/**
 * 이미 photos 행을 지운 사진들의 Storage 객체를 정리한다. 던지지 않는다.
 * @param admin service_role — 다른 사용자 행의 참조까지 봐야 한다(RLS 로는 보이지 않는다).
 */
export async function removeUnreferencedPhotoObjects(
  admin: SupabaseClient<Database>,
  userId: string,
  rows: readonly PurgedPhotoKeys[],
): Promise<PhotoStorageCleanupReport> {
  const ownOriginals = ownStorageKeys(userId, rows.map((r) => r.storage_key));
  const ownThumbs = ownStorageKeys(userId, rows.map((r) => r.thumb_key));
  const candidateCount =
    new Set(rows.map((r) => r.storage_key)).size +
    new Set(rows.map((r) => r.thumb_key).filter((k): k is string => Boolean(k))).size;
  const report: PhotoStorageCleanupReport = {
    removedOriginals: 0,
    removedThumbs: 0,
    keptKeys: 0,
    deferred: false,
  };
  if (ownOriginals.length === 0 && ownThumbs.length === 0) {
    report.keptKeys = candidateCount;
    return report;
  }

  try {
    const referencedOriginals = new Set<string>();
    if (ownOriginals.length > 0) {
      const { data, error } = await admin
        .from("photos")
        .select("storage_key")
        .in("storage_key", ownOriginals);
      if (error) throw new Error(`photos.storage_key 참조 조회 실패: ${error.message}`);
      for (const r of data ?? []) referencedOriginals.add(r.storage_key);
    }
    const referencedThumbs = new Set<string>();
    if (ownThumbs.length > 0) {
      const { data, error } = await admin
        .from("photos")
        .select("thumb_key")
        .in("thumb_key", ownThumbs);
      if (error) throw new Error(`photos.thumb_key 참조 조회 실패: ${error.message}`);
      for (const r of data ?? []) {
        if (r.thumb_key) referencedThumbs.add(r.thumb_key);
      }
    }

    const removable = selectRemovablePhotoKeys(userId, rows, {
      originals: referencedOriginals,
      thumbs: referencedThumbs,
    });
    report.keptKeys =
      candidateCount - removable.originals.length - removable.thumbs.length;

    if (removable.originals.length > 0) {
      const { error } = await admin.storage
        .from(ORIGINALS_BUCKET)
        .remove(removable.originals);
      if (error) throw new Error(`storage.remove(originals) 실패: ${error.message}`);
      report.removedOriginals = removable.originals.length;
    }
    if (removable.thumbs.length > 0) {
      const { error } = await admin.storage.from(THUMBS_BUCKET).remove(removable.thumbs);
      if (error) throw new Error(`storage.remove(thumbs) 실패: ${error.message}`);
      report.removedThumbs = removable.thumbs.length;
    }
  } catch (err) {
    report.deferred = true;
    console.warn(
      "[photos/purge] Storage 정리 실패 — orphan-photos cron 에 맡긴다:",
      err instanceof Error ? err.message : err,
    );
  }
  return report;
}

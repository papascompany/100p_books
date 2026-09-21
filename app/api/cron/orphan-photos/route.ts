import "server-only";

import { fail, failFromError, ok } from "@/app/api/_lib/response";
import { createAdminSupabase } from "@/lib/db/admin";
import { ORIGINALS_BUCKET, THUMBS_BUCKET } from "@/lib/image/constants";
import { verifyCronRequest } from "@/lib/security/cron-auth";

import {
  isAgedObject,
  planOrphanDeletion,
  type StorageEntry,
} from "./orphan-select";

export const dynamic = "force-dynamic";
/**
 * ⚠️ 필수 — 없으면 Next 가 Supabase storage list / photos 조회 응답을 캐시해서
 * **낡은 스냅샷으로 삭제를 판단**한다. 실측: 고아 3건을 실제로 지운 직후에도
 * 이 라우트는 계속 "고아 3건" 을 4ms 만에 반환했다(같은 로직을 standalone 으로
 * 돌리면 630ms·0건). 파괴적 cron 에서 이런 캐시는 그 사이 확정된 사진을 지울 수 있다.
 */
export const fetchCache = "force-no-store";
export const runtime = "nodejs";
export const maxDuration = 60;

type AdminClient = ReturnType<typeof createAdminSupabase>;
type StorageBucket = AdminClient["storage"] extends { from: (b: string) => infer R }
  ? R
  : never;

/** IN 절 길이 제한 회피용 청크. */
const CHUNK = 200;

interface BucketScan {
  candidates: string[];
  listCalls: number;
  truncated: boolean;
}

/**
 * 한 버킷의 `{userId}/{projectId}/{객체}` 트리를 훑어 cutoff 를 넘긴 객체 키를 모은다.
 * list 호출 수는 버킷마다 독립 예산이다 — 원본 스캔이 예산을 다 써도 썸네일 스캔이 굶지 않게.
 */
async function scanAgedObjects(
  bucket: StorageBucket,
  cutoffMs: number,
  maxListCalls: number,
): Promise<BucketScan> {
  let listCalls = 0;
  const budgetLeft = () => listCalls < maxListCalls;

  const listAll = async (prefix: string): Promise<StorageEntry[]> => {
    const out: StorageEntry[] = [];
    const pageSize = 100;
    for (let offset = 0; budgetLeft(); offset += pageSize) {
      listCalls += 1;
      const { data, error } = await bucket.list(prefix, {
        limit: pageSize,
        offset,
      });
      if (error || !data) break;
      out.push(...(data as StorageEntry[]));
      if (data.length < pageSize) break;
    }
    return out;
  };

  const candidates: string[] = [];
  let truncated = false;

  for (const userDir of await listAll("")) {
    if (userDir.id !== null) continue; // 폴더만 (id 가 있으면 객체)
    if (!budgetLeft()) {
      truncated = true;
      break;
    }
    for (const projectDir of await listAll(userDir.name)) {
      if (projectDir.id !== null) continue;
      if (!budgetLeft()) {
        truncated = true;
        break;
      }
      const prefix = `${userDir.name}/${projectDir.name}`;
      for (const obj of await listAll(prefix)) {
        if (!isAgedObject(obj, cutoffMs)) continue; // 폴더·최근 객체 제외
        candidates.push(`${prefix}/${obj.name}`);
      }
    }
    if (truncated) break;
  }

  return { candidates, listCalls, truncated };
}

/**
 * GET /api/cron/orphan-photos
 *
 * 고아 객체 회수 — storage 에는 있는데 참조하는 `photos` 행이 없는 객체를 지운다.
 * **원본(photo-originals)과 썸네일(photo-thumbs) 양쪽**을 각자의 참조 컬럼으로 판정한다
 * (`storage_key` / `thumb_key`). 판정 규약과 그 근거는 ./orphan-select.ts 참고.
 *
 * 고아가 생기는 경로:
 *   - 업로드 PUT 이 끝난 직후 사용자가 탭을 닫아 `/api/photos/complete` 가 못 간 경우
 *     (pagehide sendBeacon 으로 대부분 막지만, 강제 종료·네트워크 단절은 남는다)
 *   - complete 가 썸네일을 올린 뒤 photos INSERT 가 5xx 로 끝난 경우 → **썸네일만 고아**
 *   - 휴지통 영구 삭제(app/api/photos/purge)가 참조 조회·삭제에 실패해 정리를 미룬 경우
 *   - 선물 수령 롤백에서 storage.remove 가 실패한 경우
 *   - 클라이언트의 abandon 호출이 실패한 경우
 * 이 cron 이 최후 방어선이다.
 *
 * 안전장치:
 *   - `cutoffHours`(기본 24) 보다 **오래된 객체만** 본다. 지금 업로드 중인 파일을 지우면 안 된다.
 *   - 삭제 직전 photos 를 `storage_key`·`thumb_key` 로 다시 조회해 **참조가 하나도 없을 때만** 지운다.
 *     소프트 삭제(`deleted_at`) 행도 참조로 친다 — 휴지통에서 복구할 수 있어야 한다.
 *     service_role 로 조회하므로 다른 사용자의 행이 가진 참조도 보인다(선물 폴백으로 발신자 키를
 *     공유하는 수령자 행이 대표적이다).
 *   - list 호출 수와 삭제 수에 상한을 두고, 상한에 걸리면 응답에 명시한다(조용한 절단 금지).
 *
 * 인증: `Authorization: Bearer <CRON_SECRET>` 만 인정 (lib/security/cron-auth.ts).
 *
 * `?dryRun=1` — 삭제하지 않고 집계만 반환한다(버킷별 건수 포함). 운영에 처음 붙일 때는 반드시
 * 이걸로 규모를 먼저 확인한다(이 엔드포인트는 되돌릴 수 없는 삭제를 한다).
 */
export async function GET(req: Request) {
  try {
    // 인증 규칙은 lib/security/cron-auth.ts 한 곳에서 관리한다 (SEC-14).
    const cronAuth = verifyCronRequest(req);
    if (!cronAuth.ok) {
      return fail(cronAuth.code, cronAuth.message, cronAuth.status);
    }

    const dryRun = new URL(req.url).searchParams.get("dryRun") === "1";
    const start = Date.now();
    const cutoffHours = parsePositiveInt(process.env.ORPHAN_CUTOFF_HOURS, 24);
    const maxListCalls = parsePositiveInt(process.env.ORPHAN_MAX_LIST_CALLS, 300);
    const maxDeletes = parsePositiveInt(process.env.ORPHAN_MAX_DELETES, 500);
    const cutoffMs = Date.now() - cutoffHours * 3_600_000;

    const admin = createAdminSupabase();
    const originalsBucket = admin.storage.from(ORIGINALS_BUCKET);
    const thumbsBucket = admin.storage.from(THUMBS_BUCKET);

    const originalScan = await scanAgedObjects(
      originalsBucket,
      cutoffMs,
      maxListCalls,
    );
    const thumbScan = await scanAgedObjects(
      thumbsBucket,
      cutoffMs,
      maxListCalls,
    );
    const listCalls = originalScan.listCalls + thumbScan.listCalls;
    const listTruncated = originalScan.truncated || thumbScan.truncated;

    // 참조 조회 — 원본은 storage_key, 썸네일은 thumb_key.
    // deleted_at 필터를 걸지 않는다: 휴지통 행도 여전히 객체를 참조한다.
    const referencedStorageKeys = new Set<string>();
    for (let i = 0; i < originalScan.candidates.length; i += CHUNK) {
      const slice = originalScan.candidates.slice(i, i + CHUNK);
      const { data, error } = await admin
        .from("photos")
        .select("storage_key")
        .in("storage_key", slice);
      if (error) return fail("PHOTOS_QUERY_FAILED", error.message, 500);
      for (const r of data ?? []) referencedStorageKeys.add(r.storage_key);
    }

    const referencedThumbKeys = new Set<string>();
    for (let i = 0; i < thumbScan.candidates.length; i += CHUNK) {
      const slice = thumbScan.candidates.slice(i, i + CHUNK);
      const { data, error } = await admin
        .from("photos")
        .select("thumb_key")
        .in("thumb_key", slice);
      if (error) return fail("PHOTOS_THUMB_QUERY_FAILED", error.message, 500);
      for (const r of data ?? []) {
        if (r.thumb_key) referencedThumbKeys.add(r.thumb_key);
      }
    }

    const plan = planOrphanDeletion(
      { originals: originalScan.candidates, thumbs: thumbScan.candidates },
      { storageKeys: referencedStorageKeys, thumbKeys: referencedThumbKeys },
      maxDeletes,
    );
    const truncated = listTruncated || plan.deleteTruncated;
    const scanned = plan.originals.scanned + plan.thumbs.scanned;
    const orphans = plan.originals.orphans + plan.thumbs.orphans;

    if (dryRun) {
      return ok({
        dryRun: true,
        scanned,
        orphans,
        wouldDelete: plan.originals.toDelete.length + plan.thumbs.toDelete.length,
        buckets: {
          [ORIGINALS_BUCKET]: {
            scanned: plan.originals.scanned,
            orphans: plan.originals.orphans,
            wouldDelete: plan.originals.toDelete.length,
            sample: plan.originals.toDelete.slice(0, 10),
          },
          [THUMBS_BUCKET]: {
            scanned: plan.thumbs.scanned,
            orphans: plan.thumbs.orphans,
            wouldDelete: plan.thumbs.toDelete.length,
            sample: plan.thumbs.toDelete.slice(0, 10),
          },
        },
        truncated,
        listCalls,
        cutoffHours,
        durationMs: Date.now() - start,
      });
    }

    const deletedOriginals = await removeKeys(
      originalsBucket,
      ORIGINALS_BUCKET,
      plan.originals.toDelete,
    );
    const deletedThumbs = await removeKeys(
      thumbsBucket,
      THUMBS_BUCKET,
      plan.thumbs.toDelete,
    );

    return ok({
      dryRun: false,
      scanned,
      orphans,
      deleted: deletedOriginals + deletedThumbs,
      buckets: {
        [ORIGINALS_BUCKET]: {
          scanned: plan.originals.scanned,
          orphans: plan.originals.orphans,
          deleted: deletedOriginals,
        },
        [THUMBS_BUCKET]: {
          scanned: plan.thumbs.scanned,
          orphans: plan.thumbs.orphans,
          deleted: deletedThumbs,
        },
      },
      truncated,
      listCalls,
      cutoffHours,
      durationMs: Date.now() - start,
    });
  } catch (err) {
    return failFromError(err);
  }
}

/** 청크 단위 삭제 — 실패한 청크는 건너뛰고 다음 실행에 맡긴다. 실제 삭제된 수를 반환. */
async function removeKeys(
  bucket: StorageBucket,
  bucketName: string,
  keys: readonly string[],
): Promise<number> {
  let deleted = 0;
  for (let i = 0; i < keys.length; i += CHUNK) {
    const slice = keys.slice(i, i + CHUNK);
    const { error } = await bucket.remove([...slice]);
    if (error) {
      console.warn(`[cron/orphan-photos] ${bucketName} 삭제 실패:`, error.message);
      continue;
    }
    deleted += slice.length;
  }
  return deleted;
}

function parsePositiveInt(v: string | undefined, fallback: number): number {
  const n = v ? Number.parseInt(v, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

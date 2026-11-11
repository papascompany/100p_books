import "server-only";

import type { createAdminSupabase } from "@/lib/db/admin";
import { RESOURCE_CONSTRAINTS, RESOURCES_BUCKET } from "@/lib/admin/resources";

/**
 * `resources` 버킷 고아 객체 회수.
 *
 * 관리자 업로드는 브라우저 → Storage(서명 URL) → `POST /api/admin/resources` finalize 순서다.
 * PUT 만 끝나고 finalize 가 안 오면(탭 종료·메타 오류) 객체만 남는다. `resources` 행이
 * 그 storage_key 를 가진 적이 없고 grace 기간을 넘긴 객체만 지운다.
 *
 * 안전장치(orphan-photos 와 동일 철학):
 *  - 생성 시각을 못 읽거나 cutoff 보다 어리면 지우지 않는다(진행 중 업로드/finalize 보호).
 *  - list 오류는 그 prefix 의 후보를 줄일 뿐이다. 참조 조회 오류는 **아무것도 지우지 않고** 오류 반환.
 *  - 비활성(active=false) 행도 참조로 친다 — active 필터를 걸지 않는다.
 *  - list 호출 수·삭제 수 상한, 상한에 걸리면 truncated 로 명시.
 */

type AdminClient = ReturnType<typeof createAdminSupabase>;

const CHUNK = 200;
const PAGE = 100;

export const RESOURCE_ORPHAN_PREFIXES: readonly string[] = Object.values(
  RESOURCE_CONSTRAINTS,
).map((c) => c.pathPrefix);

export interface ResourceOrphanOptions {
  /** 이 시각(ms) 이하로 생성된 객체만 후보. */
  cutoffMs: number;
  maxListCalls: number;
  maxDeletes: number;
  dryRun: boolean;
}

export interface ResourceOrphanResult {
  ok: boolean;
  error?: string;
  dryRun: boolean;
  /** cutoff 를 넘긴 객체 수. */
  scanned: number;
  orphans: number;
  /** 실제 삭제 수 (dryRun 이면 0). */
  deleted: number;
  /** 상한 적용 후 이번 실행의 삭제 대상 수. */
  wouldDelete: number;
  sample: string[];
  truncated: boolean;
  listCalls: number;
}

interface Entry {
  name: string;
  id: string | null;
  created_at?: string;
}

function isAged(e: Entry, cutoffMs: number): boolean {
  if (e.id === null) return false;
  const t = e.created_at ? Date.parse(e.created_at) : NaN;
  return Number.isFinite(t) && t <= cutoffMs;
}

export async function reapOrphanResources(
  admin: AdminClient,
  opts: ResourceOrphanOptions,
): Promise<ResourceOrphanResult> {
  const bucket = admin.storage.from(RESOURCES_BUCKET);
  let listCalls = 0;
  let truncated = false;
  const candidates: string[] = [];

  for (const prefix of RESOURCE_ORPHAN_PREFIXES) {
    for (let offset = 0; ; offset += PAGE) {
      if (listCalls >= opts.maxListCalls) {
        truncated = true;
        break;
      }
      listCalls += 1;
      const { data, error } = await bucket.list(prefix, {
        limit: PAGE,
        offset,
      });
      if (error || !data) break;
      for (const e of data as Entry[]) {
        if (isAged(e, opts.cutoffMs)) candidates.push(`${prefix}/${e.name}`);
      }
      if (data.length < PAGE) break;
    }
  }

  const referenced = new Set<string>();
  for (let i = 0; i < candidates.length; i += CHUNK) {
    const { data, error } = await admin
      .from("resources")
      .select("storage_key")
      .in("storage_key", candidates.slice(i, i + CHUNK));
    if (error) {
      return {
        ok: false,
        error: error.message,
        dryRun: opts.dryRun,
        scanned: candidates.length,
        orphans: 0,
        deleted: 0,
        wouldDelete: 0,
        sample: [],
        truncated,
        listCalls,
      };
    }
    for (const r of data ?? []) referenced.add(r.storage_key);
  }

  const orphans = candidates.filter((k) => !referenced.has(k));
  const toDelete = orphans.slice(0, Math.max(0, opts.maxDeletes));
  if (toDelete.length < orphans.length) truncated = true;

  let deleted = 0;
  if (!opts.dryRun) {
    for (let i = 0; i < toDelete.length; i += CHUNK) {
      const slice = toDelete.slice(i, i + CHUNK);
      const { error } = await bucket.remove(slice);
      if (error) {
        console.warn(
          `[cron/orphan-photos] ${RESOURCES_BUCKET} 삭제 실패:`,
          error.message,
        );
        continue;
      }
      deleted += slice.length;
    }
    console.info(
      `[cron/orphan-photos] 삭제 ${RESOURCES_BUCKET}=${deleted}/${orphans.length}` +
        ` scanned=${candidates.length} truncated=${truncated}`,
    );
  }

  return {
    ok: true,
    dryRun: opts.dryRun,
    scanned: candidates.length,
    orphans: orphans.length,
    deleted,
    wouldDelete: toDelete.length,
    sample: toDelete.slice(0, 10),
    truncated,
    listCalls,
  };
}

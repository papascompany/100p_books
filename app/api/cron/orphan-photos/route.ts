import "server-only";

import { fail, failFromError, ok } from "@/app/api/_lib/response";
import { createAdminSupabase } from "@/lib/db/admin";
import { ORIGINALS_BUCKET, THUMBS_BUCKET } from "@/lib/image/constants";

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

/**
 * GET /api/cron/orphan-photos
 *
 * 고아 원본 회수 — storage 에는 있는데 참조하는 `photos` 행이 없는 객체를 지운다.
 *
 * 고아가 생기는 경로:
 *   - 업로드 PUT 이 끝난 직후 사용자가 탭을 닫아 `/api/photos/complete` 가 못 간 경우
 *     (pagehide sendBeacon 으로 대부분 막지만, 강제 종료·네트워크 단절은 남는다)
 *   - complete 가 5xx 로 끝난 경우
 *   - 클라이언트의 abandon 호출이 실패한 경우
 * 이 cron 이 최후 방어선이다.
 *
 * 안전장치:
 *   - `cutoffHours`(기본 24) 보다 **오래된 객체만** 본다. 지금 업로드 중인 파일을 지우면 안 된다.
 *   - 삭제 직전 photos 를 storage_key 로 다시 조회해 행이 없을 때만 지운다.
 *   - list 호출 수와 삭제 수에 상한을 두고, 상한에 걸리면 응답에 명시한다(조용한 절단 금지).
 *
 * 인증: CRON_SECRET 이 있으면 Bearer 강제, 없으면 x-vercel-cron 헤더.
 *
 * `?dryRun=1` — 삭제하지 않고 집계만 반환한다. 운영에 처음 붙일 때는 반드시 이걸로
 * 규모를 먼저 확인한다(이 엔드포인트는 되돌릴 수 없는 삭제를 한다).
 */
export async function GET(req: Request) {
  try {
    const auth = req.headers.get("authorization") ?? "";
    const secret = process.env.CRON_SECRET;
    const isVercelCron = req.headers.get("x-vercel-cron") === "1";
    if (secret) {
      if (auth !== `Bearer ${secret}`) {
        return fail("UNAUTHORIZED", "인증 헤더가 올바르지 않습니다.", 401);
      }
    } else if (!isVercelCron) {
      return fail("CRON_NOT_CONFIGURED", "CRON_SECRET 이 설정되지 않았습니다.", 500);
    }

    const dryRun = new URL(req.url).searchParams.get("dryRun") === "1";
    const start = Date.now();
    const cutoffHours = parsePositiveInt(process.env.ORPHAN_CUTOFF_HOURS, 24);
    const maxListCalls = parsePositiveInt(process.env.ORPHAN_MAX_LIST_CALLS, 300);
    const maxDeletes = parsePositiveInt(process.env.ORPHAN_MAX_DELETES, 500);
    const cutoffMs = Date.now() - cutoffHours * 3_600_000;

    const admin = createAdminSupabase();
    const bucket = admin.storage.from(ORIGINALS_BUCKET);

    let listCalls = 0;
    const budgetLeft = () => listCalls < maxListCalls;

    /** 한 prefix 의 항목을 페이지네이션으로 모두 읽는다. */
    async function listAll(prefix: string) {
      const out: Array<{ name: string; id: string | null; created_at?: string }> = [];
      const pageSize = 100;
      for (let offset = 0; budgetLeft(); offset += pageSize) {
        listCalls += 1;
        const { data, error } = await bucket.list(prefix, {
          limit: pageSize,
          offset,
        });
        if (error || !data) break;
        out.push(...(data as typeof out));
        if (data.length < pageSize) break;
      }
      return out;
    }

    // user/ → user/project/ → 객체
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
          if (obj.id === null) continue; // 하위 폴더는 규약상 없음
          const created = obj.created_at ? Date.parse(obj.created_at) : NaN;
          if (!Number.isFinite(created) || created > cutoffMs) continue;
          candidates.push(`${prefix}/${obj.name}`);
        }
      }
      if (truncated) break;
    }

    if (candidates.length === 0) {
      return ok({
        dryRun,
        scanned: 0,
        deleted: 0,
        truncated,
        cutoffHours,
        durationMs: Date.now() - start,
      });
    }

    // photos 에 없는 key 만 남긴다 (IN 절 길이 제한 회피용 청크)
    const orphans: string[] = [];
    const CHUNK = 200;
    for (let i = 0; i < candidates.length; i += CHUNK) {
      const slice = candidates.slice(i, i + CHUNK);
      const { data, error } = await admin
        .from("photos")
        .select("storage_key")
        .in("storage_key", slice);
      if (error) return fail("PHOTOS_QUERY_FAILED", error.message, 500);
      const known = new Set((data ?? []).map((r) => r.storage_key));
      for (const k of slice) if (!known.has(k)) orphans.push(k);
    }

    const toDelete = orphans.slice(0, maxDeletes);
    const deleteTruncated = orphans.length > toDelete.length;

    if (dryRun) {
      return ok({
        dryRun: true,
        scanned: candidates.length,
        orphans: orphans.length,
        wouldDelete: toDelete.length,
        sample: toDelete.slice(0, 10),
        truncated: truncated || deleteTruncated,
        listCalls,
        cutoffHours,
        durationMs: Date.now() - start,
      });
    }

    let deleted = 0;
    for (let i = 0; i < toDelete.length; i += CHUNK) {
      const slice = toDelete.slice(i, i + CHUNK);
      const { error } = await bucket.remove(slice);
      if (error) continue;
      deleted += slice.length;
      // 썸네일은 complete 단계에서만 생기므로 대개 없다 — 있으면 함께 정리.
      await admin.storage
        .from(THUMBS_BUCKET)
        .remove(slice.map((k) => k.replace(/\.[^.]+$/, ".webp")));
    }

    return ok({
      scanned: candidates.length,
      orphans: orphans.length,
      deleted,
      truncated: truncated || deleteTruncated,
      listCalls,
      cutoffHours,
      durationMs: Date.now() - start,
    });
  } catch (err) {
    return failFromError(err);
  }
}

function parsePositiveInt(v: string | undefined, fallback: number): number {
  const n = v ? Number.parseInt(v, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

import "server-only";

import { fail, failFromError, ok } from "@/app/api/_lib/response";
import { createAdminSupabase } from "@/lib/db/admin";
import { STORIGE_RETENTION_DAYS_DEFAULT } from "@/lib/pdf/constants";
import { deleteFile, STORIGE_ENABLED } from "@/lib/storige/client";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * GET /api/cron/storige-retention
 *
 * PDF 보존정책 — 배송 완료(delivered) + N일 경과 주문의 Storige PDF 를 삭제하고
 * orders.storige_*_file_id 를 NULL 처리한다.
 *
 * 근거: PDF 의 단일 진실원본은 PageDoc(DB). PDF 는 재생성 가능한 파생물이므로
 *       장기 보관 대상이 아니다. 활성 주문분만 Storige 에 남긴다.
 *       (재인쇄/CS 는 PageDoc 에서 온디맨드 재생성 → rebuild-pdf.)
 *
 * 인증: x-vercel-cron 헤더 또는 Authorization: Bearer CRON_SECRET.
 * Storige 미설정 시 fail-open (skipped) — 삭제하지 않는다.
 *
 * 안전장치:
 *   - delivered_at 기준 (updated_at 아님) — 이후 상태 변경이 시계를 리셋하지 않게.
 *   - Storige delete 가 일시 오류(5xx/네트워크)면 DB 를 비우지 않고 다음 run 에서 재시도.
 *   - delete 성공/이미없음(404)/미지원(405·501) 이면 DB 컬럼 NULL 처리.
 */
export async function GET(req: Request) {
  try {
    // 파괴적(삭제) 엔드포인트 — x-vercel-cron 헤더 단독 신뢰를 피하고
    // CRON_SECRET 이 설정되면 항상 Bearer 검증을 강제한다.
    //   - Vercel Cron 은 CRON_SECRET 설정 시 Authorization: Bearer 를 자동 부여하므로
    //     실제 cron 호출은 그대로 통과.
    //   - CRON_SECRET 미설정 시에만 x-vercel-cron 헤더로 fallback (수동 호출 차단).
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

    if (!STORIGE_ENABLED) {
      return ok({ skipped: true, reason: "STORIGE not configured" });
    }

    const start = Date.now();
    const days = parsePositiveInt(
      process.env.STORIGE_RETENTION_DAYS,
      STORIGE_RETENTION_DAYS_DEFAULT,
    );
    const batch = parsePositiveInt(process.env.STORIGE_RETENTION_BATCH, 80);
    const cutoffIso = new Date(Date.now() - days * 86_400_000).toISOString();

    const admin = createAdminSupabase();
    const { data: rows, error } = await admin
      .from("orders")
      .select("id, storige_cover_file_id, storige_interior_file_id")
      .eq("status", "delivered")
      .lt("delivered_at", cutoffIso)
      .or(
        "storige_cover_file_id.not.is.null,storige_interior_file_id.not.is.null",
      )
      .order("delivered_at", { ascending: true })
      .limit(batch);
    if (error) return fail("QUERY_FAILED", error.message, 500);

    const orders = rows ?? [];
    let scanned = 0;
    let cleared = 0;
    let deletedFiles = 0;
    let failedFiles = 0;

    for (const o of orders) {
      scanned += 1;
      const patch: Record<string, unknown> = {};
      let clearedCover = false;
      let clearedInterior = false;

      if (o.storige_cover_file_id) {
        const r = await deleteFile(o.storige_cover_file_id);
        if (r.ok || !r.supported) {
          patch.storige_cover_file_id = null;
          clearedCover = true;
          deletedFiles += 1;
        } else {
          failedFiles += 1;
        }
      } else {
        clearedCover = true; // 이미 없음
      }

      if (o.storige_interior_file_id) {
        const r = await deleteFile(o.storige_interior_file_id);
        if (r.ok || !r.supported) {
          patch.storige_interior_file_id = null;
          clearedInterior = true;
          deletedFiles += 1;
        } else {
          failedFiles += 1;
        }
      } else {
        clearedInterior = true;
      }

      // 양쪽 모두 정리되면 검증 캐시도 비운다.
      if (clearedCover && clearedInterior) patch.storige_validation = null;

      if (Object.keys(patch).length > 0) {
        await admin.from("orders").update(patch).eq("id", o.id);
        cleared += 1;
      }
    }

    return ok({
      skipped: false,
      retentionDays: days,
      scanned,
      cleared,
      deletedFiles,
      failedFiles,
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

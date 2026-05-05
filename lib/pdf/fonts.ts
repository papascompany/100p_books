import "server-only";

import { GlobalFonts } from "@napi-rs/canvas";

import { createAdminSupabase } from "@/lib/db/admin";
import type { PageDoc } from "@/lib/layout/types";

/**
 * 폰트 등록 — 두 단계.
 *
 *   1. PNG 렌더 단계: napi-rs/canvas 의 GlobalFonts 에 family 이름으로 register.
 *   2. PDF 합성 단계: 페이지에 직접 PDF 텍스트를 그리지는 않지만, 향후 임베디드
 *      텍스트(검색 가능 PDF)를 추가할 때 사용할 수 있도록 pdf-lib font 객체를
 *      반환하는 헬퍼를 노출.
 *
 * 폰트 source:
 *   - resources 테이블 type='font' + storage_key (Storage `resources` 버킷).
 *   - 본 단계에서는 active 한 폰트를 모두 미리 등록해 두는 단순 전략.
 *
 * 메모리: 폰트 buffer 는 GlobalFonts.register 호출 즉시 napi 측에서 보관하므로
 *         호출 후에는 우리쪽 참조를 끊어 GC 대상이 되도록 한다.
 */

const REGISTERED = new Set<string>();

/** Pretendard 등 시스템 폴백 family — 등록 실패 시 graceful fallback. */
const SYSTEM_FALLBACKS = ["Pretendard", "system-ui", "sans-serif"];

interface FontRow {
  id: string;
  name: string;
  storage_key: string;
  meta: Record<string, unknown> | null;
}

/**
 * resources.font 항목들을 로드해서 napi-rs/canvas 에 등록.
 *
 *   - meta.family 가 있으면 우선 사용, 없으면 resources.name.
 *   - 다운로드 실패 / 잘못된 포맷 항목은 경고만 찍고 다음 폰트로 진행.
 *
 * 같은 family 가 두 번 등록되어도 문제없으나, 이 모듈은 이미 등록된 family 를
 * 스킵해서 콜드 스타트 후 첫 빌드만 등록되도록 한다.
 */
export async function registerProjectFonts(opts: {
  /** 사용된 family 이름들 — 빈 배열이면 "전체 active 폰트" 등록. */
  families?: string[];
}): Promise<{ registered: string[]; skipped: string[] }> {
  const admin = createAdminSupabase();

  let query = admin
    .from("resources")
    .select("id, name, storage_key, meta")
    .eq("type", "font")
    .eq("active", true);

  const wanted = (opts.families ?? []).filter(
    (f) => f && !SYSTEM_FALLBACKS.includes(f),
  );
  if (wanted.length > 0) {
    // resources.name 또는 meta->>family 에 매칭. PostgREST or 필터.
    query = query.or(
      wanted
        .map(
          (f) =>
            `name.eq.${escapeOrValue(f)},meta->>family.eq.${escapeOrValue(f)}`,
        )
        .join(","),
    );
  }

  const { data, error } = await query;
  if (error) {
    console.warn("[pdf/fonts] resources query failed:", error.message);
    return { registered: [], skipped: wanted };
  }

  const rows = (data ?? []) as FontRow[];
  const registered: string[] = [];
  const skipped: string[] = [];

  await Promise.all(
    rows.map(async (row) => {
      const family =
        (row.meta && typeof row.meta === "object" && (row.meta as Record<string, unknown>).family
          ? String((row.meta as Record<string, unknown>).family)
          : "") || row.name;

      if (REGISTERED.has(family)) {
        registered.push(family);
        return;
      }

      try {
        const { data: blob, error: dlErr } = await admin.storage
          .from("resources")
          .download(row.storage_key);
        if (dlErr || !blob) {
          skipped.push(family);
          console.warn(
            `[pdf/fonts] download failed for ${family}: ${dlErr?.message ?? "no blob"}`,
          );
          return;
        }
        const ab = await blob.arrayBuffer();
        const buffer = Buffer.from(ab);
        const ok = GlobalFonts.register(buffer, family);
        if (ok) {
          REGISTERED.add(family);
          registered.push(family);
        } else {
          skipped.push(family);
        }
      } catch (e) {
        skipped.push(family);
        console.warn(
          `[pdf/fonts] register failed for ${family}: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }),
  );

  return { registered, skipped };
}

/**
 * PageDoc 배열에서 사용된 모든 fontFamily 수집 (textObject + cover textObject).
 */
export function collectFontFamilies(docs: PageDoc[]): string[] {
  const set = new Set<string>();
  for (const d of docs) {
    for (const obj of d.objects) {
      if (obj.type === "text" && obj.fontFamily) set.add(obj.fontFamily);
    }
  }
  return Array.from(set);
}

/** PostgREST `or` 필터의 값에 콤마/괄호가 들어가면 깨지므로 따옴표 처리. */
function escapeOrValue(v: string): string {
  if (/[,()]/.test(v)) return `"${v.replace(/"/g, '\\"')}"`;
  return v;
}

// 본 단계 PDF 합성은 PNG 위에 합성하는 방식이라 pdf-lib 측 폰트 임베딩은 사용하지 않는다.
// 검색 가능 PDF (텍스트 레이어) 도입 시 별도 헬퍼 추가 예정.

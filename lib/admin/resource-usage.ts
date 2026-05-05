import "server-only";

import { createAdminSupabase } from "@/lib/db/admin";
import type { ResourceType } from "@/lib/db/types";

/**
 * 리소스(폰트/클립아트/배경)가 페이지/표지 어디서 사용되는지 검색.
 *
 * jsonb 전체 직렬화 후 ilike 단순 매칭 — 정확도는 낮지만 보수적 (false positive 가능,
 * false negative 는 최소화). DB 인덱스 없이 동작 가능한 fallback 전략.
 *
 * 매칭 키워드:
 *  - font: meta.family (없으면 name) — fontFamily 속성 매칭
 *  - clipart / background: storage_key 의 basename — 페이지가 보관한 url 또는 storage_key 매칭
 */
export interface ResourceUsage {
  /** pages.fabric_json 에서 발견된 행 수 */
  usedInPages: number;
  /** projects.cover_json 에서 발견된 행 수 */
  usedInCovers: number;
  /** 키워드 (디버깅/표시용) */
  keywords: string[];
}

interface ResourceRow {
  id: string;
  type: ResourceType;
  name: string;
  storage_key: string;
  meta: Record<string, unknown> | null;
}

function buildKeywords(row: ResourceRow): string[] {
  const out: string[] = [];
  if (row.type === "font") {
    const family =
      (row.meta &&
        typeof row.meta["family"] === "string" &&
        (row.meta["family"] as string)) ||
      row.name;
    if (family) out.push(family);
  } else {
    // 클립아트/배경 — 파일 basename 으로 매칭
    if (row.storage_key && row.storage_key !== "pending") {
      const base = row.storage_key.split("/").pop() ?? row.storage_key;
      // 확장자 포함된 basename + 확장자 제거 둘 다 후보로
      out.push(base);
      const noExt = base.replace(/\.[a-z0-9]+$/i, "");
      if (noExt && noExt !== base) out.push(noExt);
    }
  }
  return out
    .filter((s) => s && s.length >= 2)
    .map((s) => s.replace(/[%_\\]/g, "")); // ilike 메타문자 제거
}

export async function findResourceUsage(
  resourceId: string,
): Promise<ResourceUsage> {
  const admin = createAdminSupabase();
  const { data: row, error } = await admin
    .from("resources")
    .select("id, type, name, storage_key, meta")
    .eq("id", resourceId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!row) {
    return { usedInPages: 0, usedInCovers: 0, keywords: [] };
  }
  const keywords = buildKeywords(row as ResourceRow);
  if (keywords.length === 0) {
    return { usedInPages: 0, usedInCovers: 0, keywords: [] };
  }

  // OR 조합 — 각 키워드별로 fabric_json::text ilike '%keyword%'
  // Postgres 의 jsonb::text 캐스트는 정확하진 않지만 보수적 검색으로 충분.
  const orPages = keywords
    .map((k) => `fabric_json::text.ilike.%${k}%`)
    .join(",");
  const orCovers = keywords
    .map((k) => `cover_json::text.ilike.%${k}%`)
    .join(",");

  const [pagesRes, coversRes] = await Promise.all([
    admin
      .from("pages")
      .select("id", { count: "exact", head: true })
      .or(orPages),
    admin
      .from("projects")
      .select("id", { count: "exact", head: true })
      .or(orCovers),
  ]);

  return {
    usedInPages: pagesRes.count ?? 0,
    usedInCovers: coversRes.count ?? 0,
    keywords,
  };
}

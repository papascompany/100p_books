import "server-only";

import { z } from "zod";

import { fail, failFromError, ok } from "@/app/api/_lib/response";
import { requireUser } from "@/lib/auth/session";
import { createAdminSupabase } from "@/lib/db/admin";
import { createServerSupabase } from "@/lib/db/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const RESOURCE_BUCKET = "resources";
const SIGNED_TTL_SEC = 3600;

const QuerySchema = z.object({
  type: z.enum(["font", "clipart", "background"]),
  q: z.string().trim().max(60).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

/**
 * GET /api/resources?type=font|clipart|background
 *
 * - 인증된 모든 사용자 접근 가능.
 * - active=true 만 응답.
 * - storage_key 가 있으면 admin 클라로 signed URL 일괄 발급.
 *   (resources 버킷이 public 이라면 publicUrl 로 대체 가능 — 본 라우트는 signed URL 우선.)
 *
 * 응답: { items: [{ id, type, name, url, meta }] }
 *
 * 캐시 헤더: Cache-Control: private, max-age=300, stale-while-revalidate=600
 */
export async function GET(req: Request) {
  try {
    await requireUser();

    const url = new URL(req.url);
    const parsed = QuerySchema.safeParse({
      type: url.searchParams.get("type"),
      q: url.searchParams.get("q") ?? undefined,
      limit: url.searchParams.get("limit") ?? undefined,
    });
    if (!parsed.success) {
      return fail(
        "INVALID_QUERY",
        "잘못된 쿼리 파라미터입니다.",
        400,
        parsed.error.flatten(),
      );
    }
    const { type, q, limit } = parsed.data;

    const supabase = createServerSupabase();
    let query = supabase
      .from("resources")
      .select("id, type, name, storage_key, meta, created_at")
      .eq("type", type)
      .eq("active", true)
      .order("created_at", { ascending: false })
      .limit(limit ?? 100);
    if (q && q.length > 0) {
      query = query.ilike("name", `%${q}%`);
    }
    const { data: rows, error } = await query;
    if (error) return fail("RESOURCES_QUERY_FAILED", error.message, 500);

    // signed URL 발급
    const items: Array<{
      id: string;
      type: string;
      name: string;
      url: string;
      meta: Record<string, unknown> | null;
    }> = [];

    if (rows && rows.length > 0) {
      const paths = rows
        .map((r) => r.storage_key)
        .filter((p): p is string => typeof p === "string" && p.length > 0);

      const urlMap = new Map<string, string>();
      if (paths.length > 0) {
        const admin = createAdminSupabase();
        const { data: signed, error: signErr } = await admin.storage
          .from(RESOURCE_BUCKET)
          .createSignedUrls(paths, SIGNED_TTL_SEC);
        if (signErr) {
          // 버킷이 public 일 수도 있으므로, signed URL 실패 시 publicUrl 로 폴백
          for (const p of paths) {
            const { data: pub } = admin.storage
              .from(RESOURCE_BUCKET)
              .getPublicUrl(p);
            if (pub.publicUrl) urlMap.set(p, pub.publicUrl);
          }
        } else {
          for (const s of signed ?? []) {
            if (s.path && s.signedUrl) urlMap.set(s.path, s.signedUrl);
          }
        }
      }

      for (const r of rows) {
        const u = r.storage_key ? urlMap.get(r.storage_key) : undefined;
        if (!u) continue;
        items.push({
          id: r.id,
          type: r.type,
          name: r.name,
          url: u,
          meta: (r.meta as Record<string, unknown> | null) ?? null,
        });
      }
    }

    const res = ok({ items });
    // 5분 캐시 + stale-while-revalidate
    res.headers.set(
      "Cache-Control",
      "private, max-age=300, stale-while-revalidate=600",
    );
    return res;
  } catch (err) {
    return failFromError(err);
  }
}

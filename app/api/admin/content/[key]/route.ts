import "server-only";

import { revalidatePath, revalidateTag } from "next/cache";
import { z } from "zod";

import { fail, ok } from "@/app/api/_lib/response";
import { withAdmin } from "@/lib/admin/auth";
import { SITE_CONTENT_DEFAULTS } from "@/lib/content/defaults";
import { getSiteContent, SITE_CONTENT_TAG } from "@/lib/content/get";
import type { SiteContentKey } from "@/lib/content/types";
import { createAdminSupabase } from "@/lib/db/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 저장 허용 key 화이트리스트 (defaults 의 키 = 정의된 모든 SiteContentKey). */
const ALLOWED_KEYS = new Set<string>(Object.keys(SITE_CONTENT_DEFAULTS));

function isContentKey(k: string): k is SiteContentKey {
  return ALLOWED_KEYS.has(k);
}

/** value 본문 최대 크기 (JSON 직렬화 길이). */
const MAX_VALUE_BYTES = 100 * 1024;

/**
 * value 는 "객체 또는 배열"만 허용. (타입별 세부 검증은 UI 신뢰 — defaults 와 병합됨.)
 */
const PutSchema = z.object({
  value: z
    .union([z.record(z.string(), z.unknown()), z.array(z.unknown())])
    .refine((v) => v !== null && typeof v === "object", {
      message: "value 는 객체 또는 배열이어야 합니다.",
    }),
});

/**
 * GET /api/admin/content/[key]
 *
 *   해당 key 의 현재 값 반환 (DB 없으면 default). withAdmin 보호.
 */
export const GET = withAdmin<{ key: string }>(async (_req, ctx) => {
  const key = ctx.params.key;
  if (!isContentKey(key)) {
    return fail("INVALID_KEY", "허용되지 않은 콘텐츠 키입니다.", 400);
  }

  const value = await getSiteContent(key);
  return ok({ key, value });
});

/**
 * PUT /api/admin/content/[key]
 *
 *   body: { value: <jsonb 객체 또는 배열> }
 *
 *   - key 는 화이트리스트만 허용.
 *   - value 직렬화 길이 100KB 제한.
 *   - upsert(key, value, updated_by) 후 랜딩/레이아웃 revalidate.
 */
export const PUT = withAdmin<{ key: string }>(async (req, ctx, user) => {
  const key = ctx.params.key;
  if (!isContentKey(key)) {
    return fail("INVALID_KEY", "허용되지 않은 콘텐츠 키입니다.", 400);
  }

  const raw = (await req.json().catch(() => ({}))) as unknown;
  const parsed = PutSchema.safeParse(raw ?? {});
  if (!parsed.success) {
    return fail(
      "INVALID_BODY",
      "요청 본문이 올바르지 않습니다.",
      400,
      parsed.error.flatten(),
    );
  }

  const { value } = parsed.data;

  // 크기 제한 — 과대 페이로드 차단.
  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch {
    return fail("INVALID_VALUE", "값을 직렬화할 수 없습니다.", 400);
  }
  if (Buffer.byteLength(serialized, "utf8") > MAX_VALUE_BYTES) {
    return fail(
      "VALUE_TOO_LARGE",
      `콘텐츠 크기가 너무 큽니다 (최대 ${Math.floor(MAX_VALUE_BYTES / 1024)}KB).`,
      413,
    );
  }

  const admin = createAdminSupabase();

  const { data, error } = await admin
    .from("site_content")
    .upsert(
      {
        key,
        value: value as never,
        updated_by: user.id,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "key" },
    )
    .select("key, value, updated_at")
    .single();

  if (error || !data) {
    return fail(
      "CONTENT_UPSERT_FAILED",
      error?.message ?? "콘텐츠 저장에 실패했습니다.",
      500,
    );
  }

  // getSiteContent unstable_cache 무효화 + 랜딩/레이아웃 재생성.
  revalidateTag(SITE_CONTENT_TAG);
  revalidatePath("/");
  revalidatePath("/", "layout");

  return ok({ key: data.key, value: data.value, updated_at: data.updated_at });
});

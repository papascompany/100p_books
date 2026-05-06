import "server-only";

import { z } from "zod";

import { fail, ok } from "@/app/api/_lib/response";
import { withAdmin } from "@/lib/admin/auth";
import { logAdminAction } from "@/lib/admin/audit";
import { createAdminSupabase } from "@/lib/db/admin";
import type { DiscountType } from "@/lib/db/types";
import { normalizeCode } from "@/lib/discounts/validate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const QuerySchema = z.object({
  q: z.string().trim().max(80).optional(),
  active: z
    .union([z.literal("true"), z.literal("false")])
    .optional(),
  page: z.coerce.number().int().min(1).max(10000).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

/**
 * GET /api/admin/discounts
 *
 *   ?q=...&active=true|false&page=1&pageSize=50
 *
 *   q : code prefix (대문자 정규화 후 ilike)
 */
export const GET = withAdmin(async (req) => {
  const url = new URL(req.url);
  const parsed = QuerySchema.safeParse({
    q: url.searchParams.get("q") ?? undefined,
    active: url.searchParams.get("active") ?? undefined,
    page: url.searchParams.get("page") ?? undefined,
    pageSize: url.searchParams.get("pageSize") ?? undefined,
  });
  if (!parsed.success) {
    return fail(
      "INVALID_QUERY",
      "쿼리 파라미터가 올바르지 않습니다.",
      400,
      parsed.error.flatten(),
    );
  }
  const { q, active, page, pageSize } = parsed.data;

  const admin = createAdminSupabase();

  let query = admin
    .from("discount_codes")
    .select(
      "id, code, type, value, max_uses, used_count, expires_at, active, created_by, created_at",
      { count: "exact" },
    )
    .order("created_at", { ascending: false });

  if (q) {
    const norm = normalizeCode(q);
    query = query.ilike("code", `${norm}%`);
  }
  if (active === "true") query = query.eq("active", true);
  if (active === "false") query = query.eq("active", false);

  const fromIdx = (page - 1) * pageSize;
  query = query.range(fromIdx, fromIdx + pageSize - 1);

  const { data, count, error } = await query;
  if (error) return fail("DISCOUNTS_QUERY_FAILED", error.message, 500);

  return ok({
    items: data ?? [],
    total: count ?? 0,
    page,
    pageSize,
  });
});

const TypeEnum = z.enum(["percent", "amount"] as const);

const PostSchema = z
  .object({
    code: z.string().trim().min(2).max(40).regex(/^[A-Za-z0-9_-]+$/, "코드는 영문/숫자/-/_ 만 사용할 수 있습니다."),
    type: TypeEnum,
    value: z.number().positive().max(10_000_000),
    /** null = 무제한 */
    maxUses: z.number().int().positive().max(1_000_000).nullable().optional(),
    /** ISO 문자열. null/undefined = 무기한 */
    expiresAt: z.string().datetime().nullable().optional(),
    active: z.boolean().optional().default(true),
  })
  .superRefine((v, ctx) => {
    if (v.type === "percent" && v.value > 100) {
      ctx.addIssue({
        code: "custom",
        path: ["value"],
        message: "퍼센트 할인은 100 이하여야 합니다.",
      });
    }
    if (v.type === "amount" && !Number.isInteger(v.value)) {
      ctx.addIssue({
        code: "custom",
        path: ["value"],
        message: "정액 할인은 정수(KRW) 여야 합니다.",
      });
    }
  });

/**
 * POST /api/admin/discounts
 *
 *   body: { code, type, value, maxUses?, expiresAt?, active? }
 *
 *   - code 는 대문자/공백제거 정규화 후 unique 제약으로 중복 방지.
 */
export const POST = withAdmin(async (req, _ctx, user) => {
  const raw = (await req.json().catch(() => ({}))) as unknown;
  const parsed = PostSchema.safeParse(raw ?? {});
  if (!parsed.success) {
    return fail(
      "INVALID_BODY",
      "요청 본문이 올바르지 않습니다.",
      400,
      parsed.error.flatten(),
    );
  }
  const v = parsed.data;
  const code = normalizeCode(v.code);
  const type: DiscountType = v.type;

  const admin = createAdminSupabase();

  const { data, error } = await admin
    .from("discount_codes")
    .insert({
      code,
      type,
      value: v.value,
      max_uses: v.maxUses ?? null,
      expires_at: v.expiresAt ?? null,
      active: v.active ?? true,
      created_by: user.id,
    })
    .select(
      "id, code, type, value, max_uses, used_count, expires_at, active, created_by, created_at",
    )
    .single();

  if (error || !data) {
    // unique 위반 — 23505
    const pgCode = (error as { code?: string } | null)?.code;
    if (pgCode === "23505") {
      return fail("CODE_DUPLICATE", "이미 존재하는 코드입니다.", 409);
    }
    return fail(
      "DISCOUNT_INSERT_FAILED",
      error?.message ?? "할인 코드 생성에 실패했습니다.",
      500,
    );
  }

  await logAdminAction({
    actor: { id: user.id, email: user.email },
    action: "discount.create",
    targetType: "discount_code",
    targetId: data.id,
    details: {
      code: data.code,
      type: data.type,
      value: data.value,
      max_uses: data.max_uses,
      expires_at: data.expires_at,
    },
    request: req,
  });

  return ok({ item: data }, { status: 201 });
});

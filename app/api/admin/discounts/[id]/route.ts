import "server-only";

import { z } from "zod";

import { fail, ok } from "@/app/api/_lib/response";
import { withAdmin } from "@/lib/admin/auth";
import { logAdminAction } from "@/lib/admin/audit";
import { createAdminSupabase } from "@/lib/db/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PatchSchema = z
  .object({
    active: z.boolean().optional(),
    /** null 로 보내면 만료일 제거 (무기한). */
    expiresAt: z.string().datetime().nullable().optional(),
    /** null 로 보내면 한도 제거 (무제한). */
    maxUses: z.number().int().positive().max(1_000_000).nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "변경할 필드가 없습니다.");

/**
 * PATCH /api/admin/discounts/[id]
 *
 *   - code/type/value 는 의도적으로 변경 불가 (회계/통계 일관성).
 *     변경하려면 새 코드를 발급하고 기존 코드는 active=false 로 비활성화.
 */
export const PATCH = withAdmin<{ id: string }>(async (req, ctx, user) => {
  const raw = (await req.json().catch(() => ({}))) as unknown;
  const parsed = PatchSchema.safeParse(raw ?? {});
  if (!parsed.success) {
    return fail(
      "INVALID_BODY",
      "요청 본문이 올바르지 않습니다.",
      400,
      parsed.error.flatten(),
    );
  }
  const v = parsed.data;

  const patch: Record<string, unknown> = {};
  if (v.active !== undefined) patch.active = v.active;
  if (v.expiresAt !== undefined) patch.expires_at = v.expiresAt;
  if (v.maxUses !== undefined) patch.max_uses = v.maxUses;

  const admin = createAdminSupabase();
  const { data, error } = await admin
    .from("discount_codes")
    .update(patch)
    .eq("id", ctx.params.id)
    .select(
      "id, code, type, value, max_uses, used_count, expires_at, active, created_by, created_at",
    )
    .maybeSingle();

  if (error) return fail("DISCOUNT_UPDATE_FAILED", error.message, 500);
  if (!data) return fail("NOT_FOUND", "코드를 찾을 수 없습니다.", 404);

  await logAdminAction({
    actor: { id: user.id, email: user.email },
    action: "discount.update",
    targetType: "discount_code",
    targetId: data.id,
    details: { changedFields: Object.keys(patch) },
    request: req,
  });

  return ok({ item: data });
});

/**
 * DELETE /api/admin/discounts/[id]
 *
 *   - 사용 이력(discount_uses)이 있으면 통계 보존을 위해 삭제 대신 비활성화 권장.
 *     강제 삭제하려면 ?force=true.
 *   - cascade 로 discount_uses 도 삭제됨 (orders.discount_code_id 는 set null).
 */
export const DELETE = withAdmin<{ id: string }>(async (req, ctx, user) => {
  const url = new URL(req.url);
  const force = url.searchParams.get("force") === "true";

  const admin = createAdminSupabase();

  const { data: row, error: fetchErr } = await admin
    .from("discount_codes")
    .select("id, code, used_count")
    .eq("id", ctx.params.id)
    .maybeSingle();
  if (fetchErr) return fail("FETCH_FAILED", fetchErr.message, 500);
  if (!row) return fail("NOT_FOUND", "코드를 찾을 수 없습니다.", 404);

  if (!force && row.used_count > 0) {
    return fail(
      "CODE_IN_USE",
      "이미 사용된 코드는 삭제할 수 없습니다. 비활성화(active=false)를 사용하세요.",
      409,
      { used_count: row.used_count },
    );
  }

  const { error: delErr } = await admin
    .from("discount_codes")
    .delete()
    .eq("id", ctx.params.id);
  if (delErr) return fail("DISCOUNT_DELETE_FAILED", delErr.message, 500);

  await logAdminAction({
    actor: { id: user.id, email: user.email },
    action: "discount.delete",
    targetType: "discount_code",
    targetId: ctx.params.id,
    details: { code: row.code, force, used_count: row.used_count },
    request: req,
  });

  return ok({ deleted: true, forced: force });
});

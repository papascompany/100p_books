import "server-only";

import { z } from "zod";

import { fail, ok } from "@/app/api/_lib/response";
import { withAdmin } from "@/lib/admin/auth";
import { logAdminAction } from "@/lib/admin/audit";
import { createAdminSupabase } from "@/lib/db/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PatchSchema = z.object({
  role: z.enum(["user", "admin"]),
});

export const PATCH = withAdmin<{ id: string }>(async (req, ctx, user) => {
  const raw = (await req.json().catch(() => ({}))) as unknown;
  const parsed = PatchSchema.safeParse(raw);
  if (!parsed.success) {
    return fail(
      "INVALID_BODY",
      "요청 본문이 올바르지 않습니다.",
      400,
      parsed.error.flatten(),
    );
  }
  const { role } = parsed.data;

  // 자기 자신을 user 로 강등 차단 (lockout 방지)
  if (ctx.params.id === user.id && role !== "admin") {
    return fail(
      "SELF_DEMOTE_FORBIDDEN",
      "자기 자신의 admin 권한을 해제할 수 없습니다.",
      400,
    );
  }

  const admin = createAdminSupabase();
  // 이전 role 조회 (감사 로그 from)
  const { data: prev } = await admin
    .from("profiles")
    .select("role")
    .eq("id", ctx.params.id)
    .maybeSingle();
  const fromRole = prev?.role ?? null;

  const { data, error } = await admin
    .from("profiles")
    .update({ role })
    .eq("id", ctx.params.id)
    .select("id, email, role, display_name, created_at")
    .maybeSingle();
  if (error) return fail("USER_UPDATE_FAILED", error.message, 500);
  if (!data) return fail("NOT_FOUND", "사용자를 찾을 수 없습니다.", 404);

  await logAdminAction({
    actor: { id: user.id, email: user.email },
    action: "user.role_change",
    targetType: "user",
    targetId: ctx.params.id,
    details: { from: fromRole, to: role },
    request: req,
  });

  return ok({ item: data });
});

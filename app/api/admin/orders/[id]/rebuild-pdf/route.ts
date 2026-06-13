import "server-only";

import { z } from "zod";

import { fail, ok } from "@/app/api/_lib/response";
import { withAdmin } from "@/lib/admin/auth";
import { logAdminAction } from "@/lib/admin/audit";
import { createAdminSupabase } from "@/lib/db/admin";
import { runProjectPdfBuild } from "@/lib/pdf/build-job";
import { storigeOrderPatch } from "@/lib/storige/order-fields";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const BodySchema = z
  .object({
    target: z.enum(["interior", "cover", "all"]).default("all"),
  })
  .default({ target: "all" });

/**
 * POST /api/admin/orders/:id/rebuild-pdf
 *
 *   - 주문에 연결된 프로젝트의 표지/내지 PDF 를 재생성 → Storige 업로드.
 *   - 재빌드는 새 fileId 를 낳으므로 orders.storige_*_file_id 를 항상 갱신.
 */
export const POST = withAdmin<{ id: string }>(async (req, ctx, user) => {
  const raw = (await req.json().catch(() => ({}))) as unknown;
  const parsed = BodySchema.safeParse(raw ?? {});
  if (!parsed.success) {
    return fail(
      "INVALID_BODY",
      "요청 본문이 올바르지 않습니다.",
      400,
      parsed.error.flatten(),
    );
  }
  const { target } = parsed.data;

  const admin = createAdminSupabase();

  const { data: order, error: getErr } = await admin
    .from("orders")
    .select(
      "id, user_id, project_id, cover_pdf_key, interior_pdf_key, projects(title)",
    )
    .eq("id", ctx.params.id)
    .maybeSingle();
  if (getErr) return fail("ORDER_QUERY_FAILED", getErr.message, 500);
  if (!order) return fail("NOT_FOUND", "주문을 찾을 수 없습니다.", 404);

  const orderId = order.id;
  const userId = order.user_id;
  // Storige 는 저장 경로를 받지 않음 — uploadPath 는 파일명 컨텍스트로만 쓰인다.
  const standardPath = (k: "cover.pdf" | "interior.pdf") =>
    `${userId}/${orderId}/${k}`;

  const result = await runProjectPdfBuild({
    projectId: order.project_id,
    userId: order.user_id,
    target,
    uploadPath: standardPath,
  });

  // 재빌드는 새 fileId 를 낳으므로 storige 컬럼을 항상 갱신.
  const patch = storigeOrderPatch(result, new Date().toISOString());
  if (Object.keys(patch).length > 0) {
    const { error: upErr } = await admin
      .from("orders")
      .update(patch)
      .eq("id", orderId);
    if (upErr) {
      return fail("ORDER_UPDATE_FAILED", upErr.message, 500);
    }
  }

  await logAdminAction({
    actor: { id: user.id, email: user.email },
    action: "order.pdf_rebuild",
    targetType: "order",
    targetId: ctx.params.id,
    details: {
      target,
      coverKey: result.coverKey ?? null,
      interiorKey: result.interiorKey ?? null,
      durationMs: result.durationMs,
    },
    request: req,
  });

  return ok({
    rebuilt: true,
    coverKey: result.coverKey,
    interiorKey: result.interiorKey,
    durationMs: result.durationMs,
  });
});

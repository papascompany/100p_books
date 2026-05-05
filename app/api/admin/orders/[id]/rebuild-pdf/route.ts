import "server-only";

import { z } from "zod";

import { fail, ok } from "@/app/api/_lib/response";
import { withAdmin } from "@/lib/admin/auth";
import { createAdminSupabase } from "@/lib/db/admin";
import { runProjectPdfBuild } from "@/lib/pdf/build-job";

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
 *   - 주문에 연결된 프로젝트의 표지/내지 PDF 를 재생성.
 *   - 기존 cover_pdf_key/interior_pdf_key 와 동일 path 로 덮어쓰기 (upsert).
 *   - 새 키 / 사이즈는 변하지 않으므로 DB 갱신은 키가 비어 있을 때만 수행.
 */
export const POST = withAdmin<{ id: string }>(async (req, ctx) => {
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

  // 기존 키 path 와 동일 위치에 덮어쓰기. 기존 키가 없으면 표준 경로 사용.
  const orderId = order.id;
  const userId = order.user_id;
  const standardPath = (k: "cover.pdf" | "interior.pdf") =>
    `${userId}/${orderId}/${k}`;

  const result = await runProjectPdfBuild({
    projectId: order.project_id,
    userId: order.user_id,
    target,
    uploadPath: (k) => {
      if (k === "cover.pdf" && order.cover_pdf_key) return order.cover_pdf_key;
      if (k === "interior.pdf" && order.interior_pdf_key)
        return order.interior_pdf_key;
      return standardPath(k);
    },
    signUrls: false,
  });

  // 키가 비어 있던 경우에만 DB 갱신
  const update: Record<string, string> = {};
  if (!order.cover_pdf_key && result.coverKey) {
    update.cover_pdf_key = result.coverKey;
  }
  if (!order.interior_pdf_key && result.interiorKey) {
    update.interior_pdf_key = result.interiorKey;
  }
  if (Object.keys(update).length > 0) {
    await admin.from("orders").update(update).eq("id", orderId);
  }

  return ok({
    rebuilt: true,
    coverKey: result.coverKey,
    interiorKey: result.interiorKey,
    durationMs: result.durationMs,
  });
});

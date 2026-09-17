import { z } from "zod";

import { fail, failFromError, ok } from "@/app/api/_lib/response";
import { requireActiveUser, requireUser } from "@/lib/auth/session";
import { createAdminSupabase } from "@/lib/db/admin";
import { createServerSupabase } from "@/lib/db/server";
import { assertProjectsEditable } from "@/lib/orders/edit-lock";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const PatchSchema = z
  .object({
    title: z.string().trim().min(1).max(80).optional(),
    bookSizeId: z.string().uuid().optional(),
  })
  .refine((d) => d.title !== undefined || d.bookSizeId !== undefined, {
    message: "수정할 필드가 없습니다.",
  });

type RouteCtx = { params: { id: string } };

/**
 * GET /api/projects/[id]
 *   프로젝트 메타 + 사진 수.
 */
export async function GET(_req: Request, { params }: RouteCtx) {
  try {
    const user = await requireUser();
    const supabase = createServerSupabase();

    const { data: project, error } = await supabase
      .from("projects")
      .select(
        "id, user_id, book_size_id, title, status, layout_mode, cover_json, created_at, updated_at",
      )
      .eq("id", params.id)
      .maybeSingle();

    if (error) return fail("PROJECT_QUERY_FAILED", error.message, 500);
    if (!project) return fail("NOT_FOUND", "프로젝트를 찾을 수 없습니다.", 404);
    if (project.user_id !== user.id) {
      return fail("FORBIDDEN", "해당 프로젝트에 대한 권한이 없습니다.", 403);
    }

    const { count, error: countErr } = await supabase
      .from("photos")
      .select("id", { count: "exact", head: true })
      .eq("project_id", project.id)
      .is("deleted_at", null);

    if (countErr) return fail("PHOTO_COUNT_FAILED", countErr.message, 500);

    return ok({
      id: project.id,
      title: project.title,
      status: project.status,
      bookSizeId: project.book_size_id,
      layoutMode: project.layout_mode,
      coverJson: project.cover_json,
      photoCount: count ?? 0,
      createdAt: project.created_at,
      updatedAt: project.updated_at,
    });
  } catch (err) {
    return failFromError(err);
  }
}

/**
 * DELETE /api/projects/[id]
 *   1. requireActiveUser + 소유권 검증
 *   2. 주문이 **하나라도**(상태 무관 — cancelled·refunded 포함) 연결돼 있으면 삭제 거부 (DEBT-9).
 *      - orders.project_id 는 ON DELETE 절이 없는 FK(0001_init.sql)라 주문이 남은 프로젝트는
 *        지울 수 없다. 예전에는 cancelled 를 통과시킨 뒤 pages·photos 를 먼저 지우고 projects 삭제가
 *        FK 로 실패해, 사진·페이지만 영구 손실된 빈 프로젝트가 남았다.
 *      - 주문 내역(전자상거래법 거래기록)과 그 인쇄 원본(pages·photos)은 함께 보존한다.
 *      - pending(결제 진행 중)도 막는다 — 삭제 직후 confirm 이 paid 로 승격하면 PDF 소스가 사라진다.
 *      - 판정은 service_role 로 한다: RLS 로 안 보이는 주문이 있어도 놓치지 않게.
 *   3. projects 한 건만 DELETE — pages·photos·share_tokens·pdf_build_jobs 는 FK cascade 로
 *      **같은 문장 안에서** 지워진다. 판정과 삭제 사이에 주문이 새로 붙으면 FK 위반(23503)으로
 *      문장 전체가 실패해 자식 데이터도 남는다(부분 실패 없음) → 409 로 응답.
 *
 *   Storage 파일 삭제는 비동기 클린업 잡(orphan-photos cron)에 위임.
 *   RLS 가 2차 방어선.
 */
export async function DELETE(_req: Request, { params }: RouteCtx) {
  try {
    const user = await requireActiveUser();
    const supabase = createServerSupabase();

    // 소유권 확인
    const { data: project, error: selErr } = await supabase
      .from("projects")
      .select("id, user_id")
      .eq("id", params.id)
      .maybeSingle();

    if (selErr) return fail("PROJECT_QUERY_FAILED", selErr.message, 500);
    if (!project) return fail("NOT_FOUND", "프로젝트를 찾을 수 없습니다.", 404);
    if (project.user_id !== user.id) {
      return fail("FORBIDDEN", "해당 프로젝트에 대한 권한이 없습니다.", 403);
    }

    // 주문(상태 무관)이 연결돼 있으면 어떤 데이터도 지우기 전에 거부한다.
    const admin = createAdminSupabase();
    const { count: orderCount, error: ordErr } = await admin
      .from("orders")
      .select("id", { count: "exact", head: true })
      .eq("project_id", params.id);

    if (ordErr) return fail("ORDER_QUERY_FAILED", ordErr.message, 500);
    if ((orderCount ?? 0) > 0) {
      return hasOrdersResponse(orderCount ?? 0);
    }

    // project 삭제 — 자식(pages·photos 등)은 FK cascade 로 같은 문장에서 원자적으로 지워진다.
    const { data: deleted, error: projErr } = await supabase
      .from("projects")
      .delete()
      .eq("id", params.id)
      .eq("user_id", user.id)
      .select("id");
    if (projErr) {
      // 판정 직후 주문이 생긴 경합 — FK 가 문장 전체를 되돌렸으므로 아무것도 지워지지 않았다.
      if (projErr.code === FK_VIOLATION) return hasOrdersResponse(null);
      return fail("PROJECT_DELETE_FAILED", projErr.message, 500);
    }
    if (!deleted || deleted.length === 0) {
      return fail("NOT_FOUND", "프로젝트를 찾을 수 없습니다.", 404);
    }

    return ok({ deleted: true });
  } catch (err) {
    return failFromError(err);
  }
}

/** Postgres foreign_key_violation. */
const FK_VIOLATION = "23503";

function hasOrdersResponse(orderCount: number | null) {
  return fail(
    "HAS_ORDERS",
    "주문 내역이 있는 포토북은 삭제할 수 없어요. 결제 대기·취소·환불된 주문을 포함해 주문 기록과 인쇄 원본을 보관해야 하기 때문이에요.",
    409,
    orderCount === null ? undefined : { orderCount },
  );
}

/**
 * PATCH /api/projects/[id]
 *   body: { title?, bookSizeId? }
 *   결제 이후(paid·in_production·shipped·delivered) 주문이 달린 포토북은 409 PROJECT_LOCKED.
 */
export async function PATCH(req: Request, { params }: RouteCtx) {
  try {
    // 탈퇴 가드 — 탈퇴 처리 중인 계정의 편집(인쇄물 영향 변경 포함)을 막는다.
    const user = await requireActiveUser();

    const raw = (await req.json().catch(() => ({}))) as unknown;
    const parsed = PatchSchema.safeParse(raw ?? {});
    if (!parsed.success) {
      return fail("INVALID_BODY", "요청 본문이 올바르지 않습니다.", 400, parsed.error.flatten());
    }

    const supabase = createServerSupabase();

    // 소유권 선검증 (RLS도 2차 방어)
    const { data: existing, error: selErr } = await supabase
      .from("projects")
      .select("id, user_id")
      .eq("id", params.id)
      .maybeSingle();

    if (selErr) return fail("PROJECT_QUERY_FAILED", selErr.message, 500);
    if (!existing) return fail("NOT_FOUND", "프로젝트를 찾을 수 없습니다.", 404);
    if (existing.user_id !== user.id) {
      return fail("FORBIDDEN", "해당 프로젝트에 대한 권한이 없습니다.", 403);
    }

    // 결제 후 편집 잠금 (DEBT-2) — 소유권 확인 **뒤에만**(남의 결제 여부 비노출). PATCH 전체를 잠근다:
    //   - bookSizeId 는 결제 금액·표지 규격·인쇄 판형을 바꾼다(가장 직접적인 인쇄물 변조).
    //   - title 도 인쇄 산출물에 들어간다 — PDF 재생성(rebuild-pdf) 시 문서 메타데이터 Title·다운로드
    //     파일명이 되고, 관리자·Storige 가 보는 주문의 포토북 이름이 결제 후에 바뀐다.
    //   필드별로 가르면 새 필드가 추가될 때 잠금이 빠지기 쉬워 fail-closed 로 전체를 막는다.
    //   잠기면 409 PROJECT_LOCKED(failFromError), 주문 조회 실패는 503 PROJECT_LOCK_CHECK_FAILED.
    await assertProjectsEditable(createAdminSupabase(), params.id);

    const patch: Record<string, unknown> = {};
    if (parsed.data.title !== undefined) patch.title = parsed.data.title;
    if (parsed.data.bookSizeId !== undefined) patch.book_size_id = parsed.data.bookSizeId;

    const { data: updated, error: updErr } = await supabase
      .from("projects")
      .update(patch)
      .eq("id", params.id)
      .select("id, title, status, book_size_id")
      .single();

    if (updErr || !updated) {
      return fail("PROJECT_UPDATE_FAILED", updErr?.message ?? "수정 실패", 500);
    }

    return ok({
      id: updated.id,
      title: updated.title,
      status: updated.status,
      bookSizeId: updated.book_size_id,
    });
  } catch (err) {
    return failFromError(err);
  }
}

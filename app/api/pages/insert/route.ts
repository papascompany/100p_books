import "server-only";

import { z } from "zod";

import { fail, failFromError, ok } from "@/app/api/_lib/response";
import { requireUser } from "@/lib/auth/session";
import { createAdminSupabase } from "@/lib/db/admin";
import { createServerSupabase } from "@/lib/db/server";
import { buildCollagePage, type CollageTemplateId } from "@/lib/layout/collage";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const BodySchema = z.object({
  projectId: z.string().uuid(),
  /** 0 이면 맨 앞에 삽입, 미지정 시 맨 뒤. */
  afterPageNo: z.number().int().min(0).optional(),
  layoutMode: z.enum(["polaroid", "collage"]).optional(),
  templateId: z
    .enum(["collage-2v", "collage-2h", "collage-3a", "collage-3v", "collage-4", "collage-6"])
    .optional(),
});

/**
 * POST /api/pages/insert
 *   body: { projectId, afterPageNo?, layoutMode?, templateId? }
 *
 * 새 빈 페이지를 생성하고 그 이후 페이지들의 page_no 를 +1 씩 밀어준다.
 *  - layoutMode 미지정 시 프로젝트의 기본 layout_mode 사용.
 *  - 폴라로이드: photoId="" PhotoObject 가 들어가면 안 되므로 placeholderSlot=true RectObject 1개만 깔린 단순 빈 카드.
 *  - 콜라주: 빈 슬롯 자리표시자만.
 *
 * 응답: { pageId, pageNo, pageCount }
 */
export async function POST(req: Request) {
  try {
    const user = await requireUser();

    const raw = (await req.json().catch(() => ({}))) as unknown;
    const parsed = BodySchema.safeParse(raw);
    if (!parsed.success) {
      return fail(
        "INVALID_BODY",
        "projectId 가 필요합니다.",
        400,
        parsed.error.flatten(),
      );
    }
    const { projectId, afterPageNo, layoutMode, templateId } = parsed.data;

    const supabase = createServerSupabase();

    // 소유권 + 책 사이즈
    const { data: project, error: projErr } = await supabase
      .from("projects")
      .select("id, user_id, book_size_id, layout_mode")
      .eq("id", projectId)
      .maybeSingle();
    if (projErr) return fail("PROJECT_QUERY_FAILED", projErr.message, 500);
    if (!project) return fail("NOT_FOUND", "프로젝트를 찾을 수 없습니다.", 404);
    if (project.user_id !== user.id) {
      return fail("FORBIDDEN", "해당 프로젝트에 대한 권한이 없습니다.", 403);
    }

    const { data: size, error: sizeErr } = await supabase
      .from("book_sizes")
      .select("id, width_mm, height_mm")
      .eq("id", project.book_size_id)
      .maybeSingle();
    if (sizeErr) return fail("BOOK_SIZE_QUERY_FAILED", sizeErr.message, 500);
    if (!size) return fail("NOT_FOUND", "책 사이즈를 찾을 수 없습니다.", 404);

    // 현재 페이지 수
    const { data: pageRows, error: pagesErr } = await supabase
      .from("pages")
      .select("page_no")
      .eq("project_id", projectId)
      .order("page_no", { ascending: true });
    if (pagesErr) return fail("PAGES_QUERY_FAILED", pagesErr.message, 500);

    const existingCount = (pageRows ?? []).length;
    const maxPageNo = existingCount > 0 ? Math.max(...pageRows!.map((p) => p.page_no)) : 0;

    // afterPageNo 결정 — 미지정 / 범위 초과 시 맨 뒤.
    const after =
      typeof afterPageNo === "number"
        ? Math.min(Math.max(0, afterPageNo), maxPageNo)
        : maxPageNo;
    const newPageNo = after + 1;

    const mode = layoutMode ?? project.layout_mode ?? "polaroid";

    // 빈 PageDoc 생성 — placeholder 만 있고 photo 는 없음 (사용자가 추후 사진 드롭).
    let doc;
    if (mode === "collage") {
      doc = buildCollagePage({
        bookSize: { id: size.id, width_mm: size.width_mm, height_mm: size.height_mm },
        pageNo: newPageNo,
        template: (templateId as CollageTemplateId | undefined) ?? "collage-4",
        photos: [], // 모두 빈 슬롯
      });
    } else {
      // 폴라로이드: 빈 페이지는 카드 없이 백지로 시작 (사용자가 사진 드롭 시 슬롯 채움).
      // 임시 — 단순한 흰 배경 페이지 with placeholder text only.
      const W = size.width_mm;
      const H = size.height_mm;
      doc = {
        version: "1" as const,
        bookSizeId: size.id,
        pageNo: newPageNo,
        layoutMode: "polaroid" as const,
        widthMm: W,
        heightMm: H,
        bleedMm: 2 as const,
        backgroundColor: "#f8f5f0",
        objects: [],
      };
    }

    const admin = createAdminSupabase();

    // 1) 후속 페이지들 page_no 를 +1 (after 보다 큰 페이지). RPC 사용.
    if (after < maxPageNo) {
      const { error: shiftErr } = await admin.rpc("shift_pages_after", {
        p_project_id: projectId,
        p_after_page_no: after,
        p_shift: 1,
      });
      if (shiftErr) return fail("SHIFT_FAILED", shiftErr.message, 500);
    }

    // 2) 새 페이지 INSERT.
    const { data: inserted, error: insErr } = await admin
      .from("pages")
      .insert({
        project_id: projectId,
        page_no: newPageNo,
        layout_mode: mode,
        fabric_json: doc as unknown as Record<string, unknown>,
      })
      .select("id, page_no")
      .single();

    if (insErr || !inserted) {
      // 롤백 — 후속 페이지 번호를 다시 -1.
      if (after < maxPageNo) {
        await admin.rpc("shift_pages_after", {
          p_project_id: projectId,
          p_after_page_no: after,
          p_shift: -1,
        });
      }
      return fail(
        "PAGE_INSERT_FAILED",
        insErr?.message ?? "페이지 생성에 실패했습니다.",
        500,
      );
    }

    return ok({
      pageId: inserted.id,
      pageNo: inserted.page_no,
      pageCount: existingCount + 1,
    });
  } catch (err) {
    return failFromError(err);
  }
}

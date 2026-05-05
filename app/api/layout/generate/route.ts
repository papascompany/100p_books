import "server-only";

import { z } from "zod";

import { fail, failFromError, ok } from "@/app/api/_lib/response";
import { requireUser } from "@/lib/auth/session";
import { createAdminSupabase } from "@/lib/db/admin";
import { createServerSupabase } from "@/lib/db/server";
import type { BookSize, Photo } from "@/lib/db/types";
import { generatePages } from "@/lib/layout/generate";
import { asCollageTemplateId } from "@/lib/layout/templates";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

const BodySchema = z.object({
  projectId: z.string().uuid(),
  sortMode: z.enum(["exif", "filename", "upload", "random"]),
  layoutMode: z.enum(["polaroid", "collage"]),
  templateId: z.string().min(1).max(40).optional(),
  seed: z.number().int().optional(),
});

/**
 * POST /api/layout/generate
 *
 * 1. 소유권 검증
 * 2. book_sizes + photos 로드
 * 3. generatePages()
 * 4. 기존 pages 전체 삭제 → 일괄 insert (admin 클라로 RLS 우회, 소유권 선검증됨)
 * 5. 응답 { pageCount, layoutMode, sortMode }
 *
 * 재생성은 파괴적(기존 편집 덮어쓰기). 경고는 클라 UI 담당.
 */
export async function POST(req: Request) {
  try {
    const user = await requireUser();

    const raw = (await req.json().catch(() => ({}))) as unknown;
    const parsed = BodySchema.safeParse(raw);
    if (!parsed.success) {
      return fail(
        "INVALID_BODY",
        "요청 본문이 올바르지 않습니다.",
        400,
        parsed.error.flatten(),
      );
    }

    const { projectId, sortMode, layoutMode, seed } = parsed.data;

    const templateId =
      layoutMode === "collage"
        ? asCollageTemplateId(parsed.data.templateId ?? "collage-4")
        : null;
    if (layoutMode === "collage" && templateId === null) {
      return fail(
        "INVALID_TEMPLATE",
        `알 수 없는 콜라주 템플릿입니다: ${parsed.data.templateId}`,
        400,
      );
    }

    const supabase = createServerSupabase();

    // 1) 프로젝트 + 책사이즈 로드 + 소유권
    const { data: project, error: projErr } = await supabase
      .from("projects")
      .select("id, user_id, book_size_id")
      .eq("id", projectId)
      .maybeSingle();

    if (projErr) return fail("PROJECT_QUERY_FAILED", projErr.message, 500);
    if (!project) return fail("NOT_FOUND", "프로젝트를 찾을 수 없습니다.", 404);
    if (project.user_id !== user.id) {
      return fail("FORBIDDEN", "해당 프로젝트에 대한 권한이 없습니다.", 403);
    }

    const { data: size, error: sizeErr } = await supabase
      .from("book_sizes")
      .select(
        "id, name, width_mm, height_mm, cover_width_mm, cover_height_mm, spine_formula_per_page, active, display_order, created_at",
      )
      .eq("id", project.book_size_id)
      .maybeSingle();

    if (sizeErr) return fail("BOOK_SIZE_QUERY_FAILED", sizeErr.message, 500);
    if (!size) return fail("NOT_FOUND", "책 사이즈를 찾을 수 없습니다.", 404);

    // 2) 사진 로드 (active 만)
    const { data: photosRaw, error: photoErr } = await supabase
      .from("photos")
      .select(
        "id, project_id, storage_key, thumb_key, filename, mime, size_bytes, width, height, exif_taken_at, exif_camera, order_idx, created_at, deleted_at",
      )
      .eq("project_id", projectId)
      .is("deleted_at", null)
      .order("order_idx", { ascending: true });

    if (photoErr) return fail("PHOTOS_QUERY_FAILED", photoErr.message, 500);

    const photos: Photo[] = photosRaw ?? [];
    if (photos.length === 0) {
      return fail("NO_PHOTOS", "먼저 사진을 업로드해 주세요.", 400);
    }

    // 3) 페이지 생성
    const bookSize: BookSize = size;
    const pages = generatePages({
      bookSize,
      photos,
      sortMode,
      layoutMode,
      templateId: templateId ?? undefined,
      seed,
    });

    // 4) 트랜잭션 RPC 로 update + delete + bulk insert 처리 (data loss 방지)
    const admin = createAdminSupabase();
    const rpcRows = pages.map((doc) => ({
      page_no: doc.pageNo,
      layout_mode: layoutMode,
      fabric_json: doc as unknown as Record<string, unknown>,
    }));
    const { error: rpcErr } = await admin.rpc("regenerate_project_pages", {
      p_project_id: projectId,
      p_layout_mode: layoutMode,
      p_pages: rpcRows as unknown as Record<string, unknown>[],
    });
    if (rpcErr) return fail("PAGES_REGEN_FAILED", rpcErr.message, 500);

    return ok({
      pageCount: pages.length,
      layoutMode,
      sortMode,
      templateId: templateId ?? null,
    });
  } catch (err) {
    return failFromError(err);
  }
}

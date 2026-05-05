import "server-only";

import { z } from "zod";

import { fail, failFromError, ok } from "@/app/api/_lib/response";
import { requireUser } from "@/lib/auth/session";
import { createServerSupabase } from "@/lib/db/server";
import type { BookSize } from "@/lib/db/types";
import { buildDefaultCoverDoc } from "@/lib/layout/cover";
import { isPageDoc, type PageDoc } from "@/lib/layout/types";
import { collectFontFamilies, registerProjectFonts } from "@/lib/pdf/fonts";
import { createPhotoResolver } from "@/lib/pdf/photos";
import { renderPageToPng } from "@/lib/pdf/render-page";
import { createResourceResolver } from "@/lib/pdf/resources";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/cover/preview
 *   body: { projectId }
 *
 * 응답:
 *   { pngDataUrl: "data:image/png;base64,..." }
 *
 * 동작:
 *   1. 인증 + 프로젝트 소유권 확인.
 *   2. project.cover_json 로드 — 없으면 buildDefaultCoverDoc 즉시 빌드.
 *   3. 폰트 등록 + 사진/리소스 resolver 준비.
 *   4. renderPageToPng(doc, { dpi: 72 }) 로 빠른 미리보기 생성
 *      (300dpi 대비 ~17배 빠름).
 *   5. base64 dataURL 로 응답.
 *
 * 캐시: 매번 fresh — 사용자 편집 직후 "3D 미리보기" 클릭 시 호출.
 */

const BodySchema = z.object({
  projectId: z.string().uuid(),
});

const PREVIEW_DPI = 72;

export async function POST(req: Request) {
  try {
    const user = await requireUser();

    const raw = (await req.json().catch(() => ({}))) as unknown;
    const parsed = BodySchema.safeParse(raw ?? {});
    if (!parsed.success) {
      return fail(
        "INVALID_BODY",
        "projectId 가 필요합니다.",
        400,
        parsed.error.flatten(),
      );
    }
    const { projectId } = parsed.data;

    const supabase = createServerSupabase();

    const { data: project, error: projErr } = await supabase
      .from("projects")
      .select("id, user_id, book_size_id, title, cover_json")
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
    const bookSize: BookSize = size;

    // pageCount — default cover 빌드 시 책등 두께 계산용
    const { count: pageCount } = await supabase
      .from("pages")
      .select("id", { count: "exact", head: true })
      .eq("project_id", projectId);

    let coverDoc: PageDoc;
    const stored = project.cover_json as PageDoc | null;
    if (stored && isPageDoc(stored) && stored.layoutMode === "cover") {
      coverDoc = stored;
    } else {
      coverDoc = buildDefaultCoverDoc({
        bookSize,
        pageCount: pageCount ?? 0,
        title: project.title ?? "Untitled",
      });
    }

    // 폰트 등록 — 표지에 들어간 family 만
    const families = collectFontFamilies([coverDoc]);
    await registerProjectFonts({ families });

    // photo / resource resolver — 빌드 잡과 동일한 방식
    const { resolve: resolvePhoto } = createPhotoResolver({ projectId });
    const resourceResolver = createResourceResolver();

    // 빠른 PNG 렌더 (72 DPI)
    const png = await renderPageToPng(coverDoc, {
      dpi: PREVIEW_DPI,
      resolveImageUrl: resolvePhoto,
      resolveBackgroundUrl: resourceResolver.resolveBackground,
      resolveClipart: resourceResolver.resolveClipart,
    });

    // base64 dataURL — 단일 응답에 포함, 캐싱 불필요
    const base64 = png.toString("base64");
    const pngDataUrl = `data:image/png;base64,${base64}`;

    return ok({ pngDataUrl });
  } catch (err) {
    return failFromError(err);
  }
}

import "server-only";

import { fail, failFromError, ok } from "@/app/api/_lib/response";
import { requireUser } from "@/lib/auth/session";
import { createServerSupabase } from "@/lib/db/server";
import type { BookSize } from "@/lib/db/types";
import { isPageDoc, type PageDoc } from "@/lib/layout/types";
import { collectFontFamilies, registerProjectFonts } from "@/lib/pdf/fonts";
import { createPhotoResolver } from "@/lib/pdf/photos";
import { renderPageToPng } from "@/lib/pdf/render-page";
import { createResourceResolver } from "@/lib/pdf/resources";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET/POST /api/pages/[id]/preview
 *
 * 응답:
 *   { pngDataUrl: "data:image/png;base64,..." }
 *
 * 동작:
 *   1. requireUser + page → project 소유권 확인.
 *   2. pages.fabric_json (PageDoc) 로드 + isPageDoc 가드.
 *   3. 폰트 등록 + 사진/리소스 resolver 준비.
 *   4. renderPageToPng(doc, { dpi: 72 }) — 빠른 미리보기 (300dpi 대비 ~17배 빠름).
 *   5. base64 dataURL 로 응답.
 *
 * 캐시: `Cache-Control: private, max-age=60` — 사용자가 편집 중 자주 호출 가능.
 *      너무 짧으면 부하, 너무 길면 자동저장 직후의 변경이 반영되지 않음.
 *
 * GET / POST 모두 허용 — fetch(method)/<button>form 양쪽에서 호출 편의.
 */

const PREVIEW_DPI = 72;
const CACHE_HEADERS = {
  "Cache-Control": "private, max-age=60",
};

interface Params {
  params: { id: string };
}

async function handle(_req: Request, { params }: Params): Promise<Response> {
  try {
    const user = await requireUser();
    const pageId = params.id;
    if (!pageId) return fail("INVALID_PARAM", "잘못된 페이지 ID 입니다.", 400);

    const supabase = createServerSupabase();

    // 1) page 로드
    const { data: page, error: pageErr } = await supabase
      .from("pages")
      .select("id, project_id, page_no, layout_mode, fabric_json")
      .eq("id", pageId)
      .maybeSingle();
    if (pageErr) return fail("PAGE_QUERY_FAILED", pageErr.message, 500);
    if (!page) return fail("NOT_FOUND", "페이지를 찾을 수 없습니다.", 404);

    // 2) 소유권
    const { data: project, error: projErr } = await supabase
      .from("projects")
      .select("id, user_id, book_size_id")
      .eq("id", page.project_id)
      .maybeSingle();
    if (projErr) return fail("PROJECT_QUERY_FAILED", projErr.message, 500);
    if (!project) return fail("NOT_FOUND", "프로젝트를 찾을 수 없습니다.", 404);
    if (project.user_id !== user.id) {
      return fail("FORBIDDEN", "해당 페이지에 대한 권한이 없습니다.", 403);
    }

    // 3) PageDoc 가드
    const stored = page.fabric_json as PageDoc | null;
    if (!stored || !isPageDoc(stored)) {
      return fail(
        "EMPTY_PAGE",
        "아직 편집 내용이 없는 페이지입니다.",
        400,
      );
    }

    // 4) book_size 로드 (PageDoc 자체에 widthMm/heightMm 가 있어 필수는 아니지만
    //    폰트 등록·이후 확장 대비로 함께 조회). 미사용 변수 lint 방지를 위해
    //    널 처리만 수행.
    const { data: size, error: sizeErr } = await supabase
      .from("book_sizes")
      .select(
        "id, name, width_mm, height_mm, cover_width_mm, cover_height_mm, spine_formula_per_page, active, display_order, created_at",
      )
      .eq("id", project.book_size_id)
      .maybeSingle();
    if (sizeErr) return fail("BOOK_SIZE_QUERY_FAILED", sizeErr.message, 500);
    if (!size) return fail("NOT_FOUND", "책 사이즈를 찾을 수 없습니다.", 404);
    void (size as BookSize);

    // 5) 폰트 등록
    const families = collectFontFamilies([stored]);
    await registerProjectFonts({ families });

    // 6) photo / resource resolver
    const { resolve: resolvePhoto } = createPhotoResolver({
      projectId: page.project_id,
    });
    const resourceResolver = createResourceResolver();

    // 7) 빠른 PNG 렌더 (72 DPI)
    const png = await renderPageToPng(stored, {
      dpi: PREVIEW_DPI,
      resolveImageUrl: resolvePhoto,
      resolveBackgroundUrl: resourceResolver.resolveBackground,
      resolveClipart: resourceResolver.resolveClipart,
    });

    const base64 = png.toString("base64");
    const pngDataUrl = `data:image/png;base64,${base64}`;

    return ok(
      { pngDataUrl, pageNo: page.page_no },
      { headers: CACHE_HEADERS },
    );
  } catch (err) {
    return failFromError(err);
  }
}

export async function GET(req: Request, ctx: Params) {
  return handle(req, ctx);
}

export async function POST(req: Request, ctx: Params) {
  return handle(req, ctx);
}

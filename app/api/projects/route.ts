import { z } from "zod";

import { fail, failFromError, ok } from "@/app/api/_lib/response";
import { requireUser } from "@/lib/auth/session";
import { createServerSupabase } from "@/lib/db/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const CreateProjectSchema = z.object({
  bookSizeId: z.string().uuid().optional(),
  title: z.string().trim().min(1).max(80).optional(),
});

/**
 * POST /api/projects
 *   body: { bookSizeId?, title? }
 *   새 draft 프로젝트 생성.
 *   bookSizeId 미지정 → 첫 번째 active book_size (display_order asc).
 */
export async function POST(req: Request) {
  try {
    const user = await requireUser();

    const raw = (await req.json().catch(() => ({}))) as unknown;
    const parsed = CreateProjectSchema.safeParse(raw ?? {});
    if (!parsed.success) {
      return fail("INVALID_BODY", "요청 본문이 올바르지 않습니다.", 400, parsed.error.flatten());
    }

    const supabase = createServerSupabase();

    let bookSizeId = parsed.data.bookSizeId;
    if (!bookSizeId) {
      const { data: size, error: sizeErr } = await supabase
        .from("book_sizes")
        .select("id")
        .eq("active", true)
        .order("display_order", { ascending: true })
        .limit(1)
        .maybeSingle();

      if (sizeErr) {
        return fail("BOOK_SIZE_QUERY_FAILED", sizeErr.message, 500);
      }
      if (!size) {
        return fail("NO_ACTIVE_BOOK_SIZE", "사용 가능한 책 사이즈가 없습니다.", 500);
      }
      bookSizeId = size.id;
    }

    const { data: project, error: insertErr } = await supabase
      .from("projects")
      .insert({
        user_id: user.id,
        book_size_id: bookSizeId,
        title: parsed.data.title ?? "Untitled",
        status: "draft",
        layout_mode: "polaroid",
        cover_json: null,
      })
      .select("id, title, status, book_size_id")
      .single();

    if (insertErr || !project) {
      return fail(
        "PROJECT_INSERT_FAILED",
        insertErr?.message ?? "프로젝트 생성에 실패했습니다.",
        500,
      );
    }

    return ok({
      id: project.id,
      title: project.title,
      status: project.status,
      bookSizeId: project.book_size_id,
    });
  } catch (err) {
    return failFromError(err);
  }
}

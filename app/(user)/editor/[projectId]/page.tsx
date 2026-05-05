import { notFound, redirect } from "next/navigation";

import EditorClient from "./EditorClient";
import { requireUser } from "@/lib/auth/session";
import { createServerSupabase } from "@/lib/db/server";
import type { BookSize } from "@/lib/db/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface PageProps {
  params: { projectId: string };
}

/**
 * /editor/[projectId] — M2 단계의 "자동 편집 컨트롤 + 썸네일 프리뷰".
 * 실제 편집(Fabric.js)은 M3 에서 `/editor/[projectId]/pages/[pageId]` 로 구현.
 */
export default async function EditorPage({ params }: PageProps) {
  try {
    await requireUser();
  } catch {
    redirect(`/login?next=/editor/${params.projectId}`);
  }

  const supabase = createServerSupabase();

  const { data: project, error: projErr } = await supabase
    .from("projects")
    .select(
      "id, user_id, book_size_id, title, status, layout_mode, created_at, updated_at",
    )
    .eq("id", params.projectId)
    .maybeSingle();

  if (projErr || !project) notFound();

  // 소유권: 서버에서 확실히 — RLS 2차 방어.
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || project.user_id !== user.id) notFound();

  const [{ count: photoCount }, { count: pageCount }, { data: size }] =
    await Promise.all([
      supabase
        .from("photos")
        .select("id", { count: "exact", head: true })
        .eq("project_id", project.id)
        .is("deleted_at", null),
      supabase
        .from("pages")
        .select("id", { count: "exact", head: true })
        .eq("project_id", project.id),
      supabase
        .from("book_sizes")
        .select(
          "id, name, width_mm, height_mm, cover_width_mm, cover_height_mm, spine_formula_per_page, active, display_order, created_at",
        )
        .eq("id", project.book_size_id)
        .maybeSingle(),
    ]);

  const bookSize: BookSize | null = size ?? null;

  return (
    <div className="container py-6 md:py-10">
      <EditorClient
        projectId={project.id}
        initialTitle={project.title}
        initialLayoutMode={project.layout_mode}
        photoCount={photoCount ?? 0}
        initialPageCount={pageCount ?? 0}
        bookSize={bookSize}
      />
    </div>
  );
}

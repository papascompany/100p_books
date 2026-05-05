import { notFound, redirect } from "next/navigation";

import PageEditor from "./PageEditor";
import { requireUser } from "@/lib/auth/session";
import { createAdminSupabase } from "@/lib/db/admin";
import { createServerSupabase } from "@/lib/db/server";
import type { BookSize } from "@/lib/db/types";
import { THUMBS_BUCKET } from "@/lib/image/constants";
import { isPageDoc } from "@/lib/layout/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface PageProps {
  params: { projectId: string; pageId: string };
}

const THUMB_SIGNED_TTL_SEC = 3600;

/**
 * 단일 페이지 편집 라우트.
 *
 * 서버에서:
 *   1. 인증 + 소유권 확인.
 *   2. 페이지 + 책 사이즈 + 인접 페이지(이전/다음) 로드.
 *   3. 해당 페이지의 PageDoc 이 참조하는 photoId 들의 thumb signed URL 일괄 발급.
 */
export default async function EditorSinglePage({ params }: PageProps) {
  try {
    await requireUser();
  } catch {
    redirect(`/login?next=/editor/${params.projectId}/pages/${params.pageId}`);
  }

  const supabase = createServerSupabase();

  const { data: page, error: pageErr } = await supabase
    .from("pages")
    .select(
      "id, project_id, page_no, layout_mode, fabric_json, created_at, updated_at",
    )
    .eq("id", params.pageId)
    .maybeSingle();

  if (pageErr || !page) notFound();

  const { data: project, error: projErr } = await supabase
    .from("projects")
    .select("id, user_id, book_size_id, title")
    .eq("id", page.project_id)
    .maybeSingle();
  if (projErr || !project) notFound();
  if (project.id !== params.projectId) notFound();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || project.user_id !== user.id) notFound();

  const { data: size } = await supabase
    .from("book_sizes")
    .select(
      "id, name, width_mm, height_mm, cover_width_mm, cover_height_mm, spine_formula_per_page, active, display_order, created_at",
    )
    .eq("id", project.book_size_id)
    .maybeSingle();

  const bookSize: BookSize | null = size ?? null;

  // 인접 페이지 (prev/next)
  const { data: neighbours } = await supabase
    .from("pages")
    .select("id, page_no")
    .eq("project_id", project.id)
    .order("page_no", { ascending: true });
  const list = neighbours ?? [];
  const idx = list.findIndex((p) => p.id === page.id);
  const prevPage = idx > 0 ? list[idx - 1] : null;
  const nextPage = idx >= 0 && idx < list.length - 1 ? list[idx + 1] : null;

  // photoUrls 발급
  const docCandidate = page.fabric_json;
  const doc = isPageDoc(docCandidate) ? docCandidate : null;
  const photoUrls: Record<string, string> = {};
  if (doc) {
    const photoIdSet = new Set<string>();
    for (const obj of doc.objects) {
      if (obj.type === "photo") photoIdSet.add(obj.photoId);
    }
    if (photoIdSet.size > 0) {
      const { data: photos } = await supabase
        .from("photos")
        .select("id, thumb_key")
        .eq("project_id", project.id)
        .in("id", Array.from(photoIdSet));
      const idByKey = new Map<string, string>();
      const paths: string[] = [];
      for (const p of photos ?? []) {
        if (p.thumb_key) {
          idByKey.set(p.thumb_key, p.id);
          paths.push(p.thumb_key);
        }
      }
      if (paths.length > 0) {
        const admin = createAdminSupabase();
        const { data: signed } = await admin.storage
          .from(THUMBS_BUCKET)
          .createSignedUrls(paths, THUMB_SIGNED_TTL_SEC);
        for (const item of signed ?? []) {
          if (item.path && item.signedUrl) {
            const pid = idByKey.get(item.path);
            if (pid) photoUrls[pid] = item.signedUrl;
          }
        }
      }
    }
  }

  if (!bookSize) notFound();

  return (
    <PageEditor
      projectId={project.id}
      projectTitle={project.title}
      pageId={page.id}
      pageNo={page.page_no}
      initialDoc={doc}
      initialPhotoUrls={photoUrls}
      bookSize={bookSize}
      prevPageId={prevPage?.id ?? null}
      nextPageId={nextPage?.id ?? null}
      siblings={list.map((p) => ({ id: p.id, pageNo: p.page_no }))}
    />
  );
}

import { notFound, redirect } from "next/navigation";

import CoverEditor from "./CoverEditor";
import { requireUser } from "@/lib/auth/session";
import { createAdminSupabase } from "@/lib/db/admin";
import { createServerSupabase } from "@/lib/db/server";
import type { BookSize } from "@/lib/db/types";
import { computeDocVersion } from "@/lib/editor/doc-version";
import { readProjectLockNotice } from "@/lib/editor/lock-notice";
import { THUMBS_BUCKET } from "@/lib/image/constants";
import { buildDefaultCoverDoc } from "@/lib/layout/cover";
import { isPageDoc, type PageDoc } from "@/lib/layout/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface PageProps {
  params: Promise<{ projectId: string }>;
}

const THUMB_SIGNED_TTL_SEC = 3600;

/**
 * /cover/[projectId] — 표지 에디터.
 *
 * 서버에서:
 *   1. 인증 + 소유권.
 *   2. project + book_size + page count 로드.
 *   3. project.cover_json 이 없으면 buildDefaultCoverDoc() 으로 즉시 빌드 (DB 저장 X).
 *   4. 표지에서 참조되는 사진 + 프로젝트 사진 일부의 thumb signed URL 발급.
 *   5. 결제 후 편집 잠금 여부 — 잠겨 있으면 에디터를 읽기 전용으로 열고 배너로 안내한다(안내용, 쓰기는 API 가 막는다).
 *
 * 사용자가 저장 시 PATCH /api/cover 로 cover_json 이 업데이트된다.
 */
export default async function CoverPage(props: PageProps) {
  const params = await props.params;
  try {
    await requireUser();
  } catch {
    redirect(`/login?next=/cover/${params.projectId}`);
  }

  const supabase = await createServerSupabase();

  const { data: project, error: projErr } = await supabase
    .from("projects")
    .select("id, user_id, book_size_id, title, cover_json")
    .eq("id", params.projectId)
    .maybeSingle();
  if (projErr || !project) notFound();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || project.user_id !== user.id) notFound();

  // 소유권 확인 뒤에만 판정한다(남의 결제 여부 비노출).
  const lockMessage = await readProjectLockNotice(createAdminSupabase(), project.id);

  const { data: size } = await supabase
    .from("book_sizes")
    .select(
      "id, name, width_mm, height_mm, cover_width_mm, cover_height_mm, spine_formula_per_page, active, display_order, created_at",
    )
    .eq("id", project.book_size_id)
    .maybeSingle();
  if (!size) notFound();
  const bookSize: BookSize = size;

  const { count: pageCount } = await supabase
    .from("pages")
    .select("id", { count: "exact", head: true })
    .eq("project_id", project.id);

  const stored = project.cover_json as unknown;
  // 저장된 원본 기준 내용 버전 — 에디터가 PATCH baseVersion 으로 돌려보낸다(stale-write 방어).
  const initialVersion = computeDocVersion(project.cover_json);
  let initialDoc: PageDoc;
  let isDefault = false;
  if (
    stored &&
    typeof stored === "object" &&
    isPageDoc(stored) &&
    stored.layoutMode === "cover"
  ) {
    initialDoc = stored;
  } else {
    initialDoc = buildDefaultCoverDoc({
      bookSize,
      pageCount: pageCount ?? 0,
      title: project.title ?? "Untitled",
    });
    isDefault = true;
  }

  // 사진: 표지에서 참조 + 프로젝트 사진 일부 (사용자가 추가할 수 있도록)
  const photoIdSet = new Set<string>();
  if (initialDoc.backgroundImage?.photoId) {
    photoIdSet.add(initialDoc.backgroundImage.photoId);
  }
  for (const obj of initialDoc.objects) {
    if (obj.type === "photo" && obj.photoId) photoIdSet.add(obj.photoId);
  }

  const { data: projectPhotos } = await supabase
    .from("photos")
    .select("id, thumb_key, filename, order_idx")
    .eq("project_id", project.id)
    .is("deleted_at", null)
    .order("order_idx", { ascending: true })
    .limit(48);
  for (const p of projectPhotos ?? []) photoIdSet.add(p.id);

  const photoUrls: Record<string, string> = {};
  if (photoIdSet.size > 0) {
    const { data: photos } = await supabase
      .from("photos")
      .select("id, thumb_key")
      .eq("project_id", project.id)
      .is("deleted_at", null)
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

  const projectPhotoSummaries = (projectPhotos ?? []).map((p) => ({
    id: p.id,
    filename: p.filename ?? null,
  }));

  return (
    <CoverEditor
      projectId={project.id}
      projectTitle={project.title ?? "Untitled"}
      initialDoc={initialDoc}
      initialIsDefault={isDefault}
      initialVersion={initialVersion}
      initialPhotoUrls={photoUrls}
      bookSize={bookSize}
      pageCount={pageCount ?? 0}
      projectPhotos={projectPhotoSummaries}
      initialLockMessage={lockMessage}
    />
  );
}

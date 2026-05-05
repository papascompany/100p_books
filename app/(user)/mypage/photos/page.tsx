import { redirect } from "next/navigation";

import PhotoLibraryClient from "./PhotoLibraryClient";
import { requireUser } from "@/lib/auth/session";
import { createAdminSupabase } from "@/lib/db/admin";
import { createServerSupabase } from "@/lib/db/server";
import { THUMBS_BUCKET } from "@/lib/image/constants";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const THUMB_SIGNED_TTL_SEC = 3600;

export interface PhotoLibraryItem {
  id: string;
  projectId: string;
  projectTitle: string;
  filename: string | null;
  mime: string | null;
  width: number | null;
  height: number | null;
  exifTakenAt: string | null;
  exifCamera: string | null;
  thumbUrl: string | null;
  createdAt: string;
}

export interface PhotoLibraryProject {
  id: string;
  title: string;
}

/**
 * /mypage/photos — 사용자 사진 라이브러리.
 *  - 모든 프로젝트의 active(휴지통 X) 사진 목록.
 *  - 검색/필터/정렬 + 다중 선택.
 *  - 액션: 다른 프로젝트로 추가, 휴지통 이동.
 */
export default async function PhotoLibraryPage() {
  let user;
  try {
    user = await requireUser();
  } catch {
    redirect("/login?next=/mypage/photos");
  }

  const supabase = createServerSupabase();

  // 본인 프로젝트 목록 (소유권 확인 + photo join 후 매핑용)
  const { data: projects } = await supabase
    .from("projects")
    .select("id, title")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  const projectMap = new Map<string, string>();
  for (const p of projects ?? []) {
    projectMap.set(p.id, p.title ?? "Untitled");
  }
  const projectList: PhotoLibraryProject[] = (projects ?? []).map((p) => ({
    id: p.id,
    title: p.title ?? "Untitled",
  }));

  if (projectMap.size === 0) {
    return (
      <PhotoLibraryClient
        photos={[]}
        projects={[]}
      />
    );
  }

  // 사용자 모든 프로젝트의 active 사진 (RLS 자동 + 명시적 user_id 검증)
  const projectIds = Array.from(projectMap.keys());
  const { data: rows } = await supabase
    .from("photos")
    .select(
      "id, project_id, thumb_key, filename, mime, width, height, exif_taken_at, exif_camera, created_at",
    )
    .in("project_id", projectIds)
    .is("deleted_at", null)
    .order("created_at", { ascending: false });

  const photoRows = rows ?? [];

  // signed URL 일괄 발급
  const paths: string[] = [];
  const idByKey = new Map<string, string>();
  for (const r of photoRows) {
    if (r.thumb_key) {
      paths.push(r.thumb_key);
      idByKey.set(r.thumb_key, r.id);
    }
  }
  const urlByPhotoId: Record<string, string> = {};
  if (paths.length > 0) {
    const admin = createAdminSupabase();
    // createSignedUrls 는 한번에 너무 많으면 페일 가능 — 200개씩 청크
    const CHUNK = 200;
    for (let i = 0; i < paths.length; i += CHUNK) {
      const slice = paths.slice(i, i + CHUNK);
      const { data: signed } = await admin.storage
        .from(THUMBS_BUCKET)
        .createSignedUrls(slice, THUMB_SIGNED_TTL_SEC);
      for (const item of signed ?? []) {
        if (item.path && item.signedUrl) {
          const pid = idByKey.get(item.path);
          if (pid) urlByPhotoId[pid] = item.signedUrl;
        }
      }
    }
  }

  const photos: PhotoLibraryItem[] = photoRows.map((r) => ({
    id: r.id,
    projectId: r.project_id,
    projectTitle: projectMap.get(r.project_id) ?? "Untitled",
    filename: r.filename,
    mime: r.mime,
    width: r.width,
    height: r.height,
    exifTakenAt: r.exif_taken_at,
    exifCamera: r.exif_camera,
    thumbUrl: urlByPhotoId[r.id] ?? null,
    createdAt: r.created_at,
  }));

  return <PhotoLibraryClient photos={photos} projects={projectList} />;
}

import { redirect } from "next/navigation";

import TrashClient from "./TrashClient";
import { requireUser } from "@/lib/auth/session";
import { createAdminSupabase } from "@/lib/db/admin";
import { createServerSupabase } from "@/lib/db/server";
import { THUMBS_BUCKET } from "@/lib/image/constants";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const THUMB_SIGNED_TTL_SEC = 3600;

export interface TrashItem {
  id: string;
  projectId: string;
  projectTitle: string;
  filename: string | null;
  thumbUrl: string | null;
  deletedAt: string;
  daysLeft: number;
}

const PURGE_AFTER_DAYS = 30;

/**
 * /mypage/trash — 사진 휴지통.
 *  - 사용자 본인 프로젝트의 휴지통(deleted_at IS NOT NULL) 사진 목록.
 *  - 30일 이상 경과한 항목은 자동 영구 삭제 안내 (cron 별도 구현).
 */
export default async function TrashPage() {
  let user;
  try {
    user = await requireUser();
  } catch {
    redirect("/login?next=/mypage/trash");
  }

  const supabase = createServerSupabase();

  const { data: projects } = await supabase
    .from("projects")
    .select("id, title")
    .eq("user_id", user.id);

  const projectMap = new Map<string, string>();
  for (const p of projects ?? []) {
    projectMap.set(p.id, p.title ?? "Untitled");
  }

  if (projectMap.size === 0) {
    return <TrashClient items={[]} purgeAfterDays={PURGE_AFTER_DAYS} />;
  }

  const projectIds = Array.from(projectMap.keys());
  const { data: rows } = await supabase
    .from("photos")
    .select("id, project_id, thumb_key, filename, deleted_at")
    .in("project_id", projectIds)
    .not("deleted_at", "is", null)
    .order("deleted_at", { ascending: false });

  const photoRows = rows ?? [];

  // signed URLs
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

  const now = Date.now();
  const items: TrashItem[] = photoRows
    .filter((r) => r.deleted_at)
    .map((r) => {
      const deletedAt = r.deleted_at as string;
      const elapsedDays = Math.floor(
        (now - new Date(deletedAt).getTime()) / (24 * 3600 * 1000),
      );
      const daysLeft = Math.max(0, PURGE_AFTER_DAYS - elapsedDays);
      return {
        id: r.id,
        projectId: r.project_id,
        projectTitle: projectMap.get(r.project_id) ?? "Untitled",
        filename: r.filename,
        thumbUrl: urlByPhotoId[r.id] ?? null,
        deletedAt,
        daysLeft,
      };
    });

  return <TrashClient items={items} purgeAfterDays={PURGE_AFTER_DAYS} />;
}

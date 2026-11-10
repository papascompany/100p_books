import { redirect } from "next/navigation";

import { requireUser } from "@/lib/auth/session";
import { createAdminSupabase } from "@/lib/db/admin";
import { createServerSupabase } from "@/lib/db/server";
import { THUMBS_BUCKET } from "@/lib/image/constants";
import { pickCardThumbKeys } from "@/lib/projects/card-thumb";

import ProjectsClient from "./ProjectsClient";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export interface ProjectRow {
  id: string;
  title: string | null;
  status: string;
  book_size_id: string;
  cover_json: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
  book_sizes: { name: string } | null;
  /** 휴지통 제외 사진 수 — 조회 실패 시 null(카드는 기존 동작으로 둔다). */
  photo_count: number | null;
  /** 카드 썸네일 서명 URL(표지 첫 사진 → 첫 업로드 사진). 없으면 아이콘. */
  thumb_url: string | null;
}

export default async function ProjectsPage() {
  let user;
  try {
    user = await requireUser();
  } catch {
    redirect("/login?next=/projects");
  }

  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("projects")
    .select(
      "id, title, status, book_size_id, cover_json, created_at, updated_at, book_sizes(name)",
    )
    .eq("user_id", user.id)
    // projects.status CHECK 는 draft|ordered 뿐이라 이 필터는 현재 no-op 이다.
    // ProjectStatus 에 없는 값이라 타입드 neq() 대신 raw filter() 로 동일 쿼리를 유지한다.
    .filter("status", "neq", "deleted")
    .order("updated_at", { ascending: false });

  if (error) {
    // DB 원문은 진단용 — 화면에는 일반 문구만.
    console.error("[projects] list query failed", error.message);
    return (
      <div className="container py-10">
        <p className="text-sm text-destructive" role="alert">
          포토북 목록을 불러오지 못했어요. 잠시 후 새로고침해 주세요.
        </p>
      </div>
    );
  }

  // 사진 수 — 빈 초안 카드를 업로드로 보내는 데만 쓴다. 실패해도 목록은 그대로 보여준다(별도 쿼리로 격리).
  const { data: photoCountRows, error: photoCountErr } = await supabase
    .from("projects")
    .select("id, photos(count)")
    .eq("user_id", user.id)
    .is("photos.deleted_at", null);
  if (photoCountErr) {
    console.warn("[projects] photo count query failed", photoCountErr.message);
  }
  const photoCountById = new Map<string, number>();
  for (const row of (photoCountRows ?? []) as unknown as Array<{
    id: string;
    photos: Array<{ count: number }> | null;
  }>) {
    const count = row.photos?.[0]?.count;
    if (typeof count === "number") photoCountById.set(row.id, count);
  }

  const baseRows = (data ?? []) as unknown as Omit<ProjectRow, "photo_count" | "thumb_url">[];
  const thumbUrlById = await loadCardThumbUrls(supabase, baseRows);
  const projects = baseRows.map(
    (p): ProjectRow => ({
      ...p,
      photo_count: photoCountById.get(p.id) ?? null,
      thumb_url: thumbUrlById.get(p.id) ?? null,
    }),
  );

  return <ProjectsClient projects={projects} />;
}

/** 카드 썸네일 최대 조회 사진 수 — 프로젝트당 첫 사진만 필요하지만 표지 사진 매칭을 위해 넉넉히. */
const CARD_THUMB_PHOTO_LIMIT = 2000;
const THUMB_SIGNED_TTL_SEC = 3600;

/**
 * 카드 썸네일 서명 URL — 표지 첫 사진, 없으면 가장 먼저 올린 사진(lib/projects/card-thumb.ts).
 * 썸네일은 장식이라 실패하면 빈 맵(아이콘 표시)으로 흡수한다.
 */
async function loadCardThumbUrls(
  supabase: Awaited<ReturnType<typeof createServerSupabase>>,
  rows: ReadonlyArray<{ id: string; cover_json: unknown }>,
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (rows.length === 0) return out;
  try {
    const { data: photos, error } = await supabase
      .from("photos")
      .select("id, project_id, thumb_key")
      .in(
        "project_id",
        rows.map((r) => r.id),
      )
      .is("deleted_at", null)
      .order("created_at", { ascending: true })
      .limit(CARD_THUMB_PHOTO_LIMIT);
    if (error) {
      console.warn("[projects] card thumb query failed", error.message);
      return out;
    }
    const keyByProject = pickCardThumbKeys(rows, photos ?? []);
    const paths = Array.from(new Set(keyByProject.values()));
    if (paths.length === 0) return out;
    // storage 접근은 반드시 `admin.storage` 형태(0032 가드 테스트가 변수명으로 service_role 여부를 검사).
    // 위 photos 조회가 RLS(본인 사진만)를 통과한 키만 서명한다.
    const admin = createAdminSupabase();
    const { data: signed } = await admin.storage
      .from(THUMBS_BUCKET)
      .createSignedUrls(paths, THUMB_SIGNED_TTL_SEC);
    const urlByPath = new Map<string, string>();
    for (const item of signed ?? []) {
      if (item.path && item.signedUrl) urlByPath.set(item.path, item.signedUrl);
    }
    for (const [projectId, key] of keyByProject) {
      const url = urlByPath.get(key);
      if (url) out.set(projectId, url);
    }
  } catch (err) {
    console.warn("[projects] card thumb signing failed", err instanceof Error ? err.message : err);
  }
  return out;
}

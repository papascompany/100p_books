import { redirect } from "next/navigation";

import { requireUser } from "@/lib/auth/session";
import { createServerSupabase } from "@/lib/db/server";

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

  const projects = ((data ?? []) as unknown as Omit<ProjectRow, "photo_count">[]).map(
    (p): ProjectRow => ({ ...p, photo_count: photoCountById.get(p.id) ?? null }),
  );

  return <ProjectsClient projects={projects} />;
}

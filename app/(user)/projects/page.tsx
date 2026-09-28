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
    return (
      <div className="container py-10">
        <p className="text-sm text-destructive">
          포토북 목록을 불러오지 못했습니다: {error.message}
        </p>
      </div>
    );
  }

  const projects = (data ?? []) as unknown as ProjectRow[];

  return <ProjectsClient projects={projects} />;
}

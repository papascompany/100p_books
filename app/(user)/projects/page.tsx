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

  const supabase = createServerSupabase();
  const { data, error } = await supabase
    .from("projects")
    .select(
      "id, title, status, book_size_id, cover_json, created_at, updated_at, book_sizes(name)",
    )
    .eq("user_id", user.id)
    .neq("status", "deleted")
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

import type { User } from "@supabase/supabase-js";
import { redirect } from "next/navigation";

import UploadClient from "./UploadClient";
import { requireUser } from "@/lib/auth/session";
import { createServerSupabase } from "@/lib/db/server";
import type { BookSize } from "@/lib/db/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface PageProps {
  searchParams: { projectId?: string };
}

/**
 * /upload — 사진 업로드 진입.
 *   ?projectId=... 가 있으면 기존 프로젝트.
 *   없으면 빈 draft 프로젝트를 즉시 만들고 같은 경로로 redirect.
 */
export default async function UploadPage({ searchParams }: PageProps) {
  let user: User;
  try {
    user = await requireUser();
  } catch {
    redirect("/login?next=/upload");
  }

  const supabase = createServerSupabase();

  // book sizes (active)
  const { data: sizes } = await supabase
    .from("book_sizes")
    .select(
      "id, name, width_mm, height_mm, cover_width_mm, cover_height_mm, spine_formula_per_page, active, display_order, created_at",
    )
    .eq("active", true)
    .order("display_order", { ascending: true });

  const bookSizes: BookSize[] = sizes ?? [];

  const projectIdParam = searchParams.projectId;

  // 신규 진입 → draft 프로젝트 생성 후 redirect
  if (!projectIdParam) {
    if (bookSizes.length === 0) {
      // 시드가 없는 비정상 환경
      return (
        <div className="container py-16">
          <p className="text-base text-muted-foreground">
            사용 가능한 책 사이즈가 없습니다. 관리자에게 문의해 주세요.
          </p>
        </div>
      );
    }

    const { data: project, error } = await supabase
      .from("projects")
      .insert({
        user_id: user.id,
        book_size_id: bookSizes[0]!.id,
        title: "Untitled",
        status: "draft",
        layout_mode: "polaroid",
        cover_json: null,
      })
      .select("id")
      .single();

    if (error || !project) {
      return (
        <div className="container py-16">
          <p className="text-base text-muted-foreground">
            프로젝트를 시작하지 못했어요. 잠시 후 다시 시도해 주세요.
          </p>
        </div>
      );
    }
    redirect(`/upload?projectId=${project.id}`);
  }

  // 기존 프로젝트 — 소유권 확인
  const { data: project } = await supabase
    .from("projects")
    .select("id, user_id, title, book_size_id")
    .eq("id", projectIdParam)
    .maybeSingle();

  if (!project || project.user_id !== user.id) {
    redirect("/upload");
  }

  return (
    <div className="container py-8 md:py-12">
      <header className="mx-auto max-w-3xl text-center">
        <p className="text-xs font-medium uppercase tracking-[0.2em] text-stone">
          STEP 1 OF 4
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
          소중한 사진을 모아주세요.
        </h1>
        <p className="mt-3 text-base text-muted-foreground">
          최대 100장까지 올릴 수 있어요. HEIC도 자동으로 변환돼요.
        </p>
      </header>

      <div className="mx-auto mt-10 max-w-5xl">
        <UploadClient
          projectId={project.id}
          initialTitle={project.title}
          initialBookSizeId={project.book_size_id}
          bookSizes={bookSizes}
        />
      </div>
    </div>
  );
}

import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import OrderForm from "./OrderForm";
import { Button } from "@/components/ui/button";
import { requireUser } from "@/lib/auth/session";
import { createServerSupabase } from "@/lib/db/server";
import type { BookSize } from "@/lib/db/types";
import { isPageDoc } from "@/lib/layout/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface PageProps {
  params: { projectId: string };
}

/**
 * /order/[projectId] — 주문서.
 *
 *   - requireUser + 소유권.
 *   - pages 카운트 + cover_json 존재 여부 확인.
 *   - 가격 계산 결과 prefetch 후 OrderForm 에 전달.
 *   - 미존재 시 안내 메시지 (표지/내지 편집 유도).
 */
export default async function OrderPage({ params }: PageProps) {
  let user;
  try {
    user = await requireUser();
  } catch {
    redirect(`/login?next=/order/${params.projectId}`);
  }

  const supabase = createServerSupabase();

  const { data: project, error: projErr } = await supabase
    .from("projects")
    .select("id, user_id, book_size_id, title, cover_json")
    .eq("id", params.projectId)
    .maybeSingle();
  if (projErr || !project) notFound();
  if (project.user_id !== user.id) notFound();

  const [{ count: pageCount }, { data: bookSizeRow }] = await Promise.all([
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

  if (!bookSizeRow) notFound();
  const bookSize: BookSize = bookSizeRow;
  const pages = pageCount ?? 0;

  const stored = project.cover_json as unknown;
  const hasCover =
    !!stored &&
    typeof stored === "object" &&
    isPageDoc(stored) &&
    stored.layoutMode === "cover";

  // 미준비 안내
  if (pages === 0 || !hasCover) {
    return (
      <div className="container py-10">
        <div className="mx-auto max-w-xl rounded-2xl border bg-card p-6 sm:p-8">
          <h1 className="font-display text-2xl font-semibold">주문 준비 중</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            주문하려면 먼저 내지와 표지를 모두 편집해주세요.
          </p>
          <ul className="mt-4 space-y-2 text-sm">
            <li className="flex items-center justify-between rounded-md border p-3">
              <span>
                내지 페이지: <strong>{pages}p</strong>
              </span>
              <Button asChild size="sm" variant={pages === 0 ? "default" : "outline"}>
                <Link href={`/editor/${project.id}`}>
                  {pages === 0 ? "자동 편집 시작" : "내지 보기"}
                </Link>
              </Button>
            </li>
            <li className="flex items-center justify-between rounded-md border p-3">
              <span>
                표지: <strong>{hasCover ? "준비됨" : "미준비"}</strong>
              </span>
              <Button asChild size="sm" variant={!hasCover ? "default" : "outline"}>
                <Link href={`/cover/${project.id}`}>
                  {!hasCover ? "표지 편집" : "표지 보기"}
                </Link>
              </Button>
            </li>
          </ul>
        </div>
      </div>
    );
  }

  return (
    <div className="container py-6 md:py-10">
      <OrderForm
        projectId={project.id}
        projectTitle={project.title ?? "Untitled"}
        bookSizeName={bookSize.name}
        pageCount={pages}
        userEmail={user.email ?? null}
      />
    </div>
  );
}

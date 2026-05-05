import Link from "next/link";
import { notFound } from "next/navigation";

import { createAdminSupabase } from "@/lib/db/admin";

import BookSizeForm from "../BookSizeForm";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function EditBookSizePage({
  params,
}: {
  params: { id: string };
}) {
  const admin = createAdminSupabase();
  const { data, error } = await admin
    .from("book_sizes")
    .select(
      "id, name, width_mm, height_mm, cover_width_mm, cover_height_mm, spine_formula_per_page, active, display_order, created_at",
    )
    .eq("id", params.id)
    .maybeSingle();
  if (error) {
    return (
      <p className="text-sm text-destructive">불러오기 실패: {error.message}</p>
    );
  }
  if (!data) notFound();

  return (
    <div className="space-y-4">
      <nav className="text-xs text-muted-foreground">
        <Link href="/admin/book-sizes" className="hover:text-foreground">
          ← 책 사이즈 목록
        </Link>
      </nav>
      <header>
        <h1 className="font-display text-2xl font-semibold tracking-tight md:text-3xl">
          책 사이즈 편집 · {data.name}
        </h1>
      </header>
      <BookSizeForm
        mode="edit"
        id={data.id}
        initial={{
          name: data.name,
          width_mm: data.width_mm,
          height_mm: data.height_mm,
          cover_width_mm: data.cover_width_mm,
          cover_height_mm: data.cover_height_mm,
          spine_formula_per_page: data.spine_formula_per_page,
          active: data.active,
          display_order: data.display_order,
        }}
      />
    </div>
  );
}

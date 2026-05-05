import Link from "next/link";

import DataTable, { type Column } from "@/components/admin/DataTable";
import { Button } from "@/components/ui/button";
import { createAdminSupabase } from "@/lib/db/admin";
import type { BookSize } from "@/lib/db/types";

import BookSizeRowActions from "./BookSizeRowActions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function BookSizesPage() {
  const admin = createAdminSupabase();
  const { data, error } = await admin
    .from("book_sizes")
    .select(
      "id, name, width_mm, height_mm, cover_width_mm, cover_height_mm, spine_formula_per_page, active, display_order, created_at",
    )
    .order("display_order", { ascending: true })
    .order("created_at", { ascending: true });

  const items = (data ?? []) as BookSize[];

  const columns: Column<BookSize>[] = [
    {
      key: "display_order",
      header: "순서",
      className: "w-16 text-muted-foreground",
    },
    {
      key: "name",
      header: "이름",
      cell: (b) => <span className="font-medium">{b.name}</span>,
    },
    {
      key: "width_mm",
      header: "본문 (mm)",
      cell: (b) => `${b.width_mm} × ${b.height_mm}`,
    },
    {
      key: "cover_width_mm",
      header: "표지 (mm)",
      cell: (b) => `${b.cover_width_mm} × ${b.cover_height_mm}`,
    },
    {
      key: "spine_formula_per_page",
      header: "책등 / page",
      cell: (b) => b.spine_formula_per_page.toFixed(3),
    },
    {
      key: "active",
      header: "활성",
      cell: (b) => (
        <span
          className={
            "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium " +
            (b.active
              ? "bg-emerald-100 text-emerald-800"
              : "bg-zinc-200 text-zinc-700")
          }
        >
          {b.active ? "ON" : "OFF"}
        </span>
      ),
    },
    {
      key: "id",
      header: "",
      className: "w-40 text-right",
      cell: (b) => <BookSizeRowActions id={b.id} active={b.active} />,
    },
  ];

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight md:text-3xl">
            책 사이즈
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            사용자 업로드 흐름 / 표지 자동 계산에 즉시 반영됩니다.
          </p>
        </div>
        <Button asChild variant="gradient">
          <Link href="/admin/book-sizes/new">+ 새 사이즈</Link>
        </Button>
      </header>

      {error ? (
        <p className="text-sm text-destructive">불러오기 실패: {error.message}</p>
      ) : null}

      <DataTable
        columns={columns}
        rows={items}
        rowKey={(b) => b.id}
        empty="등록된 책 사이즈가 없습니다."
      />
    </div>
  );
}

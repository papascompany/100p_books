import Link from "next/link";

import BookSizeForm from "../BookSizeForm";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default function NewBookSizePage() {
  return (
    <div className="space-y-4">
      <nav className="text-xs text-muted-foreground">
        <Link href="/admin/book-sizes" className="hover:text-foreground">
          ← 책 사이즈 목록
        </Link>
      </nav>
      <header>
        <h1 className="font-display text-2xl font-semibold tracking-tight md:text-3xl">
          새 책 사이즈
        </h1>
      </header>
      <BookSizeForm mode="create" />
    </div>
  );
}

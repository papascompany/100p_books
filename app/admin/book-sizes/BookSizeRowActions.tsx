"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";

import { Button } from "@/components/ui/button";

export default function BookSizeRowActions({
  id,
  active,
}: {
  id: string;
  active: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);

  const toggle = async () => {
    setBusy(true);
    try {
      const r = await fetch(`/api/admin/book-sizes/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ active: !active }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => null);
        alert(j?.error?.message ?? "변경 실패");
      } else {
        router.refresh();
      }
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!confirm("정말 삭제하시겠습니까? 사용 중인 사이즈는 삭제할 수 없습니다.")) return;
    setBusy(true);
    try {
      const r = await fetch(`/api/admin/book-sizes/${id}`, { method: "DELETE" });
      if (!r.ok) {
        const j = await r.json().catch(() => null);
        alert(j?.error?.message ?? "삭제 실패");
      } else {
        router.refresh();
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex justify-end gap-1">
      <Button
        size="sm"
        variant="ghost"
        onClick={toggle}
        disabled={busy}
        type="button"
      >
        {active ? "비활성" : "활성"}
      </Button>
      <Button asChild size="sm" variant="outline">
        <Link href={`/admin/book-sizes/${id}`}>편집</Link>
      </Button>
      <Button
        size="sm"
        variant="ghost"
        className="text-destructive hover:text-destructive"
        onClick={remove}
        disabled={busy}
        type="button"
      >
        삭제
      </Button>
    </div>
  );
}

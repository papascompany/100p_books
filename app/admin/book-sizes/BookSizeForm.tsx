"use client";

import { useRouter } from "next/navigation";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export interface BookSizeFormValues {
  name: string;
  width_mm: number;
  height_mm: number;
  cover_width_mm: number;
  cover_height_mm: number;
  spine_formula_per_page: number;
  active: boolean;
  display_order: number;
}

const DEFAULTS: BookSizeFormValues = {
  name: "",
  width_mm: 148,
  height_mm: 210,
  cover_width_mm: 302,
  cover_height_mm: 214,
  spine_formula_per_page: 0.09,
  active: true,
  display_order: 0,
};

export default function BookSizeForm({
  mode,
  id,
  initial,
}: {
  mode: "create" | "edit";
  id?: string;
  initial?: Partial<BookSizeFormValues>;
}) {
  const router = useRouter();
  const [v, setV] = React.useState<BookSizeFormValues>({
    ...DEFAULTS,
    ...initial,
  });
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);

  const set = <K extends keyof BookSizeFormValues>(
    k: K,
    nv: BookSizeFormValues[K],
  ) => setV((prev) => ({ ...prev, [k]: nv }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    if (!v.name.trim()) {
      setErr("이름을 입력하세요.");
      return;
    }
    if (v.width_mm <= 0 || v.height_mm <= 0) {
      setErr("본문 크기는 양수여야 합니다.");
      return;
    }
    if (v.cover_width_mm <= 0 || v.cover_height_mm <= 0) {
      setErr("표지 크기는 양수여야 합니다.");
      return;
    }
    setBusy(true);
    try {
      const url =
        mode === "create"
          ? "/api/admin/book-sizes"
          : `/api/admin/book-sizes/${id}`;
      const r = await fetch(url, {
        method: mode === "create" ? "POST" : "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(v),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.ok) {
        setErr(j?.error?.message ?? "저장 실패");
        return;
      }
      router.push("/admin/book-sizes");
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="max-w-2xl space-y-5">
      <Field label="이름 (예: A5)">
        <Input
          value={v.name}
          onChange={(e) => set("name", e.target.value)}
          maxLength={40}
          required
        />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="본문 width (mm)">
          <Input
            type="number"
            value={v.width_mm}
            min={50}
            max={500}
            onChange={(e) => set("width_mm", Number(e.target.value))}
          />
        </Field>
        <Field label="본문 height (mm)">
          <Input
            type="number"
            value={v.height_mm}
            min={50}
            max={500}
            onChange={(e) => set("height_mm", Number(e.target.value))}
          />
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label="표지 width (mm)">
          <Input
            type="number"
            value={v.cover_width_mm}
            min={50}
            max={1000}
            onChange={(e) => set("cover_width_mm", Number(e.target.value))}
          />
        </Field>
        <Field label="표지 height (mm)">
          <Input
            type="number"
            value={v.cover_height_mm}
            min={50}
            max={1000}
            onChange={(e) => set("cover_height_mm", Number(e.target.value))}
          />
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field
          label="책등 / 페이지 (mm)"
          hint="기본 0.09 — 페이지수에 곱해 책등 두께 산출"
        >
          <Input
            type="number"
            step="0.001"
            value={v.spine_formula_per_page}
            min={0}
            max={1}
            onChange={(e) =>
              set("spine_formula_per_page", Number(e.target.value))
            }
          />
        </Field>
        <Field label="표시 순서">
          <Input
            type="number"
            value={v.display_order}
            min={0}
            max={9999}
            onChange={(e) => set("display_order", Number(e.target.value))}
          />
        </Field>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={v.active}
          onChange={(e) => set("active", e.target.checked)}
          className="size-4 rounded border-input"
        />
        활성 (사용자 업로드 단계에 노출)
      </label>

      {err ? <p className="text-sm text-destructive">{err}</p> : null}

      <div className="flex gap-2">
        <Button type="submit" disabled={busy} variant="gradient">
          {busy ? "저장 중…" : mode === "create" ? "등록" : "저장"}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => router.back()}
          disabled={busy}
        >
          취소
        </Button>
      </div>
    </form>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="block text-sm font-medium">{label}</span>
      {hint ? (
        <span className="block text-xs text-muted-foreground">{hint}</span>
      ) : null}
      <div className="mt-1">{children}</div>
    </label>
  );
}

"use client";

import * as React from "react";

import UploadDropzone from "@/components/admin/UploadDropzone";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Resource, ResourceType } from "@/lib/db/types";

interface Item extends Resource {}

const ACCEPT: Record<ResourceType, string> = {
  font: ".ttf,.otf,.woff2",
  clipart: ".svg,.png,image/svg+xml,image/png",
  background: ".jpg,.jpeg,.png,image/jpeg,image/png",
};

const MAX: Record<ResourceType, number> = {
  font: 5 * 1024 * 1024,
  clipart: 2 * 1024 * 1024,
  background: 10 * 1024 * 1024,
};

export default function ResourcesClient({ type }: { type: ResourceType }) {
  const [items, setItems] = React.useState<Item[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [err, setErr] = React.useState<string | null>(null);

  // 업로드 폼 state
  const [name, setName] = React.useState("");
  const [file, setFile] = React.useState<File | null>(null);
  // 폰트 메타
  const [family, setFamily] = React.useState("");
  const [weight, setWeight] = React.useState("400");
  const [style, setStyle] = React.useState("normal");
  const [licenseName, setLicenseName] = React.useState("");
  const [licenseUrl, setLicenseUrl] = React.useState("");
  // 클립아트 메타
  const [category, setCategory] = React.useState("");
  // 배경 메타
  const [description, setDescription] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [resetSig, setResetSig] = React.useState(0);

  const refresh = React.useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`/api/admin/resources?type=${type}`, {
        cache: "no-store",
      });
      const j = await r.json();
      if (!j?.ok) throw new Error(j?.error?.message ?? "조회 실패");
      setItems(j.data.items as Item[]);
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [type]);

  React.useEffect(() => {
    refresh();
  }, [refresh]);

  const resetForm = () => {
    setName("");
    setFile(null);
    setFamily("");
    setWeight("400");
    setStyle("normal");
    setLicenseName("");
    setLicenseUrl("");
    setCategory("");
    setDescription("");
    setResetSig((n) => n + 1);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) {
      alert("파일을 선택하세요.");
      return;
    }
    if (!name.trim()) {
      alert("이름을 입력하세요.");
      return;
    }
    let meta: Record<string, unknown> = {};
    if (type === "font") {
      if (!family.trim() || !licenseName.trim()) {
        alert("폰트 family / 라이선스 이름은 필수입니다.");
        return;
      }
      meta = {
        family: family.trim(),
        weight,
        style,
        licenseName: licenseName.trim(),
        ...(licenseUrl.trim() ? { licenseUrl: licenseUrl.trim() } : {}),
      };
    } else if (type === "clipart") {
      meta = category.trim() ? { category: category.trim() } : {};
    } else if (type === "background") {
      meta = description.trim() ? { description: description.trim() } : {};
    }

    setBusy(true);
    try {
      const fd = new FormData();
      fd.set("type", type);
      fd.set("name", name.trim());
      fd.set("file", file);
      fd.set("meta", JSON.stringify(meta));
      const r = await fetch("/api/admin/resources", {
        method: "POST",
        body: fd,
      });
      const j = await r.json();
      if (!r.ok || !j?.ok) {
        alert(j?.error?.message ?? "업로드 실패");
        return;
      }
      resetForm();
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const toggleActive = async (item: Item) => {
    const r = await fetch(`/api/admin/resources/${item.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ active: !item.active }),
    });
    const j = await r.json();
    if (!r.ok || !j?.ok) {
      alert(j?.error?.message ?? "변경 실패");
      return;
    }
    refresh();
  };

  const remove = async (item: Item) => {
    if (!confirm(`'${item.name}' 을 삭제하시겠습니까?`)) return;
    const r = await fetch(`/api/admin/resources/${item.id}`, {
      method: "DELETE",
    });
    const j = await r.json();
    if (!r.ok || !j?.ok) {
      alert(j?.error?.message ?? "삭제 실패");
      return;
    }
    refresh();
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[400px,1fr]">
      {/* 업로드 폼 */}
      <form
        onSubmit={submit}
        className="rounded-2xl border bg-card p-5 shadow-soft"
      >
        <h2 className="text-base font-semibold">새로 업로드</h2>
        <div className="mt-3 space-y-3">
          <Field label="이름">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={80}
              required
            />
          </Field>

          <UploadDropzone
            accept={ACCEPT[type]}
            maxSizeBytes={MAX[type]}
            label="파일을 끌어다 놓거나 클릭"
            hint={`최대 ${(MAX[type] / 1024 / 1024).toFixed(0)}MB`}
            onFile={setFile}
            resetSignal={resetSig}
          />

          {type === "font" ? (
            <>
              <Field label="font-family (필수)">
                <Input
                  value={family}
                  onChange={(e) => setFamily(e.target.value)}
                  required
                />
              </Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label="weight">
                  <Input
                    value={weight}
                    onChange={(e) => setWeight(e.target.value)}
                  />
                </Field>
                <Field label="style">
                  <Input
                    value={style}
                    onChange={(e) => setStyle(e.target.value)}
                  />
                </Field>
              </div>
              <Field label="라이선스 이름 (필수)">
                <Input
                  value={licenseName}
                  onChange={(e) => setLicenseName(e.target.value)}
                  required
                />
              </Field>
              <Field label="라이선스 URL">
                <Input
                  value={licenseUrl}
                  onChange={(e) => setLicenseUrl(e.target.value)}
                  type="url"
                />
              </Field>
            </>
          ) : null}

          {type === "clipart" ? (
            <Field label="카테고리">
              <Input
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                placeholder="예: 자연 / 도형 / 음식"
              />
            </Field>
          ) : null}

          {type === "background" ? (
            <Field label="설명 (한 줄)">
              <Input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                maxLength={120}
              />
            </Field>
          ) : null}

          <Button
            type="submit"
            disabled={busy || !file}
            variant="gradient"
            className="w-full"
          >
            {busy ? "업로드 중…" : "업로드"}
          </Button>
        </div>
      </form>

      {/* 리스트 */}
      <section>
        <header className="mb-2 flex items-baseline justify-between">
          <h2 className="text-base font-semibold">
            등록 리소스 {items.length > 0 ? `(${items.length})` : ""}
          </h2>
          <button
            type="button"
            onClick={refresh}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            새로고침
          </button>
        </header>

        {err ? (
          <p className="text-sm text-destructive">불러오기 실패: {err}</p>
        ) : null}

        {loading ? (
          <p className="text-sm text-muted-foreground">불러오는 중…</p>
        ) : items.length === 0 ? (
          <p className="text-sm text-muted-foreground">등록된 리소스가 없습니다.</p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {items.map((it) => (
              <li
                key={it.id}
                className="rounded-2xl border bg-card p-4 shadow-soft"
              >
                <div className="flex items-baseline justify-between gap-2">
                  <h3 className="truncate font-medium">{it.name}</h3>
                  <span
                    className={
                      "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium " +
                      (it.active
                        ? "bg-emerald-100 text-emerald-800"
                        : "bg-zinc-200 text-zinc-700")
                    }
                  >
                    {it.active ? "ON" : "OFF"}
                  </span>
                </div>
                <p className="mt-1 truncate font-mono text-[11px] text-muted-foreground">
                  {it.storage_key}
                </p>
                {it.meta ? (
                  <pre className="mt-2 max-h-20 overflow-hidden whitespace-pre-wrap break-all rounded bg-muted/40 p-2 text-[11px] text-muted-foreground">
                    {JSON.stringify(it.meta, null, 0)}
                  </pre>
                ) : null}
                <div className="mt-3 flex justify-end gap-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => toggleActive(it)}
                  >
                    {it.active ? "비활성" : "활성"}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-destructive hover:text-destructive"
                    onClick={() => remove(it)}
                  >
                    삭제
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="block text-xs font-medium">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}

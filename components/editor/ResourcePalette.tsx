"use client";

import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ensureFontLoaded } from "@/lib/fabric/fonts";
import { cn } from "@/lib/utils";

export type ResourceTab = "font" | "clipart" | "background";

export interface ResourceItem {
  id: string;
  type: ResourceTab;
  name: string;
  url: string;
  meta: Record<string, unknown> | null;
}

export interface ResourcePaletteProps {
  initialTab?: ResourceTab;
  /** 폰트 클릭 — 기존 텍스트 선택돼 있으면 fontFamily 변경, 없으면 새 텍스트 추가. */
  onPickFont: (family: string, url: string) => void;
  /** 클립아트(또는 사진) 추가. resourceId 는 PageDoc 에 보존되어 PDF 빌드 시 signedUrl 재발급에 사용. */
  onPickClipart: (url: string, resourceId: string) => void;
  /** 배경 색/이미지. (이미지 url + resourceId — 서버 렌더 재발급용) */
  onPickBackground: (url: string, resourceId: string) => void;
  className?: string;
}

const TABS: Array<{ id: ResourceTab; label: string }> = [
  { id: "font", label: "폰트" },
  { id: "clipart", label: "클립아트" },
  { id: "background", label: "배경" },
];

/**
 * 서버 리소스 그리드.
 *  - `/api/resources?type=...` 호출.
 *  - 폰트는 클릭 시 FontFace 로드.
 *  - 검색은 클라사이드 substring 1차 + 서버 ?q= 옵션.
 *  - 페이징은 단순 100개 한도 (무한스크롤은 후속).
 */
export default function ResourcePalette({
  initialTab = "font",
  onPickFont,
  onPickClipart,
  onPickBackground,
  className,
}: ResourcePaletteProps) {
  const [tab, setTab] = useState<ResourceTab>(initialTab);
  const [items, setItems] = useState<ResourceItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");

  const fetchItems = useCallback(
    async (type: ResourceTab) => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/resources?type=${type}`, {
          cache: "no-store",
        });
        const json = (await res.json()) as {
          ok: boolean;
          data?: { items: ResourceItem[] };
          error?: { message: string };
        };
        if (!res.ok || !json.ok || !json.data) {
          throw new Error(json.error?.message ?? "리소스 로드 실패");
        }
        setItems(json.data.items);
      } catch (e) {
        setError(e instanceof Error ? e.message : "리소스 로드 실패");
        setItems([]);
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    void fetchItems(tab);
  }, [tab, fetchItems]);

  const filtered =
    q.trim().length > 0
      ? items.filter((it) =>
          it.name.toLowerCase().includes(q.trim().toLowerCase()),
        )
      : items;

  return (
    <div className={cn("flex h-full flex-col", className)}>
      <div className="flex items-center gap-1 border-b pb-2">
        {TABS.map((t) => (
          <Button
            key={t.id}
            type="button"
            size="sm"
            variant={tab === t.id ? "default" : "ghost"}
            onClick={() => setTab(t.id)}
            aria-pressed={tab === t.id}
          >
            {t.label}
          </Button>
        ))}
      </div>

      <div className="px-1 py-2">
        <Input
          type="search"
          placeholder="검색"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="리소스 검색"
        />
      </div>

      {error ? (
        <p className="rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive">
          {error}
        </p>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {loading ? (
          <div className="grid grid-cols-3 gap-2 p-1">
            {Array.from({ length: 9 }).map((_, i) => (
              <div
                key={i}
                className="aspect-square animate-pulse rounded-md bg-muted/60"
              />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <p className="p-3 text-sm text-muted-foreground">
            표시할 리소스가 없어요.
          </p>
        ) : tab === "font" ? (
          <ul className="space-y-1 p-1">
            {filtered.map((it) => (
              <li key={it.id}>
                <button
                  type="button"
                  className="w-full rounded-md border border-border bg-card p-3 text-left transition-colors hover:bg-accent/40"
                  onClick={async () => {
                    try {
                      await ensureFontLoaded({
                        family: it.name,
                        src: it.url,
                      });
                    } catch {
                      /* 무시 — 폴백 폰트로 표시 */
                    }
                    onPickFont(it.name, it.url);
                  }}
                >
                  <span
                    className="block text-base"
                    style={{ fontFamily: `${it.name}, system-ui` }}
                  >
                    {it.name} · 한글 영문 Aa
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <ul className="grid grid-cols-3 gap-2 p-1">
            {filtered.map((it) => (
              <li key={it.id}>
                <button
                  type="button"
                  className="block aspect-square w-full overflow-hidden rounded-md border border-border bg-card transition-transform hover:scale-[1.02]"
                  onClick={() =>
                    tab === "clipart"
                      ? onPickClipart(it.url, it.id)
                      : onPickBackground(it.url, it.id)
                  }
                  aria-label={it.name}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={it.url}
                    alt={it.name}
                    loading="lazy"
                    className="size-full object-cover"
                  />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

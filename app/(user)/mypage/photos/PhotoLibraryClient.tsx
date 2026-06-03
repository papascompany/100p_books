"use client";

import {
  ArrowLeft,
  Camera,
  Copy,
  ImageOff,
  Search,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import CopyToProjectDialog from "./CopyToProjectDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/use-toast";
import { cn } from "@/lib/utils";

import type {
  PhotoLibraryItem,
  PhotoLibraryProject,
} from "./page";

type SortMode = "uploaded_desc" | "uploaded_asc" | "taken_desc" | "filename";

interface Props {
  photos: PhotoLibraryItem[];
  projects: PhotoLibraryProject[];
}

/**
 * 사진 라이브러리 클라이언트.
 *  - 검색/필터/정렬, 다중 선택(Shift+클릭), 다른 프로젝트 복사, 휴지통 이동.
 */
export default function PhotoLibraryClient({ photos, projects }: Props) {
  const router = useRouter();
  const { toast } = useToast();

  const [query, setQuery] = useState("");
  const [projectFilter, setProjectFilter] = useState<string>(""); // empty = all
  const [sort, setSort] = useState<SortMode>("uploaded_desc");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [lastSelectedId, setLastSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copyDialogOpen, setCopyDialogOpen] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = photos.filter((p) => {
      if (projectFilter && p.projectId !== projectFilter) return false;
      if (!q) return true;
      const fn = (p.filename ?? "").toLowerCase();
      const pt = p.projectTitle.toLowerCase();
      return fn.includes(q) || pt.includes(q);
    });

    switch (sort) {
      case "uploaded_desc":
        list = [...list].sort(
          (a, b) =>
            new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
        );
        break;
      case "uploaded_asc":
        list = [...list].sort(
          (a, b) =>
            new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
        );
        break;
      case "taken_desc":
        list = [...list].sort((a, b) => {
          const ta = a.exifTakenAt
            ? new Date(a.exifTakenAt).getTime()
            : new Date(a.createdAt).getTime();
          const tb = b.exifTakenAt
            ? new Date(b.exifTakenAt).getTime()
            : new Date(b.createdAt).getTime();
          return tb - ta;
        });
        break;
      case "filename":
        list = [...list].sort((a, b) =>
          (a.filename ?? "").localeCompare(b.filename ?? "", "ko"),
        );
        break;
    }
    return list;
  }, [photos, query, projectFilter, sort]);

  const allSelectedInView =
    filtered.length > 0 && filtered.every((p) => selected.has(p.id));

  function toggleAll() {
    if (allSelectedInView) {
      const next = new Set(selected);
      for (const p of filtered) next.delete(p.id);
      setSelected(next);
    } else {
      const next = new Set(selected);
      for (const p of filtered) next.add(p.id);
      setSelected(next);
    }
  }

  function handleCardClick(e: React.MouseEvent, photoId: string) {
    if (e.shiftKey && lastSelectedId) {
      // shift+click — last 부터 photoId 까지 모두 선택
      const ids = filtered.map((p) => p.id);
      const i1 = ids.indexOf(lastSelectedId);
      const i2 = ids.indexOf(photoId);
      if (i1 >= 0 && i2 >= 0) {
        const [from, to] = i1 < i2 ? [i1, i2] : [i2, i1];
        const next = new Set(selected);
        for (let i = from; i <= to; i++) {
          const id = ids[i];
          if (id) next.add(id);
        }
        setSelected(next);
        setLastSelectedId(photoId);
        return;
      }
    }
    const next = new Set(selected);
    if (next.has(photoId)) next.delete(photoId);
    else next.add(photoId);
    setSelected(next);
    setLastSelectedId(photoId);
  }

  function clearSelection() {
    setSelected(new Set());
    setLastSelectedId(null);
  }

  async function handleTrash() {
    if (selected.size === 0) return;
    if (
      !confirm(
        `선택한 ${selected.size}장을 휴지통으로 옮길까요? 사용 중인 페이지에서는 빈 자리로 표시돼요.`,
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/photos/trash", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ photoIds: Array.from(selected) }),
      });
      const json = (await res.json()) as {
        ok: boolean;
        error?: { message?: string };
      };
      if (!res.ok || !json.ok) {
        throw new Error(json.error?.message ?? "휴지통 이동 실패");
      }
      toast({
        title: "휴지통으로 옮겼어요.",
        description: `${selected.size}장이 휴지통에 있어요.`,
        variant: "success",
      });
      clearSelection();
      router.refresh();
    } catch (e) {
      toast({
        title: "실패",
        description: e instanceof Error ? e.message : "알 수 없는 오류",
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="container mx-auto max-w-6xl px-4 py-8 md:py-10">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <Link
            href="/mypage"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-3.5" aria-hidden /> 마이페이지
          </Link>
          <h1 className="mt-1 font-display text-2xl font-semibold tracking-tight sm:text-3xl">
            사진 라이브러리
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            업로드한 모든 사진을 한 곳에서 관리해요. 다른 프로젝트로 옮기거나
            휴지통으로 이동할 수 있어요.
          </p>
        </div>
        <Link href="/mypage/trash" className="text-sm text-muted-foreground hover:text-foreground">
          휴지통 보기 →
        </Link>
      </header>

      {/* 필터 / 검색 / 정렬 */}
      <section className="mt-6 grid gap-3 sm:grid-cols-3">
        <label className="relative">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            type="search"
            placeholder="파일명·프로젝트명 검색"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-8"
          />
        </label>

        <select
          aria-label="프로젝트 필터"
          value={projectFilter}
          onChange={(e) => setProjectFilter(e.target.value)}
          className="h-11 rounded-md border border-input bg-background px-3 text-sm"
        >
          <option value="">모든 프로젝트</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.title}
            </option>
          ))}
        </select>

        <select
          aria-label="정렬"
          value={sort}
          onChange={(e) => setSort(e.target.value as SortMode)}
          className="h-11 rounded-md border border-input bg-background px-3 text-sm"
        >
          <option value="uploaded_desc">업로드 최신순</option>
          <option value="uploaded_asc">업로드 오래된순</option>
          <option value="taken_desc">촬영 최신순</option>
          <option value="filename">파일명순</option>
        </select>
      </section>

      {/* 액션 바 */}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-md border bg-white/60 p-3 dark:bg-white/40">
        <div className="flex items-center gap-2 text-sm">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={toggleAll}
            disabled={filtered.length === 0}
          >
            {allSelectedInView ? "선택 해제" : "전체 선택"}
          </Button>
          <span className="text-muted-foreground">
            {selected.size > 0
              ? `${selected.size}장 선택됨`
              : `${filtered.length}장 표시 중 (총 ${photos.length})`}
          </span>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={selected.size === 0 || busy}
            onClick={() => setCopyDialogOpen(true)}
          >
            <Copy className="size-4" aria-hidden /> 다른 프로젝트에 추가
          </Button>
          <Button
            type="button"
            variant="destructive"
            size="sm"
            disabled={selected.size === 0 || busy}
            onClick={handleTrash}
          >
            <Trash2 className="size-4" aria-hidden /> 휴지통으로
          </Button>
        </div>
      </div>

      {/* 그리드 */}
      {filtered.length === 0 ? (
        <div className="mt-10 rounded-xl border border-dashed bg-white/40 p-10 text-center text-sm text-muted-foreground dark:bg-white/40">
          {photos.length === 0
            ? "아직 업로드된 사진이 없어요."
            : "조건에 맞는 사진이 없어요."}
        </div>
      ) : (
        <ul
          className="mt-4 grid grid-cols-3 gap-2 sm:gap-3 md:grid-cols-4 lg:grid-cols-6"
          aria-label="사진 그리드"
        >
          {filtered.map((p) => {
            const isSelected = selected.has(p.id);
            return (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={(e) => handleCardClick(e, p.id)}
                  aria-pressed={isSelected}
                  className={cn(
                    "group relative block w-full overflow-hidden rounded-lg border bg-card text-left shadow-soft transition-all",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                    isSelected
                      ? "border-rose-500 ring-2 ring-rose-400"
                      : "hover:border-foreground/30",
                  )}
                >
                  <div className="relative aspect-square w-full bg-muted">
                    {p.thumbUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={p.thumbUrl}
                        alt={p.filename ?? "사진"}
                        loading="lazy"
                        className={cn(
                          "h-full w-full object-cover transition-opacity",
                          isSelected ? "opacity-90" : "opacity-100",
                        )}
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-muted-foreground">
                        <ImageOff className="size-6" aria-hidden />
                      </div>
                    )}

                    {isSelected ? (
                      <span className="absolute right-2 top-2 inline-flex size-7 items-center justify-center rounded-full bg-rose-500 text-xs font-semibold text-white shadow">
                        ✓
                      </span>
                    ) : null}
                  </div>
                  <div className="px-2 py-1.5">
                    <p
                      className="truncate text-[11px] font-medium"
                      title={p.filename ?? ""}
                    >
                      {p.filename ?? "(이름 없음)"}
                    </p>
                    <p
                      className="truncate text-[10px] text-muted-foreground"
                      title={p.projectTitle}
                    >
                      {p.projectTitle}
                    </p>
                    {p.exifTakenAt ? (
                      <p className="mt-0.5 inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                        <Camera className="size-3" aria-hidden />
                        {formatDateShort(p.exifTakenAt)}
                      </p>
                    ) : null}
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <CopyToProjectDialog
        open={copyDialogOpen}
        onOpenChange={setCopyDialogOpen}
        selectedPhotoIds={Array.from(selected)}
        projects={projects}
        onDone={(insertedCount) => {
          toast({
            title: "프로젝트에 추가했어요.",
            description: `${insertedCount}장이 새 프로젝트에 추가됐어요.`,
            variant: "success",
          });
          clearSelection();
          setCopyDialogOpen(false);
          router.refresh();
        }}
      />
    </div>
  );
}

function formatDateShort(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")}`;
  } catch {
    return "";
  }
}

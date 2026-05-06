"use client";

import { BookOpen, MoreVertical, Plus } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/components/ui/use-toast";
import { cn } from "@/lib/utils";

import type { ProjectRow } from "./page";

interface Props {
  projects: ProjectRow[];
}

/** cover_json Fabric canvas 에서 첫 번째 image 객체의 src를 추출 */
function extractCoverThumb(coverJson: Record<string, unknown> | null): string | null {
  if (!coverJson) return null;
  try {
    const objects = coverJson.objects as Array<Record<string, unknown>> | undefined;
    if (!Array.isArray(objects)) return null;
    for (const obj of objects) {
      if (obj.type === "image" && typeof obj.src === "string") {
        return obj.src;
      }
    }
  } catch {
    // 파싱 실패 시 null 반환
  }
  return null;
}

/** relative time 한국어 표현 */
function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60_000);
  const hours = Math.floor(diff / 3_600_000);
  const days = Math.floor(diff / 86_400_000);

  if (minutes < 1) return "방금 전";
  if (minutes < 60) return `${minutes}분 전`;
  if (hours < 24) return `${hours}시간 전`;
  if (days < 30) return `${days}일 전`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}개월 전`;
  return `${Math.floor(months / 12)}년 전`;
}

const STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  draft: {
    label: "편집중",
    className: "bg-white text-[#707072] border border-[#cacacb]",
  },
  ordered: {
    label: "완성",
    className: "bg-[#111111] text-white border border-[#111111]",
  },
};

const DEFAULT_STATUS_CFG = STATUS_CONFIG.draft!;

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status] ?? DEFAULT_STATUS_CFG;
  return (
    <span
      className={cn(
        "inline-flex items-center px-2 py-0.5 text-[11px] font-medium",
        cfg.className,
      )}
    >
      {cfg.label}
    </span>
  );
}

interface CardMenuProps {
  projectId: string;
  onDeleted: (id: string) => void;
}

function CardMenu({ projectId, onDeleted }: CardMenuProps) {
  const { toast } = useToast();
  const [deleting, setDeleting] = useState(false);

  async function handleDelete() {
    if (
      !confirm(
        "이 포토북을 삭제할까요? 내부 페이지와 사진이 함께 삭제됩니다.\n이 작업은 되돌릴 수 없어요.",
      )
    )
      return;

    setDeleting(true);
    try {
      const res = await fetch(`/api/projects/${projectId}`, {
        method: "DELETE",
      });
      const json = (await res.json()) as { ok: boolean; error?: { message?: string } };
      if (!res.ok || !json.ok) {
        throw new Error(json.error?.message ?? "삭제 실패");
      }
      toast({ title: "포토북이 삭제됐어요.", variant: "success" });
      onDeleted(projectId);
    } catch (e) {
      toast({
        title: "삭제 실패",
        description: e instanceof Error ? e.message : "알 수 없는 오류",
        variant: "destructive",
      });
    } finally {
      setDeleting(false);
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="더보기 메뉴"
          disabled={deleting}
          className={cn(
            "absolute right-2 top-2 z-10 flex size-8 items-center justify-center rounded-full",
            "bg-black/40 text-white backdrop-blur-sm transition-opacity",
            "opacity-0 group-hover:opacity-100 focus-visible:opacity-100",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
          )}
        >
          <MoreVertical className="size-4" aria-hidden />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem asChild>
          <Link href={`/editor/${projectId}`}>편집 계속하기</Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href={`/cover/${projectId}`}>표지 편집</Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href={`/order/${projectId}`}>주문하기</Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="text-destructive focus:bg-destructive/10 focus:text-destructive"
          onSelect={handleDelete}
          disabled={deleting}
        >
          {deleting ? "삭제 중..." : "삭제"}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

interface ProjectCardProps {
  project: ProjectRow;
  onDeleted: (id: string) => void;
}

function ProjectCard({ project, onDeleted }: ProjectCardProps) {
  const router = useRouter();
  const thumbSrc = extractCoverThumb(project.cover_json);

  return (
    <article className="group relative flex flex-col overflow-hidden border border-[#e5e5e5] bg-white hover:border-[#cacacb] transition-colors">
      {/* 썸네일 */}
      <button
        type="button"
        aria-label={`${project.title ?? "제목 없음"} 편집하기`}
        className="relative aspect-square w-full overflow-hidden bg-[#f5f5f5] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
        onClick={() => router.push(`/editor/${project.id}`)}
      >
        {thumbSrc ? (
          <Image
            src={thumbSrc}
            alt={project.title ?? "포토북 표지"}
            fill
            sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
            className="object-cover transition-transform duration-300 group-hover:scale-105"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-[#f5f5f5]">
            <BookOpen className="size-10 text-[#cacacb]" aria-hidden />
          </div>
        )}
        {/* 상태 배지 (썸네일 좌하단) */}
        <span className="absolute bottom-2 left-2">
          <StatusBadge status={project.status} />
        </span>
      </button>

      {/* 점 메뉴 */}
      <CardMenu projectId={project.id} onDeleted={onDeleted} />

      {/* 정보 영역 */}
      <div className="flex flex-col gap-0.5 px-3 py-3">
        <p className="truncate text-sm font-semibold leading-snug">
          {project.title ?? "제목 없음"}
        </p>
        <p className="truncate text-xs text-muted-foreground">
          {project.book_sizes?.name ?? "—"}
        </p>
        <p className="mt-1 text-[11px] text-muted-foreground">
          {relativeTime(project.updated_at)}
        </p>
      </div>
    </article>
  );
}

export default function ProjectsClient({ projects: initialProjects }: Props) {
  const [projects, setProjects] = useState(initialProjects);
  const router = useRouter();

  function handleDeleted(id: string) {
    setProjects((prev) => prev.filter((p) => p.id !== id));
  }

  return (
    <div className="container py-6 md:py-10">
      {/* 헤더 */}
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">
            내 포토북
          </h1>
          {projects.length > 0 && (
            <span className="inline-flex items-center bg-[#f5f5f5] px-2.5 py-0.5 text-xs font-medium text-[#707072]">
              {projects.length}
            </span>
          )}
        </div>
        <Button asChild size="sm">
          <Link href="/upload">
            <Plus className="size-4" aria-hidden />
            새 포토북 만들기
          </Link>
        </Button>
      </header>

      {projects.length === 0 ? (
        /* 빈 상태 */
        <div className="flex flex-col items-center justify-center border border-[#cacacb] bg-[#f5f5f5] px-6 py-16 text-center">
          <div className="mb-4 flex size-16 items-center justify-center bg-white">
            <BookOpen className="size-8 text-[#cacacb]" aria-hidden />
          </div>
          <p className="text-base font-semibold text-foreground">
            아직 만든 포토북이 없어요
          </p>
          <p className="mt-1 max-w-xs text-sm text-muted-foreground">
            소중한 사진들을 모아 나만의 포토북을 만들어보세요.
          </p>
          <Button
            className="mt-6"
            onClick={() => router.push("/upload")}
          >
            <Plus className="size-4" aria-hidden />
            지금 만들기
          </Button>
        </div>
      ) : (
        /* 프로젝트 그리드 */
        <ul
          className="grid grid-cols-2 gap-4 sm:grid-cols-3"
          aria-label="내 포토북 목록"
        >
          {projects.map((project) => (
            <li key={project.id}>
              <ProjectCard project={project} onDeleted={handleDeleted} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

"use client";

import { BookOpen, MoreVertical, Plus } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
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
    className: "bg-card text-mute border border-hairline",
  },
  ordered: {
    label: "완성",
    className: "bg-night text-white border border-night",
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
  projectTitle: string | null;
  onDeleted: (id: string) => void;
}

function CardMenu({ projectId, projectTitle, onDeleted }: CardMenuProps) {
  const { toast } = useToast();
  const [deleting, setDeleting] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmInput, setConfirmInput] = useState("");
  const [photoCount, setPhotoCount] = useState<number | null>(null);

  // 2단계 확인 문구 — 카드에 표시되는 제목 그대로 (제목이 없으면 "제목 없음")
  const confirmPhrase = projectTitle?.trim() || "제목 없음";
  const confirmMatches = confirmInput.trim() === confirmPhrase;

  function openConfirm() {
    setConfirmInput("");
    setPhotoCount(null);
    // Radix 드롭다운이 닫힌 다음 틱에 다이얼로그를 연다 (포커스 경합 방지)
    window.setTimeout(() => setConfirmOpen(true), 0);
    // 영구 삭제될 사진 수 조회 — 실패해도 다이얼로그 자체는 동작 (best-effort)
    fetch(`/api/projects/${projectId}`)
      .then(
        (r) =>
          r.json() as Promise<{
            ok: boolean;
            data?: { photoCount?: number };
          }>,
      )
      .then((json) => {
        if (json.ok && typeof json.data?.photoCount === "number") {
          setPhotoCount(json.data.photoCount);
        }
      })
      .catch(() => {
        // 무시 — "모든 사진" 문구로 대체 표기
      });
  }

  async function handleDelete() {
    if (!confirmMatches || deleting) return;

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
      setConfirmOpen(false);
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
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label="더보기 메뉴"
            disabled={deleting}
            className={cn(
              "absolute right-2 top-2 z-10 flex size-8 items-center justify-center rounded-full",
              "bg-black/40 text-white backdrop-blur-sm transition-opacity",
              /* 터치 기기(모바일)에는 hover 가 없으므로 상시 노출, md 이상에서만 hover 노출 */
              "opacity-100 md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100",
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
            onSelect={openConfirm}
            disabled={deleting}
          >
            {deleting ? "삭제 중..." : "삭제"}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* 2단계 삭제 확인 — 프로젝트 삭제는 휴지통 없이 즉시 영구 삭제라 강한 확인이 필요 */}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        {/* 모바일: 상단 정렬 — 제목 입력 시 소프트 키보드가 하단 버튼을 가리지 않게 */}
        <DialogContent className="top-[8%] max-w-md translate-y-0 sm:top-1/2 sm:-translate-y-1/2">
          <DialogHeader>
            <DialogTitle>포토북을 완전히 삭제할까요?</DialogTitle>
            <DialogDescription>
              {photoCount !== null
                ? `내부 페이지와 사진 ${photoCount}장이 즉시 영구 삭제돼요.`
                : "내부 페이지와 모든 사진이 즉시 영구 삭제돼요."}{" "}
              휴지통으로 가지 않으며, 복구할 수 없어요.
            </DialogDescription>
          </DialogHeader>

          <div className="mt-4 flex flex-col gap-1.5">
            <label
              htmlFor={`confirm-delete-${projectId}`}
              className="text-sm font-medium"
            >
              삭제하려면{" "}
              <span className="font-bold text-destructive">{confirmPhrase}</span>
              을(를) 정확히 입력하세요
            </label>
            <Input
              id={`confirm-delete-${projectId}`}
              type="text"
              autoComplete="off"
              placeholder={confirmPhrase}
              value={confirmInput}
              onChange={(e) => setConfirmInput(e.target.value)}
              disabled={deleting}
            />
          </div>

          <DialogFooter className="mt-5">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setConfirmOpen(false)}
              disabled={deleting}
            >
              취소
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={!confirmMatches || deleting}
              onClick={() => void handleDelete()}
            >
              {deleting ? "삭제 중..." : "영구 삭제"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
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
    <article className="group relative flex flex-col overflow-hidden rounded-2xl border border-hairline bg-card shadow-soft transition-all hover:-translate-y-1 hover:border-coral hover:shadow-soft-lg">
      {/* 썸네일 */}
      <button
        type="button"
        aria-label={`${project.title ?? "제목 없음"} 편집하기`}
        className="relative aspect-square w-full overflow-hidden bg-soft-cloud focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
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
          <div className="flex h-full w-full items-center justify-center bg-soft-cloud">
            <BookOpen className="size-10 text-hairline" aria-hidden />
          </div>
        )}
        {/* 상태 배지 (썸네일 좌하단) */}
        <span className="absolute bottom-2 left-2">
          <StatusBadge status={project.status} />
        </span>
      </button>

      {/* 점 메뉴 */}
      <CardMenu
        projectId={project.id}
        projectTitle={project.title}
        onDeleted={onDeleted}
      />

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
            <span className="inline-flex items-center rounded-full bg-soft-cloud px-2.5 py-0.5 text-xs font-medium text-mute">
              {projects.length}
            </span>
          )}
        </div>
        <Button asChild size="sm" variant="coral">
          <Link href="/upload">
            <Plus className="size-4" aria-hidden />
            새 포토북 만들기
          </Link>
        </Button>
      </header>

      {projects.length === 0 ? (
        /* 빈 상태 */
        <div className="flex flex-col items-center justify-center rounded-2xl border border-hairline bg-soft-cloud px-6 py-16 text-center">
          <div className="mb-4 flex size-16 items-center justify-center rounded-2xl bg-card shadow-soft">
            <BookOpen className="size-8 text-hairline" aria-hidden />
          </div>
          <p className="text-base font-semibold text-foreground">
            아직 만든 포토북이 없어요
          </p>
          <p className="mt-1 max-w-xs text-sm text-muted-foreground">
            소중한 사진들을 모아 나만의 포토북을 만들어보세요.
          </p>
          <Button
            className="mt-6"
            variant="coral"
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

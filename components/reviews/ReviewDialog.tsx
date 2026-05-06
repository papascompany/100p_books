"use client";

import { ImagePlus, Loader2, Star, X } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import * as React from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { toast } from "@/components/ui/use-toast";

interface ReviewDialogProps {
  orderId: string;
  /** Dialog 를 여는 버튼 — 기본값: "후기 작성" */
  trigger?: React.ReactNode;
  /** 후기 등록 성공 시 콜백 (선택) */
  onSuccess?: () => void;
}

const MAX_IMAGES = 3;
const MAX_TEXT = 2000;

export default function ReviewDialog({ orderId, trigger, onSuccess }: ReviewDialogProps) {
  const [open, setOpen] = React.useState(false);
  const [rating, setRating] = React.useState(0);
  const [hovered, setHovered] = React.useState(0);
  const [body, setBody] = React.useState("");
  const [files, setFiles] = React.useState<File[]>([]);
  const [previews, setPreviews] = React.useState<string[]>([]);
  const [uploading, setUploading] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  // 파일 선택 시 미리보기 URL 생성
  function handleFiles(selected: FileList | null) {
    if (!selected) return;
    const arr = Array.from(selected).slice(0, MAX_IMAGES - files.length);
    const next = [...files, ...arr].slice(0, MAX_IMAGES);
    setFiles(next);

    // 이전 미리보기 URL 정리
    previews.forEach((url) => URL.revokeObjectURL(url));
    setPreviews(next.map((f) => URL.createObjectURL(f)));
  }

  function removeFile(idx: number) {
    URL.revokeObjectURL(previews[idx] ?? "");
    setFiles((prev) => prev.filter((_, i) => i !== idx));
    setPreviews((prev) => prev.filter((_, i) => i !== idx));
  }

  // 다이얼로그 닫힐 때 상태 초기화
  function reset() {
    setRating(0);
    setHovered(0);
    setBody("");
    previews.forEach((url) => URL.revokeObjectURL(url));
    setFiles([]);
    setPreviews([]);
    setUploading(false);
    setSubmitting(false);
  }

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) reset();
  }

  async function handleSubmit() {
    if (rating === 0) {
      toast({ variant: "warning", title: "별점을 선택해 주세요." });
      return;
    }

    setSubmitting(true);
    try {
      let imageKeys: string[] = [];

      // 이미지 먼저 업로드
      if (files.length > 0) {
        setUploading(true);
        const formData = new FormData();
        for (const f of files) formData.append("files", f);

        const upRes = await fetch("/api/reviews/upload", {
          method: "POST",
          body: formData,
        });
        const upJson = (await upRes.json()) as {
          ok: boolean;
          data?: { imageKeys: string[] };
          error?: { message: string };
        };
        setUploading(false);

        if (!upRes.ok || !upJson.ok) {
          throw new Error(upJson.error?.message ?? "이미지 업로드에 실패했어요.");
        }
        imageKeys = upJson.data?.imageKeys ?? [];
      }

      // 후기 등록
      const res = await fetch("/api/reviews", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          orderId,
          rating,
          body: body.trim() || undefined,
          imageKeys: imageKeys.length > 0 ? imageKeys : undefined,
          public: true,
        }),
      });
      const json = (await res.json()) as {
        ok: boolean;
        error?: { message: string };
      };

      if (!res.ok || !json.ok) {
        throw new Error(json.error?.message ?? "후기 등록에 실패했어요.");
      }

      toast({
        variant: "success",
        title: "후기가 등록됐어요!",
        description: "갤러리에서 내 후기를 확인해 보세요.",
        action: (
          <Link
            href="/gallery"
            className="text-xs font-medium underline hover:no-underline"
          >
            갤러리 보기
          </Link>
        ),
      });
      setOpen(false);
      reset();
      onSuccess?.();
    } catch (e) {
      toast({
        variant: "destructive",
        title: "후기 등록 실패",
        description: e instanceof Error ? e.message : "잠시 후 다시 시도해 주세요.",
      });
    } finally {
      setSubmitting(false);
      setUploading(false);
    }
  }

  const displayRating = hovered || rating;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button type="button" variant="outline" size="sm">
            후기 작성
          </Button>
        )}
      </DialogTrigger>

      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>후기 작성</DialogTitle>
          <DialogDescription>
            포토북 제작 경험을 공유해 주세요. 다른 고객에게 큰 도움이 됩니다.
          </DialogDescription>
        </DialogHeader>

        <div className="mt-4 space-y-5">
          {/* 별점 */}
          <div>
            <p className="mb-2 text-sm font-medium">
              별점 <span className="text-rose-500">*</span>
            </p>
            <div
              className="flex gap-1"
              role="radiogroup"
              aria-label="별점 선택"
            >
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  type="button"
                  role="radio"
                  aria-checked={rating === n}
                  aria-label={`${n}점`}
                  onClick={() => setRating(n)}
                  onMouseEnter={() => setHovered(n)}
                  onMouseLeave={() => setHovered(0)}
                  className="rounded p-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <Star
                    className={
                      "h-8 w-8 transition-colors " +
                      (n <= displayRating
                        ? "fill-amber-400 text-amber-400"
                        : "text-muted-foreground/40")
                    }
                    aria-hidden
                  />
                </button>
              ))}
            </div>
            {rating > 0 ? (
              <p className="mt-1 text-xs text-muted-foreground">
                {["", "최악이에요", "별로예요", "보통이에요", "좋아요", "최고예요"][rating]}
              </p>
            ) : null}
          </div>

          {/* 텍스트 */}
          <div>
            <label className="mb-2 block text-sm font-medium" htmlFor="review-body">
              후기 내용 <span className="text-xs text-muted-foreground font-normal">(선택)</span>
            </label>
            <textarea
              id="review-body"
              value={body}
              onChange={(e) => setBody(e.target.value.slice(0, MAX_TEXT))}
              rows={4}
              placeholder="포토북 품질, 인쇄 색상, 배송 경험 등을 자유롭게 적어 주세요."
              className="w-full resize-none rounded-lg border bg-background px-3 py-2.5 text-sm placeholder:text-muted-foreground/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <p className="mt-1 text-right text-xs text-muted-foreground">
              {body.length}/{MAX_TEXT}
            </p>
          </div>

          {/* 이미지 업로드 */}
          <div>
            <p className="mb-2 text-sm font-medium">
              사진 첨부 <span className="text-xs text-muted-foreground font-normal">(최대 3장, 선택)</span>
            </p>
            <div className="flex flex-wrap gap-2">
              {previews.map((url, idx) => (
                <div key={idx} className="relative h-20 w-20 shrink-0 overflow-hidden rounded-lg border">
                  <Image
                    src={url}
                    alt={`첨부 이미지 ${idx + 1}`}
                    fill
                    className="object-cover"
                    sizes="80px"
                  />
                  <button
                    type="button"
                    onClick={() => removeFile(idx)}
                    aria-label={`이미지 ${idx + 1} 제거`}
                    className="absolute right-0.5 top-0.5 rounded-full bg-black/60 p-0.5 text-white transition-colors hover:bg-black/80"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
              {files.length < MAX_IMAGES ? (
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  aria-label="이미지 추가"
                  className="flex h-20 w-20 shrink-0 flex-col items-center justify-center gap-1 rounded-lg border border-dashed text-muted-foreground transition-colors hover:border-foreground/40 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <ImagePlus className="h-5 w-5" aria-hidden />
                  <span className="text-xs">추가</span>
                </button>
              ) : null}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/heic"
                multiple
                className="sr-only"
                aria-hidden
                onChange={(e) => handleFiles(e.target.files)}
              />
            </div>
          </div>
        </div>

        <DialogFooter className="mt-6">
          <Button
            type="button"
            variant="outline"
            onClick={() => handleOpenChange(false)}
            disabled={submitting}
          >
            취소
          </Button>
          <Button
            type="button"
            variant="gradient"
            onClick={() => void handleSubmit()}
            disabled={rating === 0 || submitting}
          >
            {uploading ? (
              <>
                <Loader2 className="animate-spin" aria-hidden />
                이미지 업로드 중...
              </>
            ) : submitting ? (
              <>
                <Loader2 className="animate-spin" aria-hidden />
                등록 중...
              </>
            ) : (
              "후기 등록"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Check, Copy, ExternalLink, Link2, Loader2, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/use-toast";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ShareToken {
  id: string;
  token: string;
  shareUrl: string;
  expiresAt: string | null;
  viewCount: number;
  createdAt: string;
}

type ExpiryOption = "unlimited" | "7" | "30";

const EXPIRY_OPTIONS: { value: ExpiryOption; label: string }[] = [
  { value: "unlimited", label: "무기한" },
  { value: "7", label: "7일" },
  { value: "30", label: "30일" },
];

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function formatExpiry(iso: string | null) {
  if (!iso) return "무기한";
  return new Date(iso).toLocaleDateString("ko-KR", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function isExpired(iso: string | null) {
  if (!iso) return false;
  return new Date(iso).getTime() < Date.now();
}

// ---------------------------------------------------------------------------
// ShareDialog
// ---------------------------------------------------------------------------

interface ShareDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
}

export default function ShareDialog({ open, onOpenChange, projectId }: ShareDialogProps) {
  const [tokens, setTokens] = useState<ShareToken[]>([]);
  const [loadingTokens, setLoadingTokens] = useState(false);
  const [creating, setCreating] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [expiry, setExpiry] = useState<ExpiryOption>("unlimited");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 토큰 목록 fetch
  const loadTokens = useCallback(async () => {
    setLoadingTokens(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/share`, { cache: "no-store" });
      const json = (await res.json()) as {
        ok: boolean;
        data?: { tokens: ShareToken[] };
        error?: { message?: string };
      };
      if (!res.ok || !json.ok) throw new Error(json.error?.message ?? "목록 불러오기 실패");
      setTokens(json.data?.tokens ?? []);
    } catch (e) {
      toast({
        title: "목록 불러오기 실패",
        description: e instanceof Error ? e.message : "알 수 없는 오류",
        variant: "destructive",
      });
    } finally {
      setLoadingTokens(false);
    }
  }, [projectId]);

  // 다이얼로그 열릴 때 목록 로드
  useEffect(() => {
    if (open) {
      void loadTokens();
    }
  }, [open, loadTokens]);

  // 언마운트 시 타이머 정리
  useEffect(() => {
    return () => {
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    };
  }, []);

  // 링크 생성
  async function handleCreate() {
    setCreating(true);
    try {
      const body: { expiresInDays?: number } = {};
      if (expiry !== "unlimited") body.expiresInDays = Number(expiry);

      const res = await fetch(`/api/projects/${projectId}/share`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await res.json()) as {
        ok: boolean;
        data?: ShareToken;
        error?: { message?: string };
      };
      if (!res.ok || !json.ok || !json.data) {
        throw new Error(json.error?.message ?? "링크 생성 실패");
      }
      setTokens((prev) => [json.data!, ...prev]);
      toast({ description: "공유 링크가 생성됐어요.", variant: "success" });
    } catch (e) {
      toast({
        title: "링크 생성 실패",
        description: e instanceof Error ? e.message : "알 수 없는 오류",
        variant: "destructive",
      });
    } finally {
      setCreating(false);
    }
  }

  // 링크 복사
  async function handleCopy(token: ShareToken) {
    try {
      await navigator.clipboard.writeText(token.shareUrl);
      setCopiedId(token.id);
      toast({ description: "링크가 복사됐어요.", variant: "success" });
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
      copyTimerRef.current = setTimeout(() => setCopiedId(null), 2000);
    } catch {
      toast({ description: "복사에 실패했어요. 직접 링크를 선택해 복사해 주세요.", variant: "destructive" });
    }
  }

  // 토큰 삭제
  async function handleDelete(tokenId: string) {
    setDeletingId(tokenId);
    try {
      const res = await fetch(`/api/projects/${projectId}/share/${tokenId}`, {
        method: "DELETE",
      });
      const json = (await res.json()) as { ok: boolean; error?: { message?: string } };
      if (!res.ok || !json.ok) throw new Error(json.error?.message ?? "삭제 실패");
      setTokens((prev) => prev.filter((t) => t.id !== tokenId));
      toast({ description: "링크가 삭제됐어요.", variant: "success" });
    } catch (e) {
      toast({
        title: "삭제 실패",
        description: e instanceof Error ? e.message : "알 수 없는 오류",
        variant: "destructive",
      });
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          className={cn(
            "fixed inset-0 z-50 bg-black/40 backdrop-blur-sm",
            "data-[state=open]:animate-in data-[state=open]:fade-in-0",
            "data-[state=closed]:animate-out data-[state=closed]:fade-out-0",
          )}
        />
        <DialogPrimitive.Content
          className={cn(
            "fixed left-1/2 top-1/2 z-50 w-[92vw] max-w-md -translate-x-1/2 -translate-y-1/2",
            "rounded-xl border bg-card p-5 shadow-soft-lg",
            "data-[state=open]:animate-fade-in",
            "focus:outline-none",
          )}
          aria-describedby="share-dialog-desc"
        >
          {/* 헤더 */}
          <div className="flex items-start justify-between gap-3">
            <div>
              <DialogPrimitive.Title className="flex items-center gap-2 text-base font-semibold">
                <Link2 className="size-4 text-rose-500" aria-hidden />
                공유 링크
              </DialogPrimitive.Title>
              <DialogPrimitive.Description
                id="share-dialog-desc"
                className="mt-0.5 text-sm text-muted-foreground"
              >
                비로그인 사용자도 링크로 이 포토북을 볼 수 있어요.
              </DialogPrimitive.Description>
            </div>
            <DialogPrimitive.Close
              aria-label="닫기"
              className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <X className="size-4" />
            </DialogPrimitive.Close>
          </div>

          {/* 구분선 */}
          <div className="my-4 border-t" />

          {/* 링크 생성 폼 */}
          <div className="space-y-3">
            <p className="text-xs font-medium text-muted-foreground">유효기간</p>
            <div
              role="radiogroup"
              aria-label="링크 유효기간 선택"
              className="flex gap-2"
            >
              {EXPIRY_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  role="radio"
                  aria-checked={expiry === opt.value}
                  onClick={() => setExpiry(opt.value)}
                  className={cn(
                    "flex-1 rounded-md border px-3 py-2 text-sm font-medium transition-colors",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                    expiry === opt.value
                      ? "border-rose-400 bg-rose-50 text-rose-700 ring-1 ring-rose-300 dark:bg-rose-950/30 dark:text-rose-300"
                      : "border-input bg-background text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            <Button
              type="button"
              variant="gradient"
              size="sm"
              className="w-full"
              onClick={() => void handleCreate()}
              disabled={creating}
              aria-busy={creating}
            >
              {creating ? (
                <>
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                  생성 중...
                </>
              ) : (
                <>
                  <Link2 className="size-4" aria-hidden />
                  링크 생성
                </>
              )}
            </Button>
          </div>

          {/* 기존 토큰 목록 */}
          {(loadingTokens || tokens.length > 0) && (
            <>
              <div className="my-4 border-t" />
              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground">
                  {loadingTokens ? "불러오는 중…" : `생성된 링크 ${tokens.length}개`}
                </p>

                {loadingTokens ? (
                  <div className="flex items-center justify-center py-6">
                    <Loader2 className="size-5 animate-spin text-muted-foreground" aria-label="로딩 중" />
                  </div>
                ) : (
                  <ul className="max-h-[40vh] space-y-2 overflow-y-auto" aria-label="공유 링크 목록">
                    {tokens.map((token) => {
                      const expired = isExpired(token.expiresAt);
                      const isCopied = copiedId === token.id;
                      const isDeleting = deletingId === token.id;

                      return (
                        <li
                          key={token.id}
                          className={cn(
                            "rounded-lg border p-3 text-sm",
                            expired
                              ? "border-border/50 bg-muted/40 opacity-60"
                              : "border-input bg-background",
                          )}
                        >
                          {/* URL 입력 */}
                          <div className="flex items-center gap-2">
                            <Input
                              readOnly
                              value={token.shareUrl}
                              aria-label={`공유 링크 ${token.expiresAt ? `(${formatExpiry(token.expiresAt)} 만료)` : "(무기한)"}`}
                              className="h-8 flex-1 truncate text-xs"
                              onFocus={(e) => e.currentTarget.select()}
                            />
                            <button
                              type="button"
                              onClick={() => void handleCopy(token)}
                              disabled={expired || isDeleting}
                              aria-label="링크 복사"
                              className={cn(
                                "flex size-8 shrink-0 items-center justify-center rounded-md transition-colors",
                                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                                "border border-input bg-background hover:bg-accent disabled:pointer-events-none disabled:opacity-50",
                              )}
                            >
                              {isCopied ? (
                                <Check className="size-3.5 text-emerald-500" aria-hidden />
                              ) : (
                                <Copy className="size-3.5" aria-hidden />
                              )}
                            </button>
                            <a
                              href={token.shareUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              aria-label="새 탭에서 열기"
                              className={cn(
                                "flex size-8 shrink-0 items-center justify-center rounded-md transition-colors",
                                "border border-input bg-background hover:bg-accent",
                                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                                expired && "pointer-events-none opacity-40",
                              )}
                              tabIndex={expired ? -1 : 0}
                            >
                              <ExternalLink className="size-3.5" aria-hidden />
                            </a>
                            <button
                              type="button"
                              onClick={() => void handleDelete(token.id)}
                              disabled={isDeleting}
                              aria-label="링크 삭제"
                              className={cn(
                                "flex size-8 shrink-0 items-center justify-center rounded-md transition-colors",
                                "border border-input bg-background text-muted-foreground hover:border-destructive/50 hover:bg-destructive/5 hover:text-destructive",
                                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                                "disabled:pointer-events-none disabled:opacity-50",
                              )}
                            >
                              {isDeleting ? (
                                <Loader2 className="size-3.5 animate-spin" aria-hidden />
                              ) : (
                                <Trash2 className="size-3.5" aria-hidden />
                              )}
                            </button>
                          </div>

                          {/* 메타 정보 */}
                          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
                            <span>
                              {expired ? (
                                <span className="text-destructive/80">만료됨</span>
                              ) : (
                                `${formatExpiry(token.expiresAt)} 까지`
                              )}
                            </span>
                            <span aria-hidden>·</span>
                            <span>조회 {token.viewCount.toLocaleString()}회</span>
                            <span aria-hidden>·</span>
                            <span>
                              {new Date(token.createdAt).toLocaleDateString("ko-KR", {
                                month: "short",
                                day: "numeric",
                              })}{" "}
                              생성
                            </span>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

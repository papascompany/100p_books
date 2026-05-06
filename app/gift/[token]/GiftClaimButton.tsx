"use client";

import { BookOpen, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";

interface ClaimApiSuccess {
  ok: true;
  data: { newProjectId: string; alreadyClaimed: boolean };
}

interface ClaimApiError {
  ok: false;
  error: { message: string; code?: string };
}

type ClaimApiResponse = ClaimApiSuccess | ClaimApiError;

interface GiftClaimButtonProps {
  token: string;
  /** 이미 claim 된 경우 바로 이동할 projectId */
  claimedProjectId?: string | null;
}

export function GiftClaimButton({
  token,
  claimedProjectId,
}: GiftClaimButtonProps) {
  const router = useRouter();
  const [claiming, setClaiming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 이미 수령한 경우 — 에디터로 바로 이동
  if (claimedProjectId) {
    return (
      <Button
        variant="gradient"
        size="lg"
        onClick={() => router.push(`/editor/${claimedProjectId}`)}
        className="w-full sm:w-auto gap-2"
      >
        <BookOpen className="h-4 w-4" aria-hidden="true" />
        내 책장 열기
      </Button>
    );
  }

  async function handleClaim() {
    setError(null);
    setClaiming(true);

    try {
      const res = await fetch(`/api/gifts/${token}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "claim" }),
      });
      const json = (await res.json()) as ClaimApiResponse;

      if (!res.ok || !json.ok) {
        const msg =
          (json as ClaimApiError).error?.message ??
          "선물 수령에 실패했습니다.";
        setError(msg);
        setClaiming(false);
        return;
      }

      const { newProjectId } = json.data;
      router.push(`/editor/${newProjectId}`);
      // router.push 이후에도 claiming 유지 (페이지 전환까지 로딩 표시)
    } catch {
      setError("네트워크 오류가 발생했습니다. 잠시 후 다시 시도해주세요.");
      setClaiming(false);
    }
  }

  return (
    <div className="space-y-2">
      <Button
        variant="gradient"
        size="lg"
        onClick={handleClaim}
        disabled={claiming}
        className="w-full sm:w-auto gap-2"
        aria-busy={claiming}
      >
        {claiming ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            수령 중…
          </>
        ) : (
          <>
            <BookOpen className="h-4 w-4" aria-hidden="true" />
            내 책장에 받기
          </>
        )}
      </Button>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

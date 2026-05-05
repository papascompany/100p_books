import { Loader2 } from "lucide-react";

export default function Loading() {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex flex-1 flex-col items-center justify-center gap-3 py-24 text-muted-foreground"
    >
      <Loader2 className="size-7 animate-spin text-rose-500" aria-hidden />
      <p className="text-sm">불러오는 중...</p>
      <span className="sr-only">콘텐츠를 불러오는 중입니다</span>
    </div>
  );
}

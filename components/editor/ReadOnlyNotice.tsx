import {
  READ_ONLY_NOTICE_TITLE,
  normalizeLockMessage,
} from "@/lib/editor/lock-ui";
import { cn } from "@/lib/utils";

export interface ReadOnlyNoticeProps {
  /** 잠금 안내(서버 진입 판정 또는 저장 409). null 이면 아무것도 그리지 않는다. */
  message: string | null | undefined;
  className?: string;
}

/**
 * 결제 후 편집 잠금 배너 — 표지·내지 목록·페이지 에디터 공용.
 *
 * 화면마다 문구·색을 따로 적지 않기 위한 단일 출처다(app/(user)/editor/[projectId]/lock-ui-wiring.test.ts
 * 가 각 화면에 배너 마크업이 다시 생기지 않는지 고정한다).
 */
export default function ReadOnlyNotice({
  message,
  className,
}: ReadOnlyNoticeProps) {
  const notice = normalizeLockMessage(message);
  if (notice === null) return null;
  return (
    <div
      role="status"
      className={cn(
        "w-full rounded-lg border border-amber-300/60 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800/60 dark:bg-amber-950/40 dark:text-amber-200",
        className,
      )}
    >
      <p className="font-medium">{READ_ONLY_NOTICE_TITLE}</p>
      <p className="mt-1">{notice}</p>
    </div>
  );
}

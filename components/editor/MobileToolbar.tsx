"use client";

import {
  Layers,
  PlusCircle,
  Wrench,
} from "lucide-react";

import { cn } from "@/lib/utils";

export type MobileTab = "tools" | "layers" | "add";

export interface MobileToolbarProps {
  /** Currently active tab (if a sheet is open). Null when all sheets are closed. */
  activeTab: MobileTab | null;
  onTabPress: (tab: MobileTab) => void;
  className?: string;
}

const TABS: Array<{ id: MobileTab; label: string; Icon: typeof Wrench }> = [
  { id: "tools", label: "도구", Icon: Wrench },
  { id: "layers", label: "레이어", Icon: Layers },
  { id: "add", label: "추가", Icon: PlusCircle },
];

/**
 * 모바일 에디터 하단 탭 바.
 *
 * - `fixed bottom-0` + iOS safe-area 패딩
 * - 탭 3개: 도구 / 레이어 / 추가
 * - 탭 클릭 시 `onTabPress` 콜백 → 부모가 해당 Bottom Sheet 를 오픈/토글
 * - 터치 타겟 최소 44×44pt 보장 (min-h-[56px] + py-2)
 *
 * 데스크탑에서는 렌더되지 않도록 부모에서 `md:hidden` 으로 감싸거나
 * 이 컴포넌트 자체의 className 으로 `md:hidden` 지정.
 */
export default function MobileToolbar({
  activeTab,
  onTabPress,
  className,
}: MobileToolbarProps) {
  return (
    <nav
      aria-label="에디터 모바일 도구바"
      className={cn(
        "fixed bottom-0 left-0 right-0 z-50",
        "border-t border-border bg-background/95 backdrop-blur",
        "pb-[env(safe-area-inset-bottom)]",
        className,
      )}
    >
      <div className="flex items-stretch">
        {TABS.map(({ id, label, Icon }) => {
          const isActive = activeTab === id;
          return (
            <button
              key={id}
              type="button"
              aria-label={label}
              aria-pressed={isActive}
              onClick={() => onTabPress(id)}
              className={cn(
                "flex flex-1 min-h-[56px] flex-col items-center justify-center gap-1",
                "py-2 text-[11px] font-medium transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
                isActive
                  ? "text-rose-500"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon
                className={cn(
                  "size-5 transition-transform duration-150",
                  isActive && "scale-110",
                )}
                aria-hidden
              />
              <span>{label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}

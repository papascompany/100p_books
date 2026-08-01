"use client";

import {
  BringToFront,
  Copy,
  Layers,
  MoreHorizontal,
  PlusCircle,
  Redo2,
  SendToBack,
  Trash2,
  Undo2,
  Wrench,
} from "lucide-react";

import { cn } from "@/lib/utils";

export type MobileTab = "tools" | "layers" | "add";

export interface MobileToolbarProps {
  /** Currently active tab (if a sheet is open). Null when all sheets are closed. */
  activeTab: MobileTab | null;
  onTabPress: (tab: MobileTab) => void;
  /** 퀵 바 — Undo/Redo 상시 노출. */
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  /** 퀵 바 — 선택 객체가 있을 때만 노출되는 객체 도구. */
  hasSelection: boolean;
  onDuplicate: () => void;
  onBringForward: () => void;
  onSendBackward: () => void;
  onDelete: () => void;
  /** 더보기 — 부모가 레이어 시트를 연다. */
  onMore: () => void;
  className?: string;
}

const TABS: Array<{ id: MobileTab; label: string; Icon: typeof Wrench }> = [
  { id: "tools", label: "도구", Icon: Wrench },
  { id: "layers", label: "레이어", Icon: Layers },
  { id: "add", label: "추가", Icon: PlusCircle },
];

interface QuickAction {
  key: string;
  label: string;
  Icon: typeof Wrench;
  onPress: () => void;
  disabled?: boolean;
  destructive?: boolean;
}

/**
 * 모바일 에디터 하단 바 = 퀵 바(1열) + 탭 바(1열).
 *
 * 퀵 바:
 *   - Undo/Redo 상시 (히스토리 없으면 disabled)
 *   - 선택 객체가 있으면 복제/앞으로/뒤로/삭제/더보기 추가 노출
 * 탭 바:
 *   - 도구 / 레이어 / 추가 — `onTabPress` 로 부모가 Bottom Sheet 오픈/토글
 *
 * 터치 타겟 최소 44×44pt 보장. 데스크탑에서는 부모에서 `md:hidden` 지정.
 */
export default function MobileToolbar({
  activeTab,
  onTabPress,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  hasSelection,
  onDuplicate,
  onBringForward,
  onSendBackward,
  onDelete,
  onMore,
  className,
}: MobileToolbarProps) {
  const quickActions: QuickAction[] = [
    {
      key: "undo",
      label: "실행 취소",
      Icon: Undo2,
      onPress: onUndo,
      disabled: !canUndo,
    },
    {
      key: "redo",
      label: "다시 실행",
      Icon: Redo2,
      onPress: onRedo,
      disabled: !canRedo,
    },
    ...(hasSelection
      ? ([
          {
            key: "duplicate",
            label: "복제",
            Icon: Copy,
            onPress: onDuplicate,
          },
          {
            key: "bring-forward",
            label: "앞으로",
            Icon: BringToFront,
            onPress: onBringForward,
          },
          {
            key: "send-backward",
            label: "뒤로",
            Icon: SendToBack,
            onPress: onSendBackward,
          },
          {
            key: "delete",
            label: "삭제",
            Icon: Trash2,
            onPress: onDelete,
            destructive: true,
          },
          {
            key: "more",
            label: "더보기",
            Icon: MoreHorizontal,
            onPress: onMore,
          },
        ] satisfies QuickAction[])
      : []),
  ];

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
      {/* 퀵 바 — Undo/Redo 상시 + 선택 객체 도구 */}
      <div
        className="flex items-stretch justify-center gap-1 border-b border-border/60 px-2"
        aria-label="빠른 작업"
      >
        {quickActions.map(({ key, label, Icon, onPress, disabled, destructive }) => (
          <button
            key={key}
            type="button"
            aria-label={label}
            onClick={onPress}
            disabled={disabled}
            className={cn(
              "flex min-h-11 min-w-11 items-center justify-center rounded-md",
              "transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
              "disabled:opacity-35",
              destructive
                ? "text-destructive hover:bg-destructive/10"
                : "text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
          >
            <Icon className="size-5" aria-hidden />
          </button>
        ))}
      </div>

      {/* 탭 바 */}
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
                  ? "text-coral"
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

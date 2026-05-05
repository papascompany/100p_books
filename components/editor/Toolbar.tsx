"use client";

import {
  Image as ImageIcon,
  Layers,
  Palette,
  Redo2,
  Sparkles,
  Trash2,
  Type,
  Undo2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type ToolbarTool = "text" | "image" | "clipart" | "background" | "layer";

export interface ToolbarProps {
  /** 좌측 사이드바(데스크탑) / 하단 바텀시트(모바일) 동일 항목. */
  onPick: (tool: ToolbarTool) => void;
  onUndo: () => void;
  onRedo: () => void;
  onDelete: () => void;
  canUndo: boolean;
  canRedo: boolean;
  hasSelection: boolean;
  /** 모바일 모드: false 면 데스크탑 사이드바 스타일. */
  mobile?: boolean;
  className?: string;
}

interface ToolDef {
  id: ToolbarTool;
  label: string;
  Icon: typeof Type;
}

const TOOLS: ToolDef[] = [
  { id: "text", label: "텍스트", Icon: Type },
  { id: "image", label: "사진", Icon: ImageIcon },
  { id: "clipart", label: "클립아트", Icon: Sparkles },
  { id: "background", label: "배경", Icon: Palette },
  { id: "layer", label: "레이어", Icon: Layers },
];

/**
 * 데스크탑(좌측 세로) / 모바일(가로 그리드) 두 모드.
 * 모바일은 `MobileBottomSheet` 안에 children 으로 넣어 사용.
 */
export default function Toolbar({
  onPick,
  onUndo,
  onRedo,
  onDelete,
  canUndo,
  canRedo,
  hasSelection,
  mobile = false,
  className,
}: ToolbarProps) {
  return (
    <div
      role="toolbar"
      aria-label="에디터 도구"
      className={cn(
        mobile
          ? "grid grid-cols-5 gap-2"
          : "flex w-full flex-col gap-1.5",
        className,
      )}
    >
      {TOOLS.map(({ id, label, Icon }) => (
        <Button
          key={id}
          variant="ghost"
          size={mobile ? "default" : "sm"}
          onClick={() => onPick(id)}
          className={cn(
            "min-h-11 justify-center",
            mobile ? "flex-col gap-1 text-[11px]" : "justify-start gap-3",
          )}
          aria-label={label}
        >
          <Icon className="size-5" aria-hidden />
          <span className={mobile ? "" : "text-sm"}>{label}</span>
        </Button>
      ))}

      <div
        className={cn(
          "border-border/60",
          mobile ? "col-span-5 mt-2 flex gap-2 border-t pt-2" : "mt-2 flex gap-1.5 border-t pt-2",
        )}
      >
        <Button
          variant="ghost"
          size={mobile ? "default" : "sm"}
          onClick={onUndo}
          disabled={!canUndo}
          aria-label="되돌리기"
          className={mobile ? "flex-1 flex-col gap-1 text-[11px]" : "flex-1 justify-center"}
        >
          <Undo2 className="size-5" aria-hidden />
          {mobile ? <span>되돌리기</span> : null}
        </Button>
        <Button
          variant="ghost"
          size={mobile ? "default" : "sm"}
          onClick={onRedo}
          disabled={!canRedo}
          aria-label="다시 실행"
          className={mobile ? "flex-1 flex-col gap-1 text-[11px]" : "flex-1 justify-center"}
        >
          <Redo2 className="size-5" aria-hidden />
          {mobile ? <span>다시 실행</span> : null}
        </Button>
        <Button
          variant="ghost"
          size={mobile ? "default" : "sm"}
          onClick={onDelete}
          disabled={!hasSelection}
          aria-label="삭제"
          className={mobile ? "flex-1 flex-col gap-1 text-[11px] text-destructive" : "flex-1 justify-center text-destructive"}
        >
          <Trash2 className="size-5" aria-hidden />
          {mobile ? <span>삭제</span> : null}
        </Button>
      </div>
    </div>
  );
}

"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Keyboard, X } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * 키보드 단축키 안내 다이얼로그.
 *  - macOS / Windows 표기 자동 감지 (`Cmd` vs `Ctrl`).
 *  - `?` 키로 어디서든 열기 (입력 중일 때는 무시).
 *  - 사용자 첫 방문 시 자동 노출 (localStorage `editor.shortcutsSeen`).
 */

const SEEN_KEY = "editor.shortcutsSeen";

interface ShortcutItem {
  keys: string[][]; // OR 묶음 — 같은 동작에 여러 단축키.
  label: string;
}

interface ShortcutGroup {
  title: string;
  items: ShortcutItem[];
}

function getModKey(): "Cmd" | "Ctrl" {
  if (typeof navigator === "undefined") return "Ctrl";
  const ua = navigator.userAgent || "";
  return /Mac|iPhone|iPad|iPod/.test(ua) ? "Cmd" : "Ctrl";
}

export interface KeyboardShortcutsHelpProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 트리거 버튼 자체를 외부에 노출하지 않고 다이얼로그만 쓰는 경우 true. */
  hideTrigger?: boolean;
}

/**
 * 다이얼로그 단독 컴포넌트. 트리거 버튼은 별도 IconButton 으로 외부 배치.
 */
export default function KeyboardShortcutsHelp({
  open,
  onOpenChange,
}: KeyboardShortcutsHelpProps) {
  const [mod, setMod] = useState<"Cmd" | "Ctrl">("Ctrl");
  useEffect(() => {
    setMod(getModKey());
  }, []);

  const groups: ShortcutGroup[] = [
    {
      title: "편집",
      items: [
        { keys: [[mod, "Z"]], label: "되돌리기" },
        { keys: [[mod, "Shift", "Z"], [mod, "Y"]], label: "다시 실행" },
        { keys: [[mod, "C"]], label: "선택 객체 복사" },
        { keys: [[mod, "V"]], label: "붙여넣기" },
        { keys: [[mod, "D"]], label: "즉시 복제" },
        { keys: [["Delete"], ["Backspace"]], label: "선택 객체 삭제" },
      ],
    },
    {
      title: "이동",
      items: [
        { keys: [["←"], ["→"], ["↑"], ["↓"]], label: "선택 객체 1mm 이동" },
        { keys: [["Shift", "←"], ["Shift", "→"], ["Shift", "↑"], ["Shift", "↓"]], label: "10mm 이동" },
      ],
    },
    {
      title: "선택",
      items: [
        { keys: [["Tab"]], label: "다음 객체 선택" },
        { keys: [["Esc"]], label: "선택 해제" },
      ],
    },
    {
      title: "페이지 / 보기",
      items: [
        { keys: [["J"], ["PageDown"]], label: "다음 페이지" },
        { keys: [["K"], ["PageUp"]], label: "이전 페이지" },
        { keys: [[mod, "Shift", "P"]], label: "페이지 미리보기" },
        { keys: [["?"]], label: "이 안내 열기" },
      ],
    },
  ];

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          className={cn(
            "fixed inset-0 z-50 bg-black/50 backdrop-blur-[2px]",
            "data-[state=open]:animate-in data-[state=open]:fade-in-0",
            "data-[state=closed]:animate-out data-[state=closed]:fade-out-0",
          )}
        />
        <DialogPrimitive.Content
          className={cn(
            "fixed left-1/2 top-1/2 z-50 w-[min(94vw,640px)] -translate-x-1/2 -translate-y-1/2",
            "max-h-[85vh] overflow-y-auto rounded-xl border bg-background p-5 shadow-soft-lg",
            "data-[state=open]:animate-fade-in",
            "focus:outline-none",
          )}
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <DialogPrimitive.Title className="flex items-center gap-2 text-base font-semibold">
                <Keyboard className="size-5" aria-hidden /> 키보드 단축키
              </DialogPrimitive.Title>
              <DialogPrimitive.Description className="mt-1 text-sm text-muted-foreground">
                자주 쓰는 동작을 키보드로 빠르게 호출할 수 있어요.
              </DialogPrimitive.Description>
            </div>
            <DialogPrimitive.Close
              aria-label="닫기"
              className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <X className="size-4" />
            </DialogPrimitive.Close>
          </div>

          <div className="mt-5 grid gap-5 sm:grid-cols-2">
            {groups.map((g) => (
              <section key={g.title} className="space-y-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {g.title}
                </h3>
                <ul className="space-y-1.5 text-sm">
                  {g.items.map((it) => (
                    <li
                      key={it.label}
                      className="flex items-center justify-between gap-3"
                    >
                      <span className="text-foreground">{it.label}</span>
                      <span className="flex flex-wrap items-center gap-1">
                        {it.keys.map((combo, ci) => (
                          <span key={ci} className="flex items-center gap-1">
                            {ci > 0 ? (
                              <span className="text-[10px] text-muted-foreground">
                                또는
                              </span>
                            ) : null}
                            {combo.map((key, ki) => (
                              <kbd
                                key={`${ci}-${ki}`}
                                className="inline-flex min-w-[1.5rem] items-center justify-center rounded border border-border bg-muted px-1.5 py-0.5 text-[11px] font-medium font-mono text-foreground"
                              >
                                {key}
                              </kbd>
                            ))}
                          </span>
                        ))}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>

          <div className="mt-6 flex justify-end">
            <Button
              variant="outline"
              size="sm"
              onClick={() => onOpenChange(false)}
            >
              닫기
            </Button>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/**
 * 첫 방문 자동 노출 헬퍼. localStorage 에 SEEN_KEY 가 없으면 true 를 반환.
 * 호출 측에서 다이얼로그 open 직후 mark() 로 표시.
 */
export function useShortcutsAutoShow(): {
  shouldShow: boolean;
  mark: () => void;
} {
  const [shouldShow, setShouldShow] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const seen = window.localStorage.getItem(SEEN_KEY);
      if (!seen) setShouldShow(true);
    } catch {
      // localStorage 불가 환경: 그냥 표시 안 함.
    }
  }, []);
  return {
    shouldShow,
    mark: () => {
      try {
        window.localStorage.setItem(SEEN_KEY, "1");
      } catch {
        // ignore
      }
      setShouldShow(false);
    },
  };
}

"use client";

import { Monitor, Moon, Sun } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import { useTheme, type Theme } from "./ThemeProvider";

/**
 * 헤더에 마운트되는 테마 토글 — 시스템 / 라이트 / 다크 3옵션.
 * 키보드 + aria-label 모두 지원.
 */
export default function ThemeToggle() {
  const { theme, resolvedTheme, setTheme } = useTheme();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={`테마 변경 (현재: ${labelOf(theme)})`}
        >
          {resolvedTheme === "dark" ? (
            <Moon aria-hidden />
          ) : (
            <Sun aria-hidden />
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>테마</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup
          value={theme}
          onValueChange={(v) => setTheme(v as Theme)}
        >
          <DropdownMenuRadioItem value="system">
            <Monitor className="h-4 w-4" aria-hidden />
            <span>시스템</span>
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="light">
            <Sun className="h-4 w-4" aria-hidden />
            <span>라이트</span>
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="dark">
            <Moon className="h-4 w-4" aria-hidden />
            <span>다크</span>
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function labelOf(t: Theme): string {
  return t === "system" ? "시스템" : t === "dark" ? "다크" : "라이트";
}

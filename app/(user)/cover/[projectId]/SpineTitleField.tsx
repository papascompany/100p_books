"use client";

/**
 * 책등 제목 입력칸 — 책등은 세로쓰기(한 글자 폭)라 캔버스에서 직접 클릭해 고치기 어렵다.
 * 입력한 글은 바로 책등에 세로로 보이고 인쇄된다. 비워 두면 제목이 흐린 안내 문구로만
 * 보이고 인쇄되지 않는다(2026-11-17 오너 결정).
 */

import { useId } from "react";

export interface SpineTitleFieldProps {
  /** 현재 책등 텍스트. null = 책등 텍스트 없음(추가 버튼으로 만든다). */
  value: string | null;
  /** 안내 문구로 보여 줄 포토북 제목. */
  placeholder: string;
  disabled?: boolean;
  onChange: (text: string) => void;
}

export default function SpineTitleField({
  value,
  placeholder,
  disabled = false,
  onChange,
}: SpineTitleFieldProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const missing = value === null;
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="text-xs font-medium text-foreground">
        책등 제목 (세로쓰기)
      </label>
      <input
        id={id}
        type="text"
        value={value ?? ""}
        placeholder={placeholder}
        maxLength={60}
        disabled={disabled || missing}
        aria-describedby={hintId}
        onChange={(e) => onChange(e.target.value)}
        className="min-h-11 w-full rounded-md border border-input bg-background px-3 text-sm placeholder:text-muted-foreground/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
      />
      <p id={hintId} className="text-[11px] leading-snug text-muted-foreground">
        {missing
          ? "책등 텍스트가 없어요. 아래 ‘책등 텍스트 추가’로 만들 수 있어요."
          : "비워 두면 책등에 아무것도 인쇄되지 않아요."}
      </p>
    </div>
  );
}

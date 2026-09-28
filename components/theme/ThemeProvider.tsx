"use client";

import * as React from "react";

/**
 * 라이트/다크/시스템 테마를 관리하는 단순 Context.
 *
 * - localStorage(`theme`) 기반 영속화 (값: "light" | "dark" | "system")
 * - prefers-color-scheme 미디어 쿼리 구독 (system 일 때만 반응)
 * - `<html class="dark">` 토글
 *
 * 깜빡임 방지 inline 스크립트는 `app/layout.tsx` 가 직접 head 에 주입한다.
 */

export type Theme = "light" | "dark" | "system";

interface ThemeContextValue {
  theme: Theme;
  resolvedTheme: "light" | "dark";
  setTheme: (theme: Theme) => void;
}

const ThemeContext = React.createContext<ThemeContextValue | undefined>(
  undefined,
);

const STORAGE_KEY = "theme";

function readStoredTheme(): Theme {
  if (typeof window === "undefined") return "system";
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    if (v === "light" || v === "dark" || v === "system") return v;
  } catch {
    // ignore
  }
  return "system";
}

function systemPrefersDark(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function applyTheme(theme: Theme): "light" | "dark" {
  // 다크모드 재활성 — 직접 토큰(ink/paper/canvas/soft-cloud/hairline)이
  // CSS 변수 기반으로 라이트/다크 자동 반전되도록 globals.css 에서 정의됨.
  const resolved: "light" | "dark" =
    theme === "system" ? (systemPrefersDark() ? "dark" : "light") : theme;
  const root = document.documentElement;
  root.classList.toggle("dark", resolved === "dark");
  root.style.colorScheme = resolved;
  return resolved;
}

function subscribeNoop(): () => void {
  return () => {};
}

function subscribeSystemTheme(onChange: () => void): () => void {
  const mql = window.matchMedia("(prefers-color-scheme: dark)");
  mql.addEventListener("change", onChange);
  return () => mql.removeEventListener("change", onChange);
}

function getServerStoredTheme(): Theme {
  return "system";
}

function getServerSystemDark(): boolean {
  return false;
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // 저장값·OS 설정은 외부 저장소 — 서버/hydration 은 기본값("system"/light),
  // 이후 클라이언트 실제 값(예전 마운트 effect 의 setState 와 같은 시점 차이).
  const storedTheme = React.useSyncExternalStore(
    subscribeNoop,
    readStoredTheme,
    getServerStoredTheme,
  );
  const systemDark = React.useSyncExternalStore(
    subscribeSystemTheme,
    systemPrefersDark,
    getServerSystemDark,
  );
  // 이 마운트에서 사용자가 고른 값 — 저장 실패(localStorage 불가)여도 반영되게 따로 둔다.
  const [chosenTheme, setChosenTheme] = React.useState<Theme | null>(null);
  const theme = chosenTheme ?? storedTheme;
  const resolvedTheme: "light" | "dark" =
    theme === "system" ? (systemDark ? "dark" : "light") : theme;

  // `<html class="dark">` 적용(마운트 시 + 선택·OS 설정 변경 시). hydration 첫 커밋에서는
  // 렌더 값이 아직 서버 기본값일 수 있어, 렌더 값 대신 저장소를 직접 읽어 적용한다.
  React.useEffect(() => {
    applyTheme(chosenTheme ?? readStoredTheme());
  }, [chosenTheme, systemDark]);

  const setTheme = React.useCallback((next: Theme) => {
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // ignore
    }
    setChosenTheme(next);
    applyTheme(next);
  }, []);

  const value = React.useMemo<ThemeContextValue>(
    () => ({ theme, resolvedTheme, setTheme }),
    [theme, resolvedTheme, setTheme],
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = React.useContext(ThemeContext);
  if (!ctx) {
    // SSR 안전 — 렌더 단계에서 호출되더라도 기본값 반환.
    return {
      theme: "system",
      resolvedTheme: "light",
      setTheme: () => {
        /* no-op */
      },
    };
  }
  return ctx;
}

/**
 * `<head>` 에 inline 으로 주입할 스크립트 — hydration 전에 즉시 클래스 적용해
 * FOUC(깜빡임)를 방지한다. localStorage / matchMedia 동기 호출 외 부수효과 없음.
 */
// `<head>` inline — hydration 전 즉시 테마 적용해 FOUC 방지.
export const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem("theme");if(t!=="light"&&t!=="dark"&&t!=="system")t="system";var d=t==="dark"||(t==="system"&&matchMedia("(prefers-color-scheme: dark)").matches);var r=document.documentElement;if(d)r.classList.add("dark");r.style.colorScheme=d?"dark":"light";}catch(e){}})();`;

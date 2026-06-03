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

function applyTheme(theme: Theme): "light" | "dark" {
  // ⚠️ 다크모드 임시 비활성 — 라이트 고정.
  //   현재 다수 화면이 고정색(ink/soft-cloud/hairline/bg-white)을 직접 사용해
  //   .dark 가 붙으면 일부만 반전되어 화면이 깨지고, ThemeToggle 도 헤더에
  //   마운트되지 않아 되돌릴 수단이 없다. 깨짐 원천 차단을 위해 항상 라이트 적용.
  //   (globals.css 의 .dark 토큰은 보존 — 추후 고정색 토큰화 후 강제만 풀면 재활성.)
  void theme;
  const root = document.documentElement;
  root.classList.remove("dark");
  root.style.colorScheme = "light";
  return "light";
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = React.useState<Theme>("system");
  const [resolvedTheme, setResolvedTheme] = React.useState<"light" | "dark">(
    "light",
  );

  // 마운트 시 저장값 로드 + 즉시 적용
  React.useEffect(() => {
    const t = readStoredTheme();
    setThemeState(t);
    setResolvedTheme(applyTheme(t));
  }, []);

  // system 모드일 때 OS 테마 변경 구독
  React.useEffect(() => {
    if (theme !== "system") return;
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => {
      setResolvedTheme(applyTheme("system"));
    };
    mql.addEventListener("change", handler);
    return () => {
      mql.removeEventListener("change", handler);
    };
  }, [theme]);

  const setTheme = React.useCallback((next: Theme) => {
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // ignore
    }
    setThemeState(next);
    setResolvedTheme(applyTheme(next));
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
// ⚠️ 다크모드 임시 비활성 — 라이트 고정 (ThemeProvider.applyTheme 주석 참조).
//   .dark 가 붙지 않도록 항상 라이트로 초기화해 FOUC + 다크 깨짐을 동시에 차단.
export const THEME_INIT_SCRIPT = `(function(){try{var r=document.documentElement;r.classList.remove("dark");r.style.colorScheme="light";}catch(e){}})();`;

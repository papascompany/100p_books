"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * SSR-safe matchMedia hook.
 * Returns `false` on the server and during hydration to avoid mismatch.
 * (클라이언트 이후 렌더는 실제 matchMedia 값을 구독한다 — useSyncExternalStore.)
 *
 * @example
 *   const isMobile = useMediaQuery("(max-width: 768px)");
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const mql = window.matchMedia(query);
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    },
    [query],
  );
  const getSnapshot = useCallback(
    () => window.matchMedia(query).matches,
    [query],
  );
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

function getServerSnapshot(): boolean {
  return false;
}

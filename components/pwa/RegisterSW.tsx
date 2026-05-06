"use client";

import { useEffect } from "react";

/**
 * Service Worker 등록 컴포넌트.
 * 렌더 결과물 없음 — layout.tsx 하단에 삽입.
 */
export default function RegisterSW() {
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker
        .register("/sw.js", { scope: "/" })
        .catch((err) => {
          // SW 등록 실패는 사용자 경험에 치명적이지 않으므로 에러만 기록
          console.error("[SW] registration failed:", err);
        });
    }
  }, []);

  return null;
}

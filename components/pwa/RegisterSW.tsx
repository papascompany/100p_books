"use client";

import { useEffect } from "react";

/**
 * Service Worker 등록 컴포넌트.
 * 렌더 결과물 없음 — layout.tsx 하단에 삽입.
 */
export default function RegisterSW() {
  useEffect(() => {
    // 개발 모드에서는 SW 를 등록하지 않는다.
    //   - dev 는 청크가 매번 바뀌어 SW 캐시가 옛 번들을 서빙 → 빈 화면/불일치 유발.
    //   - 이전에 등록된 dev SW 가 있으면 정리한다.
    if (process.env.NODE_ENV !== "production") {
      if ("serviceWorker" in navigator) {
        navigator.serviceWorker
          .getRegistrations()
          .then((regs) => regs.forEach((r) => void r.unregister()))
          .catch(() => undefined);
      }
      return;
    }

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

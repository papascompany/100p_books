/* eslint-disable */
// @ts-nocheck
/**
 * Service Worker — 100p Books
 *
 * Cache strategy:
 *  - /_next/static/*  : cache-first (불변 해시 파일)
 *  - 공개 페이지       : stale-while-revalidate (즉시 표시 + 백그라운드 갱신)
 *                       /, /gallery, /terms, /privacy, /refund, /upload, /login, /offline
 *  - 보호 페이지       : network-first (인증 상태 stale 방지 — /mypage/*, /admin/*,
 *                       /editor/*, /cover/*, /order/*), 실패 시 /offline 폴백
 *  - /api/*           : 항상 네트워크 (캐시 없음)
 *
 * v2 — SWR 도입 (페이지 재방문 시 즉시 표시).
 */

const CACHE_NAME = "100p-v2";
const STATIC_ASSETS = ["/", "/offline"];

/**
 * SWR 허용 경로 — 비로그인에서도 동일 HTML 인 공개 페이지만.
 * 인증/사용자별 페이지는 stale 데이터 노출 위험이 있어 제외.
 */
const SWR_PATTERNS = [
  /^\/$/,
  /^\/gallery(\/.*)?$/,
  /^\/terms\/?$/,
  /^\/privacy\/?$/,
  /^\/refund\/?$/,
  /^\/offline\/?$/,
];

function isSwrEligible(pathname) {
  return SWR_PATTERNS.some((re) => re.test(pathname));
}

// ── install ──────────────────────────────────────────────────────────────────
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting())
  );
});

// ── activate ─────────────────────────────────────────────────────────────────
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k !== CACHE_NAME)
            .map((k) => caches.delete(k))
        )
      )
      .then(() => self.clients.claim())
  );
});

// ── fetch ─────────────────────────────────────────────────────────────────────
self.addEventListener("fetch", (event) => {
  const { request } = event;

  // POST 등 non-GET 요청은 무조건 네트워크
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // API 요청: 항상 네트워크 (캐시 불개입)
  if (url.pathname.startsWith("/api/")) return;

  // _next/static: cache-first (빌드 해시 고정 파일)
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ||
          fetch(request).then((res) => {
            const clone = res.clone();
            caches.open(CACHE_NAME).then((c) => c.put(request, clone));
            return res;
          })
      )
    );
    return;
  }

  // 페이지 내비게이션
  if (request.mode === "navigate") {
    const path = url.pathname;

    if (isSwrEligible(path)) {
      // Stale-While-Revalidate: 캐시 즉시 반환 + 백그라운드 refetch.
      // 사용자가 같은 페이지 재방문 시 즉시 표시되어 체감 속도 향상.
      event.respondWith(
        caches.open(CACHE_NAME).then(async (cache) => {
          const cached = await cache.match(request);
          const networkPromise = fetch(request)
            .then((res) => {
              if (res && res.ok) cache.put(request, res.clone());
              return res;
            })
            .catch(() => null);

          if (cached) {
            // 캐시 즉시 반환, 네트워크는 백그라운드에서만 (waitUntil).
            event.waitUntil(networkPromise);
            return cached;
          }
          // 캐시 없음 → 네트워크 결과 그대로, 실패 시 offline 폴백.
          const fresh = await networkPromise;
          if (fresh) return fresh;
          const offline = await cache.match("/offline");
          return offline ?? Response.error();
        }),
      );
      return;
    }

    // 보호/사용자별 페이지는 기존 network-first 유지 (stale 인증 데이터 방지).
    event.respondWith(
      fetch(request).catch(() =>
        caches
          .match("/offline")
          .then((cached) => cached ?? Response.error()),
      ),
    );
  }
});

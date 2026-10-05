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
 * v3 — Next 16 전환. 빌드 산출물(청크 해시·RSC payload)이 전부 바뀌므로 캐시 이름을 올려
 *      activate 단계에서 구버전 캐시를 폐기한다. 올리지 않으면 기존 방문자가 14 시절
 *      precache 한 셸과 새 서버 응답이 섞인다.
 */

// v4 (2026-10-05): _next/static 핸들러가 비-2xx 응답(Vercel Security Checkpoint 403 HTML 등)까지
// 캐시하던 결함을 고치면서, 그 사이 오염됐을 수 있는 캐시를 통째로 버린다.
const CACHE_NAME = "100p-v4";
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
            // 2xx 이고 HTML 이 아닐 때만 캐시한다. 운영 실측(2026-10-05): Vercel 방화벽 챌린지가
            // 청크 요청에 403 "Security Checkpoint" HTML 을 돌려줬고, 그것이 불변 URL 에 캐시되면
            // 이후 모든 로드에서 스크립트 대신 HTML 이 실행돼 앱이 깨진다(SW 버전 bump 전까지 영구).
            const type = res.headers.get("content-type") || "";
            if (res.ok && !/text\/html/i.test(type)) {
              const clone = res.clone();
              caches.open(CACHE_NAME).then((c) => c.put(request, clone));
            }
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

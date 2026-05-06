/* eslint-disable */
// @ts-nocheck
/**
 * Service Worker — 100p Books
 * Cache strategy:
 *  - /_next/static/*  : cache-first (불변 해시 파일)
 *  - navigate         : network-first, 실패 시 /offline 폴백
 *  - /api/*           : 항상 네트워크 (캐시 없음)
 */

const CACHE_NAME = "100p-v1";
const STATIC_ASSETS = ["/", "/offline"];

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

  // 페이지 내비게이션: network-first, 실패 시 /offline 폴백
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(() =>
        caches
          .match("/offline")
          .then((cached) => cached ?? Response.error())
      )
    );
  }
});

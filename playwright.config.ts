import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright E2E 설정.
 *
 *   - e2e/ 디렉터리의 *.spec.ts 만 실행.
 *   - vitest 와 충돌 방지: vitest 는 e2e/ 디렉터리를 exclude 한다 (vitest.config.ts).
 *   - 기본 baseURL 은 로컬 개발 서버. PLAYWRIGHT_BASE_URL 로 운영/스테이징 가능.
 *   - 모바일 viewport(iPhone 13) + 데스크톱 둘 다 실행 — 100p_books 는 모바일 우선.
 */
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";

export default defineConfig({
  testDir: "./e2e",
  testMatch: /.*\.spec\.ts$/,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium-desktop",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      // iPhone 13 viewport + UA. Playwright 의 "iPhone 13" 디바이스는 webkit 기반이지만
      // CI 부담을 줄이기 위해 chromium 으로 실행한다 (실제 모바일 Safari 호환성은 별도 검증).
      name: "mobile-chromium",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 3,
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
  // 로컬에서는 webServer 가 dev 를 자동 띄움. PLAYWRIGHT_BASE_URL 지정 시 비활성.
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : {
        command: "pnpm dev --port 3000",
        url: "http://localhost:3000",
        reuseExistingServer: true,
        timeout: 120_000,
      },
});

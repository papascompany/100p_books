import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    // jsdom 으로 통일 — fabric.js / DOM 의존 테스트와 노드 단위 테스트(레이아웃 엔진 등) 모두 동작.
    // 레이아웃 엔진 테스트는 DOM 을 만지지 않으므로 환경 차이 영향 없음.
    environment: "jsdom",
    globals: true,
    include: ["**/*.{test,spec}.{ts,tsx}"],
    exclude: ["**/node_modules/**", "**/.next/**", "**/e2e/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      exclude: ["**/node_modules/**", "**/.next/**", "**/*.config.*"],
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./"),
      // vitest 는 React Server Components 그래프를 모르므로 server-only import 가 throw.
      // 테스트 환경에서만 빈 stub 으로 대체 — 운영 빌드(next/webpack) 동작에는 영향 없음.
      "server-only": path.resolve(__dirname, "./tests/mocks/server-only.ts"),
    },
  },
});

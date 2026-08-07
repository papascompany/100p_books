/**
 * playwright.config.ts 와 auth.setup.ts 가 같은 파일을 가리키게 하는 단일 정본.
 * 레포 루트 기준 상대 경로 — Playwright 는 항상 프로젝트 루트에서 실행된다.
 */
export const AUTH_STATE_PATH = "e2e/.auth/user.json";

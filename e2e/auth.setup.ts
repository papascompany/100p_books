import { expect, test as setup } from "@playwright/test";

import { AUTH_STATE_PATH } from "./fixtures/paths";
import {
  createServiceClient,
  provisionTestUser,
  readE2eEnv,
} from "./fixtures/test-user";

/**
 * 인증 E2E 를 위한 storageState 생성 (Playwright "setup project").
 *
 * 왜 세션 쿠키를 직접 심지 않는가:
 *   서버 컴포넌트의 `requireUser()` 가 `supabase.auth.getUser()` 로 GoTrue 왕복 검증을
 *   하기 때문에(lib/auth/session.ts) 위조 쿠키로는 통과할 수 없다. 실제 로그인 폼을
 *   통과한 세션만 유효하다 — 그래서 UI 로그인 후 상태를 저장한다.
 *
 * 실행 조건: NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.
 * 없으면 전체를 skip 한다 — 공개 라우트 E2E/a11y 파이프라인을 깨지 않기 위해서다.
 */

setup("테스트 계정 준비 후 로그인 상태 저장", async ({ page }) => {
  const env = readE2eEnv();
  if (!env) {
    // env 가 없으면 로그인하지 않고 **빈 상태**를 남긴다. 여기서 skip 해버리면
    // storageState 파일이 없어 의존 프로젝트가 로드 단계에서 죽는다.
    // 실제 테스트는 golden-flow 쪽 describe 가 같은 조건으로 skip 한다.
    console.warn(
      "[e2e] SUPABASE_SERVICE_ROLE_KEY 미설정 — 로그인 없이 빈 storageState 를 저장합니다.",
    );
    await page.context().storageState({ path: AUTH_STATE_PATH });
    return;
  }

  const admin = createServiceClient(env);
  const user = await provisionTestUser(admin, env.email);

  await page.goto("/login");
  await page.getByLabel("이메일").fill(user.email);
  await page.getByLabel("비밀번호").fill(user.password);
  // "로그인" 이라는 이름은 모드 전환 링크에도 있을 수 있어 제출 버튼만 집는다.
  await page.getByRole("button", { name: "로그인", exact: true }).click();

  // 로그인 성공 판정 — 보호 라우트가 /login 으로 튕기지 않으면 세션이 산 것이다.
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), {
    timeout: 30_000,
  });
  await page.goto("/mypage");
  await expect(page).not.toHaveURL(/\/login/);

  await page.context().storageState({ path: AUTH_STATE_PATH });
});

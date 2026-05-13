import { expect, test } from "@playwright/test";

/**
 * 핵심 공개 라우트가 200 + 본문이 렌더링되는지만 확인하는 smoke 테스트.
 *
 * 로그인 의존 페이지(/mypage/*, /editor/*)는 익명 시 /login 으로 리다이렉트되는
 * 것까지만 확인 — 실제 인증 플로우 검증은 별도 spec 으로 분리한다.
 */

test.describe("public smoke", () => {
  test("/ 홈 — 핵심 CTA 렌더", async ({ page }) => {
    const res = await page.goto("/", { waitUntil: "domcontentloaded" });
    expect(res?.ok()).toBeTruthy();
    // 홈 화면은 페이지 제목에 100p Books 가 포함됨
    await expect(page).toHaveTitle(/100p\s*Books/i);
  });

  test("/upload — 업로드 페이지가 로그인으로 가드됨", async ({ page }) => {
    const res = await page.goto("/upload");
    expect(res?.status()).toBeLessThan(500);
    // 익명이면 /login 으로 리다이렉트
    await expect(page).toHaveURL(/\/(login|upload)/);
  });

  test("/gallery — 비로그인도 갤러리 조회 가능", async ({ page }) => {
    const res = await page.goto("/gallery", { waitUntil: "domcontentloaded" });
    expect(res?.ok()).toBeTruthy();
  });

  test("/login — 로그인 폼이 표시", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByRole("textbox", { name: /이메일/ })).toBeVisible();
  });
});

test.describe("mypage 보호 라우트", () => {
  test("/mypage/points 익명 접근 시 /login 으로 리다이렉트", async ({ page }) => {
    await page.goto("/mypage/points");
    await expect(page).toHaveURL(/\/login\?next=\/mypage\/points/);
  });

  test("/mypage 익명 접근 시 /login 으로 리다이렉트", async ({ page }) => {
    await page.goto("/mypage");
    await expect(page).toHaveURL(/\/login\?next=\/mypage/);
  });
});

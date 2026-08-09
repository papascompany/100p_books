import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

/**
 * WCAG 2.1 AA 접근성 감사 (axe-core).
 *
 *   pnpm test:a11y
 *
 * 범위: 익명으로 접근 가능한 라우트 전부 + 주요 인터랙션 상태(모바일 드로어, 로그인 모드 전환).
 * 로그인 이후 화면(에디터·주문·마이페이지)은 인증 픽스처가 필요해 별도 spec 으로 분리한다.
 *
 * 규칙: playwright.config.ts 의 두 프로젝트(desktop / mobile 390px)에서 각각 실행되므로
 * 반응형 분기에서만 나타나는 위반도 잡힌다.
 *
 * 위반이 발견되면 리포트에 rule id / impact / 해당 셀렉터를 모두 출력한다.
 */

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

/**
 * 서드파티가 주입해 우리가 고칠 수 없는 영역은 제외한다.
 * (현재는 없음 — 토스 결제 위젯·다음 우편번호는 익명 공개 라우트에 없다.)
 */
const EXCLUDE_SELECTORS: string[] = [];

async function analyze(page: Page) {
  let builder = new AxeBuilder({ page }).withTags(WCAG_TAGS);
  for (const sel of EXCLUDE_SELECTORS) builder = builder.exclude(sel);
  return builder.analyze();
}

/** 위반을 사람이 읽을 수 있는 형태로 — 실패 메시지에서 바로 고칠 수 있게. */
function format(violations: Awaited<ReturnType<typeof analyze>>["violations"]) {
  return violations
    .map((v) => {
      const targets = v.nodes
        .slice(0, 5)
        .map((n) => `      - ${n.target.join(" ")}`)
        .join("\n");
      const more =
        v.nodes.length > 5 ? `\n      … 외 ${v.nodes.length - 5}건` : "";
      return `  [${v.impact ?? "unknown"}] ${v.id} — ${v.help}\n${targets}${more}\n      ${v.helpUrl}`;
    })
    .join("\n\n");
}

async function expectNoViolations(page: Page, label: string) {
  const { violations } = await analyze(page);
  // 규칙 id 배열로 비교한다 — axe 결과 객체를 그대로 비교하면 실패 diff 가
  // 수백 줄 JSON 으로 쏟아져 정작 무엇을 고쳐야 할지 안 보인다.
  // 사람이 읽을 상세는 메시지에 담는다.
  const ids = violations.map((v) => v.id);
  expect(
    ids,
    violations.length > 0
      ? `${label} — WCAG 2.1 AA 위반 ${violations.length}건\n\n${format(violations)}\n`
      : "",
  ).toEqual([]);
}

/** 익명 접근 가능한 공개 라우트. */
const PUBLIC_ROUTES: Array<{ path: string; label: string }> = [
  { path: "/", label: "홈" },
  { path: "/login", label: "로그인" },
  { path: "/gallery", label: "후기 갤러리" },
  { path: "/terms", label: "이용약관" },
  { path: "/privacy", label: "개인정보처리방침" },
  { path: "/refund", label: "교환·환불" },
  { path: "/offline", label: "오프라인" },
];

/**
 * 색 대비를 재기 전에 화면을 안정시킨다.
 *
 * 고정 대기(600ms)로는 부족하다 — 웹폰트가 늦게 스왑되면 그만큼 진입 애니메이션도 밀려서,
 * `animate-fade-up` 이 opacity 1 에 도달하기 전에 axe 가 측정한다. 전환 중 텍스트는 실효
 * 대비가 낮게 계산돼 통과/실패가 실행마다 뒤집힌다(폰트를 3단 분할한 뒤 실제로 관측됨).
 * 그래서 시간이 아니라 **상태**를 기다린다.
 */
async function settle(page: Page): Promise<void> {
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await page.waitForFunction(
    () =>
      Array.from(document.querySelectorAll<HTMLElement>('[class*="animate-"]')).every(
        (el) => getComputedStyle(el).opacity === "1",
      ),
    undefined,
    { timeout: 10_000 },
  );
}

test.describe("WCAG 2.1 AA — 공개 라우트", () => {
  for (const route of PUBLIC_ROUTES) {
    test(`${route.path} (${route.label})`, async ({ page }) => {
      await page.goto(route.path, { waitUntil: "domcontentloaded" });
      await settle(page);
      await expectNoViolations(page, `${route.path} ${route.label}`);
    });
  }
});

/**
 * 하이드레이션 완료 전 클릭은 아무 상태도 바꾸지 못한다(서버 HTML 에 버튼은 이미 있다).
 * 기대 상태가 나타날 때까지 클릭을 재시도해 이 경합을 없앤다.
 */
async function clickUntil(
  trigger: () => Promise<void>,
  expectation: () => Promise<void>,
) {
  await expect(async () => {
    await trigger();
    await expectation();
  }).toPass({ timeout: 15_000 });
}

test.describe("WCAG 2.1 AA — 인터랙션 상태", () => {
  test("모바일 내비 드로어 열림 상태", async ({ page, isMobile }) => {
    test.skip(!isMobile, "드로어는 모바일 뷰포트 전용");
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await settle(page);
    await clickUntil(
      () => page.getByRole("button", { name: "메뉴 열기" }).click(),
      () => expect(page.locator("#mobile-nav")).toBeVisible({ timeout: 2000 }),
    );
    // 드로어 자체의 슬라이드-인이 끝난 뒤 재야 한다 — 전환 중이면 실효 대비가 낮게 잡힌다.
    await settle(page);
    await expectNoViolations(page, "모바일 드로어 열림");
  });

  test("로그인 — 회원가입 모드 전환", async ({ page }) => {
    await page.goto("/login", { waitUntil: "domcontentloaded" });
    // "회원가입"은 모드 전환 버튼과 제출 버튼 두 곳에 있다 — 전환 링크만 집는다.
    await clickUntil(
      () =>
        page
          .getByRole("button", { name: "회원가입", exact: true })
          .first()
          .click(),
      // 가입 모드에서만 약관 동의 체크박스가 나타난다.
      () => expect(page.getByRole("checkbox")).toBeVisible({ timeout: 2000 }),
    );
    await expectNoViolations(page, "로그인(가입 모드)");
  });

  test("갤러리 — 인기순 탭", async ({ page }) => {
    await page.goto("/gallery", { waitUntil: "domcontentloaded" });
    // 정렬 전환은 role="tab" (버튼 role 아님).
    const tab = page.getByRole("tab", { name: "인기순" });
    await clickUntil(
      () => tab.click(),
      () => expect(tab).toHaveAttribute("aria-selected", "true", { timeout: 2000 }),
    );
    await page.waitForTimeout(400);
    await expectNoViolations(page, "갤러리(인기순)");
  });
});

test.describe("WCAG 2.1 AA — 다크 모드", () => {
  test.use({ colorScheme: "dark" });

  for (const route of [
    { path: "/", label: "홈" },
    { path: "/login", label: "로그인" },
    { path: "/gallery", label: "후기 갤러리" },
  ]) {
    test(`${route.path} (${route.label}) 다크`, async ({ page }) => {
      await page.goto(route.path, { waitUntil: "domcontentloaded" });
      await settle(page);
      await expectNoViolations(page, `${route.path} ${route.label} (다크)`);
    });
  }
});

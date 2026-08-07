import path from "node:path";

import { expect, test } from "@playwright/test";

import {
  cleanupProjects,
  createServiceClient,
  provisionTestUser,
  readE2eEnv,
} from "./fixtures/test-user";

/**
 * 인증 사용자 골든 플로우 — 업로드 → 내지 자동 편집 → 표지 저장 → 주문서 작성.
 *
 * 범위와 경계:
 *   - **결제창은 절대 열지 않는다.** 마지막 단언은 "결제하기" 버튼이 enabled 가 되는
 *     것까지다. 그 버튼을 누르면 `/api/orders/create` 가 orders 행을 만들고
 *     (app/(user)/order/[projectId]/OrderForm.tsx:449) 곧바로 Toss SDK 로 전체
 *     리다이렉트되므로(:510-527), 누르지 않는 것이 유일하게 안전한 경계다.
 *   - desktop 프로젝트에서만 돈다. 모바일(≤768px)에서는 Dropzone 의
 *     `<input type="file">` 이 DOM 에서 언마운트되고 바텀시트 안으로 들어가기 때문에
 *     (app/(user)/upload/components/Dropzone.tsx:128-139) 업로드 주입 경로가 다르다.
 *   - 운영 Supabase 를 그대로 쓰는 구성이라, 테스트가 만든 프로젝트·사진·스토리지
 *     오브젝트를 afterAll 에서 반드시 지운다.
 *
 * 실행: `pnpm e2e:auth` (SUPABASE_SERVICE_ROLE_KEY 필요, 없으면 skip)
 */

const PHOTOS = [
  path.join(__dirname, "fixtures", "photos", "sample-1.jpg"),
  path.join(__dirname, "fixtures", "photos", "sample-2.jpg"),
  path.join(__dirname, "fixtures", "photos", "sample-3.jpg"),
];

const env = readE2eEnv();

test.describe("인증 골든 플로우 — 업로드→편집→표지→주문", () => {
  test.skip(!env, "SUPABASE_SERVICE_ROLE_KEY 미설정 — 인증 E2E 를 건너뜁니다.");
  // 업로드(서명·PUT·sharp 처리)와 레이아웃 생성이 있어 기본 타임아웃으로는 부족하다.
  test.setTimeout(180_000);

  test.afterAll(async () => {
    if (!env) return;
    const admin = createServiceClient(env);
    const user = await provisionTestUser(admin, env.email);
    const result = await cleanupProjects(admin, user.userId);
    // 정리 결과는 CI 로그에서 확인할 수 있어야 한다(누적 오염 조기 발견).
    console.log(
      `[e2e cleanup] 프로젝트 ${result.projects}건 / 스토리지 ${result.storageObjects}개 삭제`,
    );
  });

  test("사진 업로드부터 결제 직전까지 이어진다", async ({ page }) => {
    // 실패 진단용 — 업로드는 서명 발급 → R2 PUT → complete 로 이어지는 다단계라
    // 어느 단계가 죽었는지 페이지 스냅샷만으로는 알 수 없다. 실패한 API 와 페이지 예외만
    // 로그로 끌어올린다(성공 시에는 아무것도 출력되지 않는다).
    page.on("pageerror", (e) => console.log(`[pageerror] ${e.message}`));
    page.on("response", (r) => {
      if (r.url().includes("/api/") && !r.ok()) {
        console.log(`[api ${r.status()}] ${r.request().method()} ${r.url()}`);
      }
    });

    // ── 1. /upload 진입 — 서버가 draft 프로젝트를 만들고 ?projectId= 로 리다이렉트한다.
    await page.goto("/upload", { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/\/upload\?projectId=[0-9a-f-]{36}/);
    const projectId = new URL(page.url()).searchParams.get("projectId");
    expect(projectId).toBeTruthy();

    // ── 2. 사진 3장 추가 — **드롭존 클릭 → filechooser** 경로를 쓴다.
    //
    // 숨은 input 에 setInputFiles 로 직접 주입하면 안 된다. 실측 결과 파일은 들어가는데
    // (input.files=3) Dropzone 의 onChange 가 실행되지 않아(`e.target.value=""` 리셋조차
    // 일어나지 않음) 큐가 비어 있는 채로 남는다 — 하이드레이션 타이밍에 따라 통과/실패가
    // 갈리는 flaky 의 원인이었다.
    //
    // 드롭존 클릭 경로는 React onClick 이 `inputRef.current.click()` 을 호출해야만
    // filechooser 가 열리므로, "핸들러가 붙었는가"를 기다리는 일과 파일 선택이 한 번에
    // 해결된다. 재시도로 감싸 하이드레이션 지연을 흡수한다.
    const dropzone = page.getByRole("button", {
      name: "사진을 끌어다 놓거나 클릭하여 선택",
    });
    await expect(dropzone).toBeVisible();
    const progress = page.getByRole("region", { name: "업로드 진행 상황" });
    await expect(async () => {
      if (await progress.isVisible()) return;
      const chooser = page.waitForEvent("filechooser", { timeout: 5_000 });
      await dropzone.click();
      await (await chooser).setFiles(PHOTOS);
      await expect(progress).toBeVisible({ timeout: 5_000 });
    }).toPass({ timeout: 60_000 });

    // ── 3. 업로드 완료 판정 — 완료 전에는 "다음" 이 <span> 이고, 전부 done 이 되어야
    //      <Link> 로 바뀐다(UploadClient.tsx:385-402). 즉 link 의 등장이 곧 완료 신호다.
    const nextLink = page.getByRole("link", { name: /다음/ });
    await expect(nextLink).toBeVisible({ timeout: 120_000 });

    // ── 4. 내지 자동 편집 — pages 행이 생겨야 주문 단계가 열린다.
    await nextLink.click();
    await expect(page).toHaveURL(new RegExp(`/editor/${projectId}`));
    await page.getByRole("button", { name: "자동 편집하기" }).click();

    // 페이지가 생성되면 TopBar 의 주문 CTA 가 disabled 버튼에서 링크로 바뀐다
    // (TopBar.tsx:121-134 — pageCount === 0 이면 비활성 버튼).
    const orderLink = page.getByRole("link", { name: "주문 단계로 이동" });
    await expect(orderLink).toBeVisible({ timeout: 60_000 });

    // ── 5. 표지 저장 — order 페이지 게이트가 cover_json 을 요구한다
    //      (order/[projectId]/page.tsx:70-103).
    await page.getByRole("link", { name: "표지 편집으로 이동" }).click();
    await expect(page).toHaveURL(new RegExp(`/cover/${projectId}`));
    // 저장 완료 판정은 **응답**으로 한다. 이유 두 가지:
    //   ① 버튼 라벨("저장"/"저장됨")은 dirty 를 그대로 비추는데, save() 가 setCurrentDoc 으로
    //      캔버스를 갱신하면 FabricStage 의 onModified 가 다시 발화해 dirty 가 되살아난다.
    //   ② Fabric 캔버스가 준비되기 전에 누르면 serializeLive() 가 null 이라 save() 가
    //      요청도 없이 조용히 끝난다 — 클릭 성공이 저장 성공이 아니다.
    // 그래서 캔버스가 뜬 뒤에 누르고, 눌리지 않더라도 자동저장(dirty=true 로 시작 +
    // 5초 debounce)이 같은 PATCH 를 보내므로 응답만 기다리면 된다.
    // ⚠️ Fabric 캔버스가 뜬 것과 준비된 것은 다르다. 준비 전에 누르면 serializeLive() 가
    //    null 이라 save() 가 요청 없이 끝나고, 자동저장 useEffect 는 dirty 가 그대로여서
    //    다시 돌지 않는다 — 한 번 헛치면 저장이 영영 안 나간다(2026-08-07 실측).
    //    그래서 PATCH 응답이 실제로 올 때까지 저장을 다시 시도한다.
    await expect(page.locator("canvas").first()).toBeVisible({ timeout: 60_000 });
    await expect(async () => {
      const saved = page.waitForResponse(
        (res) =>
          res.url().includes("/api/cover") &&
          res.request().method() === "PATCH" &&
          res.ok(),
        { timeout: 8_000 },
      );
      await page
        .getByRole("button", { name: "저장", exact: true })
        .click({ timeout: 5_000 })
        .catch(() => {
          // 이미 자동저장이 끝나 라벨이 "저장됨" 이면 클릭 대상이 없다 — 응답으로 판정.
        });
      await saved;
    }).toPass({ timeout: 120_000 });

    // ── 6. 주문서 — "다음: 주문" 은 링크가 아니라 router.push 하는 버튼이다.
    await page.getByRole("button", { name: "다음: 주문" }).click();
    await expect(page).toHaveURL(new RegExp(`/order/${projectId}`));
    // 게이트를 통과하지 못하면 "주문 준비 중" 안내만 렌더된다 — 폼 존재로 판정.
    await expect(page.getByLabel("받는 분 *")).toBeVisible({ timeout: 30_000 });

    await page.getByLabel("받는 분 *").fill("이오이 테스트");
    await page.getByLabel("전화번호 *").fill("010-1234-5678");
    await page.getByLabel("우편번호 *").fill("06236");
    await page.getByLabel("주소 *").fill("서울특별시 강남구 테헤란로 1");
    await page.locator("#addr2-input").fill("101동 1001호");

    // 약관 3종 — Agree 컴포넌트가 label 로 감싼 체크박스(OrderForm.tsx:1013-1044).
    const agreements = page.getByRole("checkbox");
    const count = await agreements.count();
    for (let i = 0; i < count; i += 1) {
      const box = agreements.nth(i);
      if (!(await box.isChecked())) await box.check();
    }

    // ── 7. 경계: 버튼이 활성화되는 것까지만 확인하고 클릭하지 않는다.
    //      canSubmit = 주소 유효 + 약관 전체 동의 + 수량 ≥ 1 + 금액 ≥ 100원 (:432-438).
    const payButton = page.getByRole("button", { name: /결제하기$/ });
    await expect(payButton).toBeEnabled({ timeout: 15_000 });
  });
});

import path from "node:path";

import {
  expect,
  test,
  type BrowserContext,
  type Page,
  type Request,
} from "@playwright/test";

import {
  cleanupProjects,
  createServiceClient,
  provisionTestUser,
  readE2eEnv,
} from "./fixtures/test-user";

/**
 * 편집 무결성 회귀 E2E — 0f2b77d 에서 고친 결함이 다시 생기면 실패한다.
 *
 *   QA-1  텍스트 추가 → 되돌리기 → 자동저장이 페이지를 0객체로 덮어쓴다(화면엔 보임).
 *   QA-4  저장된 표지·내지에 들어가기만 해도 dirty → 불필요한 PATCH·이탈 경고.
 *   QA-2  표지 저장 → '← 내지 편집' → 곧바로 표지 복귀(링크/뒤로가기) 시 라우터 캐시의
 *         옛 표지가 로드되고, 그 뒤 자동저장이 최신 저장본을 덮어쓴다.
 *
 * 판정 원칙:
 *   - 저장 여부는 버튼 라벨이 아니라 **PATCH 요청 본문·응답**과 서버 GET 으로 본다.
 *     화면은 옳게 보이는데 저장본만 망가지는 것이 이 결함들의 공통점이다.
 *   - 파일 선택은 golden-flow 와 같은 드롭존 클릭 → filechooser 경로(숨은 input 직접 주입 금지).
 *
 * 격리:
 *   - golden-flow 와 **다른 테스트 계정**을 쓴다. 두 spec 은 서로 다른 worker 에서 동시에 돌 수
 *     있는데, 각 spec 의 afterAll 이 "계정의 모든 프로젝트" 를 지우므로 계정을 공유하면
 *     상대의 진행 중 프로젝트를 지운다. 그래서 storageState 도 쓰지 않고 직접 로그인한다.
 *   - 한 파일 안의 테스트는 순서대로(한 worker) 돈다 — 같은 프로젝트를 공유하기 때문이다.
 *   - 운영 Supabase 를 그대로 쓰므로 afterAll 에서 프로젝트·사진·스토리지를 지운다.
 *
 * 실행: `pnpm e2e:auth` (SUPABASE_SERVICE_ROLE_KEY 필요, 없으면 skip)
 */

const PHOTOS = [
  path.join(__dirname, "fixtures", "photos", "sample-1.jpg"),
  path.join(__dirname, "fixtures", "photos", "sample-2.jpg"),
  path.join(__dirname, "fixtures", "photos", "sample-3.jpg"),
];

/** golden-flow 계정과 겹치지 않는 고정 주소 — 실제 메일이 가지 않는 .test 도메인. */
const INTEGRITY_EMAIL = "e2e+editor-integrity@100pbooks.test";

/** 자동저장 debounce(5초) + 여유. 이 시간 동안 PATCH 가 없으면 "저장 시도 없음" 으로 본다. */
const AUTOSAVE_WINDOW_MS = 7_000;

const env = readE2eEnv();

interface PatchRecord {
  kind: "page" | "cover";
  url: string;
  /** 요청 본문 fabricJson.objects 길이. 본문 해석 실패 시 -1. */
  objects: number;
  status: number | null;
}

/** 에디터 저장 PATCH 를 본문 객체 수와 함께 기록한다. */
function recordEditorPatches(page: Page): PatchRecord[] {
  const records: PatchRecord[] = [];
  const byRequest = new Map<Request, PatchRecord>();
  page.on("request", (req) => {
    if (req.method() !== "PATCH") return;
    const url = req.url();
    const kind = /\/api\/pages\/[0-9a-f-]{36}(?:\?|$)/.test(url)
      ? "page"
      : /\/api\/cover(?:\?|$)/.test(url)
        ? "cover"
        : null;
    if (!kind) return;
    let objects = -1;
    try {
      const body = JSON.parse(req.postData() ?? "{}") as {
        fabricJson?: { objects?: unknown[] };
      };
      objects = Array.isArray(body.fabricJson?.objects)
        ? body.fabricJson.objects.length
        : -1;
    } catch {
      objects = -1;
    }
    const rec: PatchRecord = { kind, url, objects, status: null };
    records.push(rec);
    byRequest.set(req, rec);
  });
  page.on("requestfinished", async (req) => {
    const rec = byRequest.get(req);
    if (!rec) return;
    const res = await req.response().catch(() => null);
    rec.status = res?.status() ?? null;
  });
  page.on("requestfailed", (req) => {
    const rec = byRequest.get(req);
    if (rec) rec.status = 0;
  });
  return records;
}

/** 서버 저장본(GET) 기준 내지 객체 수. */
async function serverPageObjects(page: Page, pageId: string): Promise<number> {
  return page.evaluate(async (id) => {
    const res = await fetch(`/api/pages/${id}`, { cache: "no-store" });
    const json = (await res.json()) as {
      ok: boolean;
      data?: { fabricJson?: { objects?: unknown[] } | null };
    };
    if (!res.ok || !json.ok) throw new Error(`GET /api/pages/${id} ${res.status}`);
    return json.data?.fabricJson?.objects?.length ?? 0;
  }, pageId);
}

/** 서버 저장본(GET) 기준 표지 객체 수. isDefault 면 아직 저장본이 없다는 뜻이다. */
async function serverCover(
  page: Page,
  projectId: string,
): Promise<{ objects: number; isDefault: boolean }> {
  return page.evaluate(async (pid) => {
    const res = await fetch(`/api/cover?projectId=${pid}`, { cache: "no-store" });
    const json = (await res.json()) as {
      ok: boolean;
      data?: { coverJson?: { objects?: unknown[] }; isDefault?: boolean };
    };
    if (!res.ok || !json.ok) throw new Error(`GET /api/cover ${res.status}`);
    return {
      objects: json.data?.coverJson?.objects?.length ?? 0,
      isDefault: json.data?.isDefault ?? true,
    };
  }, projectId);
}

function screenshotPath(name: string): string {
  return path.join("tmp", "qa", "editor-integrity", `${name}.png`);
}

test.describe("편집 무결성 회귀 — 되돌리기 저장·진입 dirty·표지 왕복", () => {
  test.skip(!env, "SUPABASE_SERVICE_ROLE_KEY 미설정 — 인증 E2E 를 건너뜁니다.");
  // 세 테스트가 한 프로젝트를 공유한다 — 병렬로 돌면 beforeAll 이 worker 마다 프로젝트를 만들고
  // 서로의 afterAll 이 지운다. 순서 실행(default)은 앞 테스트가 실패해도 뒤 테스트를 돌린다.
  test.describe.configure({ mode: "default" });
  test.setTimeout(180_000);

  let context: BrowserContext;
  let projectId = "";
  let pageIds: string[] = [];

  test.beforeAll(async ({ browser }, testInfo) => {
    if (!env) return;
    // 업로드(서명·PUT·sharp) + 레이아웃 생성 + 표지 첫 저장.
    test.setTimeout(240_000);
    const admin = createServiceClient(env);
    const user = await provisionTestUser(admin, INTEGRITY_EMAIL);
    // 이전 실행이 중단돼 남긴 프로젝트가 있으면 먼저 지운다(전용 계정이라 전부 테스트 데이터다).
    await cleanupProjects(admin, user.userId);

    // 전용 계정으로 직접 로그인하므로 프로젝트의 storageState(golden-flow 계정)는 쓰지 않는다.
    // beforeAll 의 수동 컨텍스트는 프로젝트 use 를 상속하지 않아 필요한 값만 옮긴다.
    const use = testInfo.project.use;
    context = await browser.newContext({
      baseURL: use.baseURL,
      viewport: use.viewport,
      userAgent: use.userAgent,
      deviceScaleFactor: use.deviceScaleFactor,
    });
    // 내지 에디터는 첫 방문(데스크탑)에 "키보드 단축키" 모달을 자동으로 연다
    // (components/editor/KeyboardShortcutsHelp.tsx useShortcutsAutoShow). 모달이 열리면 나머지
    // UI 가 접근성 트리에서 숨겨져 툴바·저장 버튼을 찾을 수 없다. 이 spec 의 검증 대상이 아니므로
    // 본 것으로 표시해 둔다 — 마운트 이후 열리는 모달을 Escape 로 쫓아가면 타이밍에 따라 흔들린다.
    await context.addInitScript(() => {
      try {
        window.localStorage.setItem("editor.shortcutsSeen", "1");
      } catch {
        // localStorage 불가 환경이면 모달도 뜨지 않는다.
      }
    });
    const page = await context.newPage();
    page.on("pageerror", (e) => console.log(`[pageerror] ${e.message}`));

    await page.goto("/login");
    await page.getByLabel("이메일").fill(user.email);
    await page.getByLabel("비밀번호").fill(user.password);
    await page.getByRole("button", { name: "로그인", exact: true }).click();
    await page.waitForURL((url) => !url.pathname.startsWith("/login"), {
      timeout: 30_000,
    });

    // ── 업로드 — golden-flow 와 같은 filechooser 경로.
    await page.goto("/upload", { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/\/upload\?projectId=[0-9a-f-]{36}/);
    projectId = new URL(page.url()).searchParams.get("projectId") ?? "";
    expect(projectId).toBeTruthy();

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
    const nextLink = page.getByRole("link", { name: /다음/ });
    await expect(nextLink).toBeVisible({ timeout: 120_000 });

    // ── 내지 자동 편집.
    await nextLink.click();
    await expect(page).toHaveURL(new RegExp(`/editor/${projectId}`));
    await page.getByRole("button", { name: "자동 편집하기" }).click();
    await expect(page.getByRole("link", { name: "주문 단계로 이동" })).toBeVisible({
      timeout: 60_000,
    });
    const editLinks = page.getByRole("link", { name: /^페이지 \d+ 편집$/ });
    await expect(editLinks.first()).toBeVisible({ timeout: 30_000 });
    const hrefs = await editLinks.evaluateAll((els) =>
      els.map((el) => el.getAttribute("href") ?? ""),
    );
    pageIds = hrefs
      .map((h) => /\/pages\/([0-9a-f-]{36})/.exec(h)?.[1] ?? "")
      .filter((id) => id.length > 0);
    expect(pageIds.length).toBeGreaterThanOrEqual(2);

    // ── 표지 첫 저장 — 미저장 기본 표지는 dirty 로 시작해 자동저장된다. 저장본이 생길 때까지
    //    서버 GET 으로 확인한다(QA-2·QA-4 는 "저장된 표지" 가 전제다).
    await page.goto(`/cover/${projectId}`, { waitUntil: "domcontentloaded" });
    await expect(page.locator("canvas").first()).toBeVisible({ timeout: 60_000 });
    await expect(async () => {
      const cover = await serverCover(page, projectId);
      if (cover.isDefault) {
        await page
          .getByRole("button", { name: "저장", exact: true })
          .click({ timeout: 3_000 })
          .catch(() => {
            // 라벨이 "저장 중…"/"저장됨" 이면 클릭 대상이 없다 — 서버 상태로 판정.
          });
      }
      expect((await serverCover(page, projectId)).isDefault).toBe(false);
    }).toPass({ timeout: 90_000 });
    await page.close();
  });

  // 실패한 테스트가 열어 둔 페이지는 자동저장이 남아 다음 테스트의 저장본을 바꿀 수 있다 —
  // 진단용 스크린샷을 남기고 반드시 닫는다.
  test.afterEach(async ({}, testInfo) => {
    const pages = context?.pages() ?? [];
    for (const [i, p] of pages.entries()) {
      if (testInfo.status !== testInfo.expectedStatus) {
        const name = `failure-${testInfo.title.slice(0, 4)}-${i}`;
        await p.screenshot({ path: screenshotPath(name) }).catch(() => {});
      }
      await p.close().catch(() => {});
    }
  });

  test.afterAll(async () => {
    await context?.close().catch(() => {});
    if (!env) return;
    const admin = createServiceClient(env);
    const user = await provisionTestUser(admin, INTEGRITY_EMAIL);
    const result = await cleanupProjects(admin, user.userId);
    console.log(
      `[e2e cleanup:editor-integrity] 프로젝트 ${result.projects}건 / 스토리지 ${result.storageObjects}개 삭제`,
    );
  });

  test("QA-1 텍스트 추가 후 되돌리기 → 자동저장이 원래 객체 수를 유지한다", async () => {
    const page = await context.newPage();
    page.on("dialog", (d) => void d.accept().catch(() => {}));
    const patches = recordEditorPatches(page);
    const pageId = pageIds[0] ?? "";

    const before = await (async () => {
      await page.goto(`/editor/${projectId}/pages/${pageId}`, {
        waitUntil: "domcontentloaded",
      });
      await expect(page.locator("canvas").first()).toBeVisible({ timeout: 60_000 });
      return serverPageObjects(page, pageId);
    })();
    // 자동 편집된 페이지는 사진 슬롯을 가진다 — 0 이면 전제가 깨진 것이다.
    expect(before, "자동 편집 페이지의 저장 객체 수").toBeGreaterThan(0);
    // 로드 완료(사진·폰트)와 (결함 시) 진입 자동저장 창이 지난 뒤 편집한다 — 로드 도중 편집의
    // 경합과 섞이지 않고 "되돌리기" 경로만 보게 한다. 진입 자체의 PATCH 는 QA-4 가 따로 본다.
    await page.waitForTimeout(AUTOSAVE_WINDOW_MS);

    const toolbar = page.getByRole("toolbar", { name: "에디터 도구" });
    const pagePatches = () =>
      patches.filter((p) => p.kind === "page" && p.url.includes(pageId));

    // ── 텍스트 추가 → 자동저장 PATCH(before + 1) 성공.
    const addedAt = pagePatches().length;
    await toolbar.getByRole("button", { name: "텍스트", exact: true }).click();
    // 데스크탑에서도 텍스트 속성 시트가 열린다 — 닫아야 툴바를 누를 수 있다.
    await page.keyboard.press("Escape");
    await expect
      .poll(() => pagePatches().slice(addedAt).some((p) => p.status !== null), {
        timeout: 20_000,
        message: "텍스트 추가 후 자동저장 PATCH",
      })
      .toBe(true);
    // 실패 시 실제로 보낸 본문 객체 수가 드러나게 목록을 메시지에 싣는다.
    const addPatches = pagePatches().slice(addedAt);
    expect(
      addPatches.some((p) => p.objects === before + 1 && p.status === 200),
      `텍스트 추가 후 PATCH 본문 객체 수가 ${before + 1} 이어야 한다: ${JSON.stringify(
        addPatches.map((p) => [p.objects, p.status]),
      )}`,
    ).toBe(true);

    // ── 되돌리기 → 자동저장 PATCH 본문이 추가 전 객체 수.
    const undoAt = pagePatches().length;
    const undo = toolbar.getByRole("button", { name: "되돌리기" });
    await expect(undo).toBeEnabled();
    await undo.click();
    await expect
      .poll(() => pagePatches().slice(undoAt).some((p) => p.status !== null), {
        timeout: 20_000,
        message: "되돌리기 후 자동저장 PATCH",
      })
      .toBe(true);
    // 저장이 끝난 뒤 debounce 가 한 번 더 돌 수 있다 — 창을 닫고 전부 본다.
    await page.waitForTimeout(AUTOSAVE_WINDOW_MS);
    await page.screenshot({ path: screenshotPath("qa1-after-undo-autosave") });
    const undoPatches = pagePatches().slice(undoAt);
    for (const p of undoPatches) {
      expect(p.objects, `되돌리기 후 PATCH 본문 객체 수 ${JSON.stringify(undoPatches)}`).toBe(
        before,
      );
    }
    console.log(
      `[QA-1] 저장 객체 ${before} → 텍스트 추가 PATCH ${JSON.stringify(
        pagePatches().slice(addedAt, undoAt).map((p) => [p.objects, p.status]),
      )} → 되돌리기 PATCH ${JSON.stringify(undoPatches.map((p) => [p.objects, p.status]))}`,
    );
    expect(undoPatches.every((p) => p.status === 200)).toBe(true);

    // ── 서버 저장본도 같다(0 이 아니다) + 다시 실행 가능.
    expect(await serverPageObjects(page, pageId)).toBe(before);
    await expect(toolbar.getByRole("button", { name: "다시 실행" })).toBeEnabled();

    // ── 새로고침해도 사진이 남아 있다(저장본 기준 재로드).
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.locator("canvas").first()).toBeVisible({ timeout: 60_000 });
    expect(await serverPageObjects(page, pageId)).toBe(before);
    await page.close();
  });

  test("QA-4 저장된 표지·내지에 진입만 하면 저장 요청이 나가지 않는다", async () => {
    const page = await context.newPage();
    const dialogs: string[] = [];
    page.on("dialog", (d) => {
      dialogs.push(`${d.type()}: ${d.message()}`);
      void d.accept().catch(() => {});
    });
    const patches = recordEditorPatches(page);
    const saveButton = page
      .locator("header")
      .getByRole("button", { name: /^(저장|저장 중…|저장됨)$/ });

    const targets: Array<{ name: string; url: string }> = [
      { name: "cover", url: `/cover/${projectId}` },
      // 에디터가 한 번도 저장하지 않은(자동 편집 결과 그대로인) 내지.
      { name: "page-generated", url: `/editor/${projectId}/pages/${pageIds[1] ?? ""}` },
      // QA-1 테스트가 에디터로 저장한 내지(단독 실행 시에는 자동 편집 결과 그대로다).
      { name: "page-editor-saved", url: `/editor/${projectId}/pages/${pageIds[0] ?? ""}` },
    ];

    for (const target of targets) {
      const startAt = patches.length;
      await page.goto(target.url, { waitUntil: "domcontentloaded" });
      await expect(page.locator("canvas").first()).toBeVisible({ timeout: 60_000 });
      await page.waitForTimeout(AUTOSAVE_WINDOW_MS);
      await page.screenshot({ path: screenshotPath(`qa4-${target.name}-idle`) });
      const sent = patches.slice(startAt);
      console.log(`[QA-4] ${target.name}: 진입 후 ${AUTOSAVE_WINDOW_MS}ms PATCH ${sent.length}건`);
      expect(sent, `${target.name}: 편집 없이 ${AUTOSAVE_WINDOW_MS}ms 동안 PATCH`).toEqual([]);
      await expect(saveButton, `${target.name}: 저장 버튼 라벨`).toHaveText("저장됨");
    }
    expect(dialogs).toEqual([]);
    await page.close();
  });

  test("QA-2 표지 저장 직후 내지로 갔다가 곧바로 돌아와도 저장본이 줄지 않는다", async () => {
    const page = await context.newPage();
    page.on("dialog", (d) => void d.accept().catch(() => {}));
    const patches = recordEditorPatches(page);
    const coverPatches = () => patches.filter((p) => p.kind === "cover");

    const variants: Array<{ name: string; back: (p: Page) => Promise<void> }> = [
      {
        name: "link",
        back: async (p) => {
          await p.getByRole("link", { name: "표지 편집으로 이동" }).click();
        },
      },
      {
        name: "goBack",
        back: async (p) => {
          await p.goBack();
        },
      },
    ];

    for (const variant of variants) {
      // ── 표지 새로 진입 — 로드 직후의 (결함 시) 자동저장이 끝날 때까지 기다린 뒤 기준을 잡는다.
      await page.goto(`/cover/${projectId}`, { waitUntil: "domcontentloaded" });
      await expect(page.locator("canvas").first()).toBeVisible({ timeout: 60_000 });
      await page.waitForTimeout(AUTOSAVE_WINDOW_MS);
      const base = await serverCover(page, projectId);
      expect(base.isDefault, "표지 저장본 존재").toBe(false);
      const expected = base.objects + 1;

      // ── 텍스트 추가 → '← 내지 편집'(dirty flush 저장) → 저장 PATCH(객체 +1) 성공 확인.
      const addAt = coverPatches().length;
      await page.getByRole("button", { name: "뒷표지에 글 추가" }).first().click();
      await page.getByRole("button", { name: "← 내지 편집" }).click();
      await expect
        .poll(
          () =>
            coverPatches()
              .slice(addAt)
              .some((p) => p.objects === expected && p.status === 200),
          { timeout: 20_000, message: `${variant.name}: 표지 저장 PATCH(객체 ${expected})` },
        )
        .toBe(true);
      await expect(page).toHaveURL(new RegExp(`/editor/${projectId}$`), { timeout: 30_000 });
      expect((await serverCover(page, projectId)).objects).toBe(expected);

      // ── 1초 안에 표지로 복귀.
      await page.waitForTimeout(1_000);
      const returnAt = coverPatches().length;
      await variant.back(page);
      await expect(page).toHaveURL(new RegExp(`/cover/${projectId}$`), { timeout: 30_000 });
      await expect(page.locator("canvas").first()).toBeVisible({ timeout: 60_000 });
      await page.waitForTimeout(AUTOSAVE_WINDOW_MS);
      await page.screenshot({ path: screenshotPath(`qa2-${variant.name}-after-return`) });

      // 복귀 후 나간 저장이 있다면 최신본보다 적은 객체를 보내서는 안 된다.
      const afterReturn = coverPatches().slice(returnAt);
      const serverAfter = await serverCover(page, projectId);
      console.log(
        `[QA-2] ${variant.name}: 기준 ${base.objects} → 저장 ${expected} → 복귀 후 PATCH ${JSON.stringify(
          afterReturn.map((p) => [p.objects, p.status]),
        )} → 서버 ${serverAfter.objects}`,
      );
      for (const p of afterReturn) {
        expect(
          p.objects,
          `${variant.name}: 복귀 후 표지 PATCH 본문 ${JSON.stringify(afterReturn)}`,
        ).toBeGreaterThanOrEqual(expected);
      }
      expect(serverAfter.objects, `${variant.name}: 복귀 후 서버 표지 객체 수`).toBe(expected);
    }
    await page.close();
  });
});

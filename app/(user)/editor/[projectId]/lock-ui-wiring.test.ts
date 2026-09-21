import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { READ_ONLY_NOTICE_TITLE } from "@/lib/editor/lock-ui";

/**
 * 결제 후 편집 잠금의 **화면 배선** 소스 가드.
 *
 * 세 화면(표지 · 내지 목록 · 페이지 에디터)은 같은 잠금 판정을 받고도 각자 UI 를 적어 어긋나기 쉽다
 * (FU1: 내지 목록 TopBar 만 제목 입력이 열려 있어 저장 시 409 로 되돌아갔다). 컴포넌트를 마운트하는
 * 테스트 환경이 없으므로, 판정·문구가 공용 출처를 거치는지를 소스 수준에서 고정한다.
 * 순수 판정 자체는 lib/editor/lock-ui.test.ts.
 */

function read(relativeToThisFile: string): string {
  return readFileSync(
    fileURLToPath(new URL(relativeToThisFile, import.meta.url)),
    "utf8",
  );
}

/** 주석에 문구·식별자를 언급한 설명까지 위반으로 잡지 않도록 제거한다. */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|\s)\/\/[^\n]*/g, "$1");
}

/** start 표식부터 end 표식 직전까지. 표식이 없으면 실패시킨다(리팩터링 시 가드 갱신 유도). */
function section(src: string, start: string, end: string): string {
  const from = src.indexOf(start);
  expect(from, `표식을 찾지 못함: ${start}`).toBeGreaterThanOrEqual(0);
  const to = src.indexOf(end, from + start.length);
  expect(to, `표식을 찾지 못함: ${end}`).toBeGreaterThan(from);
  return src.slice(from, to);
}

function count(src: string, needle: string): number {
  return src.split(needle).length - 1;
}

const NOTICE = stripComments(
  read("../../../../components/editor/ReadOnlyNotice.tsx"),
);
const EDITOR = stripComments(read("./EditorClient.tsx"));
const TOPBAR = stripComments(read("./TopBar.tsx"));
const PAGE = stripComments(read("./pages/[pageId]/PageEditor.tsx"));
const COVER = stripComments(read("../../cover/[projectId]/CoverEditor.tsx"));

const SCREENS: ReadonlyArray<readonly [string, string]> = [
  ["EditorClient(내지 목록)", EDITOR],
  ["PageEditor(페이지 편집)", PAGE],
  ["CoverEditor(표지)", COVER],
];

describe("읽기 전용 배너 — 공용 컴포넌트 단일 출처", () => {
  it("배너 제목 문구는 lib/editor/lock-ui.ts 상수에서만 온다", () => {
    expect(NOTICE).toContain("READ_ONLY_NOTICE_TITLE");
    expect(NOTICE).not.toContain(READ_ONLY_NOTICE_TITLE);
  });

  it.each(SCREENS)("%s 는 배너 마크업을 다시 적지 않는다", (_name, src) => {
    // 문구를 직접 적거나 잠금 안내를 직접 렌더하면(손으로 만든 배너) 화면마다 톤이 갈린다.
    expect(src).not.toContain(READ_ONLY_NOTICE_TITLE);
    expect(src).not.toContain(">{lockMessage}<");
  });

  it.each(SCREENS)(
    "%s 는 ReadOnlyNotice 를 정확히 한 번 그린다",
    (_name, src) => {
      expect(count(src, "<ReadOnlyNotice")).toBe(1);
      expect(src).toContain('from "@/components/editor/ReadOnlyNotice"');
    },
  );
});

describe("내지 목록(EditorClient) — 잠금 전달", () => {
  it("잠금 판정을 normalizeLockMessage 로 한 번만 만든다", () => {
    expect(EDITOR).toContain(
      "const lockNotice = normalizeLockMessage(lockMessage);",
    );
    expect(EDITOR).toContain("const locked = lockNotice !== null;");
  });

  it("TopBar 에 lockMessage 를 넘긴다 (FU1 회귀 가드)", () => {
    const topBarUsage = section(EDITOR, "<TopBar", "/>");
    expect(topBarUsage).toContain("lockMessage={lockNotice}");
  });

  it("배너에도 같은 판정값을 넘긴다", () => {
    expect(EDITOR).toContain("<ReadOnlyNotice message={lockNotice} />");
  });
});

describe("TopBar — 제목 편집 비활성 + 저장 차단", () => {
  it("lockMessage prop 을 필수로 받는다", () => {
    expect(section(TOPBAR, "export interface TopBarProps", "}")).toContain(
      "lockMessage: string | null;",
    );
  });

  it("제목 입력은 공용 판정(titleField.disabled)으로만 비활성된다", () => {
    expect(TOPBAR).toContain(
      "resolveTitleFieldLockState({ saving, lockMessage })",
    );
    expect(TOPBAR).toContain("disabled={titleField.disabled}");
    expect(TOPBAR).not.toContain("disabled={saving}");
  });

  it("잠겨 있으면 fetch 이전에 되돌린다 — PATCH 를 보내지 않는다", () => {
    const persist = section(TOPBAR, "async function persistTitle(", "return (");
    const guard = persist.indexOf("titleField.canPersist");
    const request = persist.indexOf("fetch(");
    expect(guard, "canPersist 가드가 없음").toBeGreaterThanOrEqual(0);
    expect(request, "fetch 호출을 찾지 못함").toBeGreaterThan(0);
    expect(guard).toBeLessThan(request);
  });

  it("잠금 상태를 화면에도 표시한다", () => {
    expect(TOPBAR).toContain("READ_ONLY_BADGE_LABEL");
  });
});

describe("표지(CoverEditor) — 같은 비활성 범위 유지", () => {
  it("제목 입력이 읽기 전용에서 비활성이다 (내지 목록과 동일)", () => {
    expect(COVER).toContain("disabled={titleSaving || readOnly}");
  });
});

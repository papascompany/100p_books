import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import ReadOnlyNotice from "./ReadOnlyNotice";
import { PROJECT_LOCKED_FALLBACK_MESSAGE } from "@/lib/editor/edit-conflict";
import { READ_ONLY_NOTICE_TITLE } from "@/lib/editor/lock-ui";

/**
 * 잠금 배너 렌더 — 표지·내지 목록·페이지 에디터가 이 컴포넌트 하나를 쓴다
 * (어느 화면이 무엇을 넘기는지는 app/(user)/editor/[projectId]/lock-ui-wiring.test.ts).
 */

const LOCKED = "결제가 완료된 포토북은 수정할 수 없어요.";

describe("ReadOnlyNotice", () => {
  it("잠기지 않았으면 아무것도 그리지 않는다", () => {
    expect(renderToStaticMarkup(<ReadOnlyNotice message={null} />)).toBe("");
    expect(renderToStaticMarkup(<ReadOnlyNotice message={undefined} />)).toBe(
      "",
    );
  });

  it("잠겼으면 제목 + 서버 안내를 status 로 알린다", () => {
    const html = renderToStaticMarkup(<ReadOnlyNotice message={LOCKED} />);
    expect(html).toContain('role="status"');
    expect(html).toContain(READ_ONLY_NOTICE_TITLE);
    expect(html).toContain(LOCKED);
  });

  it("안내가 비어 있어도 빈 배너를 그리지 않는다", () => {
    const html = renderToStaticMarkup(<ReadOnlyNotice message="  " />);
    expect(html).toContain(PROJECT_LOCKED_FALLBACK_MESSAGE);
  });

  it("className 은 기본 스타일에 더해진다", () => {
    const html = renderToStaticMarkup(
      <ReadOnlyNotice message={LOCKED} className="mb-2" />,
    );
    expect(html).toContain("mb-2");
    expect(html).toContain("rounded-lg");
  });
});

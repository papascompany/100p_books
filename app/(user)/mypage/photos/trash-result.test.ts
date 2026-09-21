import { describe, expect, it } from "vitest";

import { describeTrashResult } from "./trash-result";

/**
 * 사진 라이브러리 휴지통 토스트 — 서버가 실제로 옮긴 장수와 제외 사유(결제 완료 포토북)를 그대로 보인다.
 * 예전: selected.size 를 그대로 "N장이 휴지통에 있어요" 로 표시(잠긴 포토북 사진이 섞이면 과장).
 */

describe("describeTrashResult", () => {
  it("전부 옮김 → 성공, 서버 updated 기준", () => {
    expect(describeTrashResult({ updated: 3, skipped: 0, skippedLocked: 0 }, 3)).toEqual({
      title: "휴지통으로 옮겼어요.",
      description: "3장이 휴지통에 있어요.",
      variant: "success",
    });
  });

  it("결제 완료 포토북 사진이 섞인 배치 → 선택 5장이 아니라 옮긴 2장 + 제외 3장 안내", () => {
    const t = describeTrashResult({ updated: 2, skipped: 3, skippedLocked: 3 }, 5);
    expect(t.variant).toBe("warning");
    expect(t.title).toBe("일부 사진만 휴지통으로 옮겼어요.");
    expect(t.description).toContain("2장을 휴지통으로 옮겼어요.");
    expect(t.description).toContain("결제가 완료된 포토북의 사진 3장은 옮기지 않았어요.");
    expect(t.description).not.toContain("5장");
  });

  it("잠금 제외와 이미 휴지통인 사진을 구분한다", () => {
    const t = describeTrashResult({ updated: 1, skipped: 3, skippedLocked: 1 }, 4);
    expect(t.description).toContain("결제가 완료된 포토북의 사진 1장");
    expect(t.description).toContain("이미 휴지통에 있거나 찾을 수 없는 사진 2장");
  });

  it("옮긴 사진이 없음(모두 이미 휴지통) → 경고", () => {
    const t = describeTrashResult({ updated: 0, skipped: 2, skippedLocked: 0 }, 2);
    expect(t.variant).toBe("warning");
    expect(t.title).toBe("휴지통으로 옮긴 사진이 없어요.");
    expect(t.description).toContain("2장은 건너뛰었어요");
  });

  it("구 서버 응답(skippedLocked 없음)도 동작 — skipped 는 요청 수로 추정", () => {
    expect(describeTrashResult({ updated: 2 }, 2).description).toBe("2장이 휴지통에 있어요.");
    expect(describeTrashResult({ updated: 1 }, 2).description).toContain("1장은 건너뛰었어요");
    expect(describeTrashResult(undefined, 1).variant).toBe("warning");
  });
});

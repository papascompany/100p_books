import { describe, expect, it } from "vitest";

import { PROJECT_LOCKED_FALLBACK_MESSAGE } from "./edit-conflict";
import {
  READ_ONLY_BADGE_LABEL,
  READ_ONLY_NOTICE_TITLE,
  isEditingLocked,
  normalizeLockMessage,
  resolveTitleFieldLockState,
} from "./lock-ui";

/**
 * 잠금 화면 표현 규약 — 표지·내지 목록·페이지 에디터가 같은 판정을 쓴다.
 * 배선(어느 화면이 무엇을 비활성화하는지)은 app/(user)/editor/[projectId]/lock-ui-wiring.test.ts.
 */

const LOCKED = "결제가 완료된 포토북은 수정할 수 없어요.";

describe("normalizeLockMessage", () => {
  it("null·undefined 는 잠기지 않음", () => {
    expect(normalizeLockMessage(null)).toBeNull();
    expect(normalizeLockMessage(undefined)).toBeNull();
  });

  it("문구가 있으면 원문 그대로", () => {
    expect(normalizeLockMessage(LOCKED)).toBe(LOCKED);
  });

  it("공백뿐이면 잠김으로 보되 기본 안내로 채운다 (빈 배너 금지)", () => {
    expect(normalizeLockMessage("")).toBe(PROJECT_LOCKED_FALLBACK_MESSAGE);
    expect(normalizeLockMessage("   \n ")).toBe(PROJECT_LOCKED_FALLBACK_MESSAGE);
  });
});

describe("isEditingLocked", () => {
  it.each([
    [null, false],
    [undefined, false],
    ["", true],
    [LOCKED, true],
  ] as const)("%s → %s", (message, expected) => {
    expect(isEditingLocked(message)).toBe(expected);
  });
});

describe("resolveTitleFieldLockState", () => {
  it("정상 상태 — 편집·저장 모두 허용", () => {
    expect(
      resolveTitleFieldLockState({ saving: false, lockMessage: null }),
    ).toEqual({ disabled: false, lockMessage: null, canPersist: true });
  });

  it("저장 중 — 입력만 잠시 막고 저장 자체는 허용(잠금이 아니다)", () => {
    expect(
      resolveTitleFieldLockState({ saving: true, lockMessage: null }),
    ).toEqual({ disabled: true, lockMessage: null, canPersist: true });
  });

  it("결제 후 잠금 — 입력 비활성 + PATCH 를 보내지 않는다", () => {
    expect(
      resolveTitleFieldLockState({ saving: false, lockMessage: LOCKED }),
    ).toEqual({ disabled: true, lockMessage: LOCKED, canPersist: false });
  });

  it("잠금 + 저장 중이 겹쳐도 잠금이 우선", () => {
    expect(
      resolveTitleFieldLockState({ saving: true, lockMessage: LOCKED }),
    ).toEqual({ disabled: true, lockMessage: LOCKED, canPersist: false });
  });

  it("공백 안내로 잠겼을 때도 안내 문구가 비지 않는다", () => {
    expect(
      resolveTitleFieldLockState({ saving: false, lockMessage: " " }),
    ).toEqual({
      disabled: true,
      lockMessage: PROJECT_LOCKED_FALLBACK_MESSAGE,
      canPersist: false,
    });
  });
});

describe("공용 문구", () => {
  it("배너 제목·배지 라벨은 이 모듈이 단일 출처다", () => {
    expect(READ_ONLY_NOTICE_TITLE).toBe("읽기 전용으로 보고 있어요");
    expect(READ_ONLY_BADGE_LABEL).toBe("읽기 전용");
  });
});

import { describe, expect, it } from "vitest";

import { describePurgeResult, describeRestoreResult } from "./trash-result";

/**
 * 휴지통 복원·영구 삭제 토스트 — 서버 응답(restored/skippedQuota/skippedLocked, deleted/skipped) 기준.
 */

describe("describeRestoreResult", () => {
  it("전부 복원 → 성공", () => {
    expect(
      describeRestoreResult({ restored: 2, skipped: 0, skippedQuota: 0, skippedLocked: 0 }, 2),
    ).toEqual({
      title: "복원 완료",
      description: "2장이 라이브러리로 돌아왔어요.",
      variant: "success",
    });
  });

  it("결제 완료 포토북 사진 제외를 알린다 (예전: 한도만 안내)", () => {
    const t = describeRestoreResult(
      { restored: 1, skipped: 1, skippedQuota: 0, skippedLocked: 1 },
      2,
    );
    expect(t.variant).toBe("warning");
    expect(t.title).toBe("일부만 복원했어요");
    expect(t.description).toContain("1장을 복원했어요.");
    expect(t.description).toContain("결제가 완료된 포토북의 사진 1장은 복원할 수 없어 휴지통에 남았어요.");
  });

  it("한도·잠금·휴지통에 없음 세 사유를 구분한다", () => {
    const t = describeRestoreResult(
      { restored: 1, skipped: 6, skippedQuota: 2, skippedLocked: 3 },
      7,
    );
    expect(t.description).toContain("사진 3장은 복원할 수 없어");
    expect(t.description).toContain("2장은 포토북 한도(100장) 초과");
    expect(t.description).toContain("휴지통에 없는 사진 1장");
  });

  it("QUOTA_EXCEEDED(복원 0) → 경고 + 한도 사유", () => {
    const t = describeRestoreResult(
      { restored: 0, skipped: 2, skippedQuota: 2, skippedLocked: 0, reason: "QUOTA_EXCEEDED" },
      2,
    );
    expect(t.variant).toBe("warning");
    expect(t.title).toBe("복원한 사진이 없어요");
    expect(t.description).toContain("2장은 포토북 한도(100장) 초과");
  });

  it("NOT_IN_TRASH → 경고", () => {
    const t = describeRestoreResult(
      { restored: 0, skipped: 1, skippedQuota: 0, skippedLocked: 0, reason: "NOT_IN_TRASH" },
      1,
    );
    expect(t.variant).toBe("warning");
    expect(t.description).toContain("휴지통에 없는 사진 1장");
  });
});

describe("describePurgeResult", () => {
  it("전부 삭제 → 서버 deleted 기준 성공", () => {
    expect(describePurgeResult({ deleted: 3, skipped: 0 }, 3)).toEqual({
      title: "영구 삭제 완료",
      description: "3장이 영구 삭제됐어요.",
      variant: "success",
    });
  });

  it("일부 건너뜀을 알린다", () => {
    expect(describePurgeResult({ deleted: 2, skipped: 1 }, 3).description).toBe(
      "2장이 영구 삭제됐어요. 이미 삭제됐거나 휴지통에 없는 사진 1장은 건너뛰었어요.",
    );
  });

  it("삭제 0 → 경고", () => {
    const t = describePurgeResult({ deleted: 0, skipped: 2 }, 2);
    expect(t.variant).toBe("warning");
    expect(t.title).toBe("영구 삭제한 사진이 없어요");
  });
});

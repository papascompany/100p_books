import { describe, expect, it } from "vitest";

import type { StorigeValidationCache } from "@/lib/db/types";

import {
  formatValidationBlocks,
  getValidationBlocks,
} from "./validation-gate";

const cache = (
  cover?: { status: string; errors?: unknown[] },
  interior?: { status: string; errors?: unknown[] },
): StorigeValidationCache => ({
  ...(cover ? { cover } : {}),
  ...(interior ? { interior } : {}),
  validatedAt: "2026-07-14T00:00:00.000Z",
});

describe("getValidationBlocks — 차단 판정", () => {
  it("캐시 없음(null/undefined) → 비차단", () => {
    expect(getValidationBlocks(null)).toEqual([]);
    expect(getValidationBlocks(undefined)).toEqual([]);
  });

  it("COMPLETED 양쪽 통과 → 비차단", () => {
    expect(
      getValidationBlocks(cache({ status: "COMPLETED" }, { status: "COMPLETED" })),
    ).toEqual([]);
  });

  it("best-effort 미종착/생략(ERROR/PROCESSING/SKIPPED) → 비차단", () => {
    expect(
      getValidationBlocks(cache({ status: "ERROR" }, { status: "PROCESSING" })),
    ).toEqual([]);
    expect(getValidationBlocks(cache({ status: "SKIPPED" }))).toEqual([]);
  });

  it("FAILED 내지 → 해당 파트만 차단", () => {
    const blocks = getValidationBlocks(
      cache({ status: "COMPLETED" }, { status: "FAILED", errors: [1, 2] }),
    );
    expect(blocks).toEqual([
      { part: "interior", status: "FAILED", errorCount: 2 },
    ]);
  });

  it("FIXABLE 표지 → 차단 + 에러 수 없으면 errorCount 생략", () => {
    const blocks = getValidationBlocks(cache({ status: "FIXABLE" }));
    expect(blocks).toEqual([{ part: "cover", status: "FIXABLE" }]);
  });

  it("소문자/혼합 케이스 status 도 정규화해 차단", () => {
    expect(getValidationBlocks(cache({ status: "failed" }))).toHaveLength(1);
    expect(getValidationBlocks(cache({ status: "Fixable" }))).toHaveLength(1);
  });

  it("양쪽 모두 차단이면 cover, interior 순서로 2건", () => {
    const blocks = getValidationBlocks(
      cache({ status: "FIXABLE", errors: [] }, { status: "FAILED", errors: [1] }),
    );
    expect(blocks.map((b) => b.part)).toEqual(["cover", "interior"]);
  });
});

describe("formatValidationBlocks — 메시지 요약", () => {
  it("파트 한글화 + 에러 수 표기", () => {
    expect(
      formatValidationBlocks([
        { part: "cover", status: "FIXABLE", errorCount: 1 },
        { part: "interior", status: "FAILED" },
      ]),
    ).toBe("표지 FIXABLE (에러 1건), 내지 FAILED");
  });
});

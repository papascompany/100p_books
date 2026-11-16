import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  DEFAULT_TEXT_FILL,
  KNOWN_PLACEHOLDER_TEXTS,
  PLACEHOLDER_TEXT_FILL,
  normalizePlaceholderText,
} from "./text-placeholder";
import type { TextObject } from "./types";

function text(partial: Partial<TextObject>): TextObject {
  return {
    type: "text",
    objectId: "t1",
    leftMm: 0,
    topMm: 0,
    widthMm: 50,
    heightMm: 10,
    text: "",
    fontFamily: "Pretendard",
    fontSizePt: 12,
    fill: "#2b2b2b",
    align: "center",
    lineHeight: 1.4,
    ...partial,
  };
}

describe("normalizePlaceholderText", () => {
  it("일반 텍스트·정상 저장된 빈 칸은 그대로", () => {
    const a = text({ text: "안녕", fill: "#111111" });
    expect(normalizePlaceholderText(a)).toBe(a);
    const b = text({ text: "", placeholder: "여기에 글을 입력하세요" });
    expect(normalizePlaceholderText(b)).toBe(b);
  });

  it("예전 편집기가 저장한 폴라로이드 안내 문구 → 빈 칸", () => {
    const out = normalizePlaceholderText(
      text({ text: "여기에 글을 입력하세요", fill: PLACEHOLDER_TEXT_FILL }),
    );
    expect(out.text).toBe("");
    expect(out.placeholder).toBe("여기에 글을 입력하세요");
    expect(out.fill).toBe(DEFAULT_TEXT_FILL);
  });

  it("예전 편집기가 저장한 뒷표지 캡션 → 빈 칸", () => {
    const out = normalizePlaceholderText(
      text({ text: "뒷표지 캡션", fill: PLACEHOLDER_TEXT_FILL }),
    );
    expect(out.text).toBe("");
  });

  it("흐린 색의 사용자 글·책등 제목은 글을 살리고 기본 색으로", () => {
    const out = normalizePlaceholderText(
      text({ text: "우리 가족 여행", fill: PLACEHOLDER_TEXT_FILL }),
    );
    expect(out.text).toBe("우리 가족 여행");
    expect(out.fill).toBe(DEFAULT_TEXT_FILL);
  });

  it("텍스트가 자기 placeholder 와 같으면 빈 칸", () => {
    const out = normalizePlaceholderText(
      text({ text: "내 제목", placeholder: "내 제목", fill: PLACEHOLDER_TEXT_FILL }),
    );
    expect(out.text).toBe("");
  });
});

describe("KNOWN_PLACEHOLDER_TEXTS — 템플릿의 고정 안내 문구를 모두 포함", () => {
  const files = [
    "lib/layout/cover-templates.ts",
    "lib/layout/polaroid.ts",
    "lib/layout/collage.ts",
  ];
  for (const f of files) {
    it(f, () => {
      const src = readFileSync(join(process.cwd(), f), "utf8");
      const literals = [
        ...src.matchAll(/placeholder:\s*(?:args\.\w+\s*\?\?\s*)?"([^"]+)"/g),
        ...src.matchAll(/PLACEHOLDER\s*=\s*"([^"]+)"/g),
      ].map((m) => m[1]!);
      expect(literals.length).toBeGreaterThan(0);
      for (const lit of literals) {
        expect(KNOWN_PLACEHOLDER_TEXTS).toContain(lit);
      }
    });
  }
});

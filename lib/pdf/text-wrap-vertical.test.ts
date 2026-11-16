import { describe, expect, it } from "vitest";

import { wrapByGrapheme } from "./text-wrap";

// 글자당 10px 로 측정 — 폭 12px 이면 한 줄에 한 글자.
const opts = { measure: (s: string) => Array.from(s).length * 10, maxWidthPx: 12 };

describe("wrapByGrapheme — 세로쓰기 줄바꿈", () => {
  it("한글·영문 모두 한 글자씩 쌓는다(단어 경계 무시)", () => {
    expect(wrapByGrapheme("우리 여행", opts)).toEqual(["우", "리", " ", "여", "행"]);
    expect(wrapByGrapheme("Trip", opts)).toEqual(["T", "r", "i", "p"]);
  });

  it("빈 텍스트는 빈 줄 하나, 명시 개행은 빈 줄로 유지", () => {
    expect(wrapByGrapheme("", opts)).toEqual([""]);
    expect(wrapByGrapheme("가\n\n나", opts)).toEqual(["가", "", "나"]);
  });
});

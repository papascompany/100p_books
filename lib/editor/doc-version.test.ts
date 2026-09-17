import { describe, expect, it } from "vitest";

import {
  canonicalJson,
  computeDocVersion,
  parseBaseVersion,
} from "./doc-version";

describe("canonicalJson", () => {
  it("키 순서와 무관하게 같은 문자열 (jsonb 는 키 순서를 보존하지 않는다)", () => {
    const a = { version: "1", objects: [{ type: "text", leftMm: 1.5 }], pageNo: 2 };
    const b = { pageNo: 2, objects: [{ leftMm: 1.5, type: "text" }], version: "1" };
    expect(canonicalJson(a)).toBe(canonicalJson(b));
  });

  it("배열 순서는 의미가 있다(레이어 순서)", () => {
    expect(canonicalJson([1, 2])).not.toBe(canonicalJson([2, 1]));
  });

  it("undefined 속성은 JSON.stringify 처럼 제외, 배열 안 undefined 는 null", () => {
    expect(canonicalJson({ a: 1, b: undefined })).toBe(canonicalJson({ a: 1 }));
    expect(canonicalJson([undefined, 1])).toBe("[null,1]");
    expect(canonicalJson(undefined)).toBe("null");
  });
});

describe("computeDocVersion", () => {
  const doc = {
    version: "1",
    bookSizeId: "s",
    pageNo: 0,
    layoutMode: "cover",
    objects: [{ type: "photo", objectId: "p1", leftMm: 161.27 }],
  };

  it("같은 내용이면 같은 버전, 한 값만 달라도 다른 버전", () => {
    const reordered = JSON.parse(
      '{"objects":[{"leftMm":161.27,"objectId":"p1","type":"photo"}],"layoutMode":"cover","pageNo":0,"bookSizeId":"s","version":"1"}',
    ) as unknown;
    expect(computeDocVersion(reordered)).toBe(computeDocVersion(doc));
    expect(
      computeDocVersion({
        ...doc,
        objects: [{ type: "photo", objectId: "p1", leftMm: 161.28 }],
      }),
    ).not.toBe(computeDocVersion(doc));
  });

  it("미저장(null) 도 고정 토큰, 빈 문서와 구분된다", () => {
    expect(computeDocVersion(null)).toBe(computeDocVersion(undefined));
    expect(computeDocVersion(null)).not.toBe(
      computeDocVersion({ ...doc, objects: [] }),
    );
    expect(computeDocVersion(null)).toMatch(/^v1-[0-9a-f]{32}$/);
  });
});

describe("parseBaseVersion", () => {
  it("없음/null 은 구 클라이언트(기준 없음)", () => {
    expect(parseBaseVersion(undefined)).toEqual({ ok: true, value: null });
    expect(parseBaseVersion(null)).toEqual({ ok: true, value: null });
  });

  it("비어있지 않은 문자열(≤128자)만 기준으로 인정", () => {
    expect(parseBaseVersion("v1-abc")).toEqual({ ok: true, value: "v1-abc" });
    expect(parseBaseVersion("")).toEqual({ ok: false });
    expect(parseBaseVersion("x".repeat(129))).toEqual({ ok: false });
    expect(parseBaseVersion(123)).toEqual({ ok: false });
  });
});

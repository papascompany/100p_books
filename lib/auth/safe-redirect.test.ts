import { describe, expect, it } from "vitest";

import { DEFAULT_REDIRECT_PATH, safeRedirectPath } from "./safe-redirect";

/** 실제 운영 origin 으로 해석했을 때 다른 호스트로 나가는지 — 헬퍼 출력의 최종 안전성 확인용. */
const PROD_ORIGIN = "https://100pbooks.vercel.app";

/**
 * 거부돼야 하는 우회 표.
 * `raw` 는 `searchParams.get("next")` 가 돌려주는 **디코딩된** 값이다.
 * (예: 쿼리 `next=/%5Cevil.example` → raw `/\evil.example`)
 */
const BYPASSES: Array<[label: string, raw: string]> = [
  ["protocol-relative", "//evil.example"],
  ["protocol-relative + path", "//evil.example/login"],
  ["백슬래시 (쿼리 %5C 디코딩 결과) — SEC-3 재현", "/\\evil.example"],
  ["백슬래시 2개", "/\\\\evil.example"],
  ["백슬래시로 시작", "\\\\evil.example"],
  ["슬래시+백슬래시 혼합", "/\\/evil.example"],
  ["탭 (쿼리 %09 디코딩 결과) — SEC-3 재현", "/\t/evil.example"],
  ["개행", "/\n/evil.example"],
  ["CR", "/\r/evil.example"],
  ["NUL", "/\u0000/evil.example"],
  ["DEL", "/\u007f/evil.example"],
  ["공백", "/ /evil.example"],
  ["앞 공백", " /mypage"],
  ["전각 공백", "/\u3000/evil.example"],
  ["줄 구분자", "/\u2028/evil.example"],
  ["이중 인코딩 백슬래시", "/%5Cevil.example"],
  ["이중 인코딩 백슬래시 소문자", "/%5cevil.example"],
  ["이중 인코딩 슬래시", "/%2F/evil.example"],
  ["삼중 인코딩 슬래시", "/%252F/evil.example"],
  ["이중 인코딩 탭", "/%09/evil.example"],
  ["이중 인코딩 개행", "/%0A/evil.example"],
  ["이중 인코딩 NUL", "/%00"],
  ["이중 인코딩 공백", "/%20/evil.example"],
  ["잘못된 퍼센트 시퀀스", "/%E0%A4%A"],
  ["dot segment 후 protocol-relative", "/.//evil.example"],
  ["dot-dot segment 후 protocol-relative", "/..//evil.example"],
  ["인코딩된 dot-dot segment 후 protocol-relative", "/%2e%2e//evil.example"],
  // 정규화 뒤에야 디코딩 시 `//` 가 되는 입력 — 이전 구현은 `/%2f` 등을 반환해 재적용 시 `/` 로 바뀌었다(비멱등).
  ["dot segment 정규화 후 인코딩 슬래시", "/%2e/%2f"],
  ["dot-dot segment 정규화 후 이중 인코딩 슬래시", "/../%252f"],
  ["인코딩 dot-dot 정규화 후 인코딩 슬래시 + 호스트", "/%2e%2e/%2f/evil.example"],
  ["경로 인코딩 백슬래시 뒤 쿼리", "/%5C/evil.example?next=/"],
  ["쿼리 원문 백슬래시", "/ok?\\evil.example"],
  ["쿼리 원문 공백", "/ok?q=a b"],
  ["절대 URL", "https://evil.example"],
  ["scheme-relative 변형", "https:evil.example"],
  ["scheme + 한 슬래시", "https:/evil.example"],
  ["javascript scheme", "javascript:alert(1)"],
  ["data scheme", "data:text/html,<script>alert(1)</script>"],
  ["상대 경로", "mypage"],
  ["점 상대 경로", "./mypage"],
  ["빈 문자열", ""],
  ["과도한 길이", `/${"a".repeat(3000)}`],
];

/** 허용돼야 하는 정상 내부 경로 → 기대 정규화 결과. */
const ALLOWED: Array<[raw: string, expected: string]> = [
  ["/", "/"],
  ["/mypage", "/mypage"],
  ["/mypage/orders", "/mypage/orders"],
  ["/reset-password", "/reset-password"],
  ["/admin", "/admin"],
  ["/attendance", "/attendance"],
  [
    "/editor/4b6f2a0e-7c1d-4f7a-9a51-2b1f0c3d4e5f/pages/0c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f",
    "/editor/4b6f2a0e-7c1d-4f7a-9a51-2b1f0c3d4e5f/pages/0c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f",
  ],
  ["/gift/AbC_123-xyz", "/gift/AbC_123-xyz"],
  ["/order/abc?step=2#pay", "/order/abc?step=2#pay"],
  ["/mypage/../projects", "/projects"],
  ["/%ED%95%9C%EA%B8%80", "/%ED%95%9C%EA%B8%80"],
  // 쿼리·해시는 origin 을 바꿀 수 없으므로 인코딩 공백·% 를 허용한다 (이전 구현은 `/` 로 떨어뜨렸다).
  ["/gallery?q=hello%20world", "/gallery?q=hello%20world"],
  ["/search?p=100%25", "/search?p=100%25"],
  ["/faq#%EC%A3%BC%EB%AC%B8", "/faq#%EC%A3%BC%EB%AC%B8"],
  ["/order/abc?back=%2F%2Fevil.example", "/order/abc?back=%2F%2Fevil.example"],
];

describe("safeRedirectPath — 우회 표 전수 거부", () => {
  for (const [label, raw] of BYPASSES) {
    it(`거부: ${label} (${JSON.stringify(raw.slice(0, 40))})`, () => {
      expect(safeRedirectPath(raw)).toBe(DEFAULT_REDIRECT_PATH);
    });
  }

  it("null/undefined 는 fallback", () => {
    expect(safeRedirectPath(null)).toBe("/");
    expect(safeRedirectPath(undefined)).toBe("/");
  });

  it("fallback 인자를 존중한다", () => {
    expect(safeRedirectPath("//evil.example", "/login")).toBe("/login");
  });
});

describe("safeRedirectPath — 정상 내부 경로 허용·정규화", () => {
  for (const [raw, expected] of ALLOWED) {
    it(`허용: ${raw} → ${expected}`, () => {
      expect(safeRedirectPath(raw)).toBe(expected);
    });
  }
});

describe("safeRedirectPath — 출력은 운영 origin 에서 항상 같은 origin 으로 해석된다", () => {
  const inputs = [...BYPASSES.map(([, raw]) => raw), ...ALLOWED.map(([raw]) => raw)];
  for (const raw of inputs) {
    it(`same-origin: ${JSON.stringify(raw.slice(0, 40))}`, () => {
      const out = safeRedirectPath(raw);
      expect(out.startsWith("/")).toBe(true);
      expect(out.startsWith("//")).toBe(false);
      expect(new URL(out, PROD_ORIGIN).origin).toBe(PROD_ORIGIN);
    });
  }

  it("수정 전 규칙은 SEC-3 입력을 외부로 보냈다 (회귀 기준 확인)", () => {
    const legacy = (next: string) =>
      next.startsWith("/") && !next.startsWith("//") ? next : "/";
    const raw = new URLSearchParams("next=/%5Cevil.example").get("next") ?? "";
    expect(new URL(legacy(raw), PROD_ORIGIN).host).toBe("evil.example");
    expect(new URL(safeRedirectPath(raw), PROD_ORIGIN).host).toBe(
      "100pbooks.vercel.app",
    );
  });
});

/** 결정적 의사난수 (mulberry32) — 실패 시 같은 입력으로 재현된다. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FUZZ_TOKENS = [
  "/", "//", "\\", ".", "..", "%2e", "%2E", "%2f", "%2F", "%5c", "%5C", "%25", "%252f",
  "%09", "%0a", "%20", "%", "?", "#", "&", "=", "@", ":", "\t", " ", "\u3000",
  "evil.example", "mypage", "한", "%ED%95%9C", "a", "0",
];

describe("safeRedirectPath — 멱등성 (재적용해도 결과가 같다)", () => {
  const inputs = [...BYPASSES.map(([, raw]) => raw), ...ALLOWED.map(([raw]) => raw)];
  for (const raw of inputs) {
    it(`멱등: ${JSON.stringify(raw.slice(0, 40))}`, () => {
      const out = safeRedirectPath(raw);
      expect(safeRedirectPath(out)).toBe(out);
    });
  }

  it("결정적 퍼징 20,000건: 출력은 같은 origin 이고 재적용해도 바뀌지 않는다", () => {
    const rand = mulberry32(0x5ec3);
    for (let i = 0; i < 20_000; i += 1) {
      const len = 1 + Math.floor(rand() * 8);
      let raw = rand() < 0.9 ? "/" : "";
      for (let j = 0; j < len; j += 1) {
        raw += FUZZ_TOKENS[Math.floor(rand() * FUZZ_TOKENS.length)];
      }
      const out = safeRedirectPath(raw);
      if (safeRedirectPath(out) !== out || new URL(out, PROD_ORIGIN).origin !== PROD_ORIGIN) {
        throw new Error(`불변식 위반: raw=${JSON.stringify(raw)} out=${JSON.stringify(out)}`);
      }
    }
  });
});

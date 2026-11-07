import { describe, expect, it } from "vitest";

import { formatDateShortKst, kstDayEndIso, kstDayStartIso } from "./kst";

describe("formatDateShortKst", () => {
  it("UTC 자정 직전 시각은 KST 로 다음 날이다 — 서버(UTC)·브라우저(KST) 동일 출력", () => {
    // 2026-09-04 15:30Z = 2026-09-05 00:30 KST. 로컬 getter 였다면 UTC 환경에서 09.04 가 나온다.
    expect(formatDateShortKst("2026-09-04T15:30:00.000Z")).toBe("2026.09.05");
  });

  it("오프셋 표기(+00:00)도 같은 인스턴트로 처리한다", () => {
    expect(formatDateShortKst("2026-09-04T14:59:59+00:00")).toBe("2026.09.04");
  });

  it("월·일을 2자리로 채운다", () => {
    expect(formatDateShortKst("2026-01-03T03:00:00Z")).toBe("2026.01.03");
  });

  it("파싱 불가 입력은 빈 문자열", () => {
    expect(formatDateShortKst("not-a-date")).toBe("");
    expect(formatDateShortKst("")).toBe("");
  });
});

describe("kstDayStartIso / kstDayEndIso", () => {
  it("KST 자정은 전날 15:00Z 다 — UTC 자정 해석이면 KST 00~09시 건이 빠진다", () => {
    expect(kstDayStartIso("2026-11-07")).toBe("2026-11-06T15:00:00.000Z");
  });

  it("KST 하루 끝은 그날 14:59:59.999Z 다", () => {
    expect(kstDayEndIso("2026-11-07")).toBe("2026-11-07T14:59:59.999Z");
  });

  it("월초·연초 경계도 전날(전년)로 넘어간다", () => {
    expect(kstDayStartIso("2027-01-01")).toBe("2026-12-31T15:00:00.000Z");
    expect(kstDayEndIso("2026-02-28")).toBe("2026-02-28T14:59:59.999Z");
  });

  it("형식이 틀리거나 존재하지 않는 날짜는 RangeError", () => {
    expect(() => kstDayStartIso("")).toThrow(RangeError);
    expect(() => kstDayStartIso("2026/11/07")).toThrow(RangeError);
    expect(() => kstDayEndIso("2026-13-01")).toThrow(RangeError);
  });
});

/**
 * KST(Asia/Seoul) 고정 날짜 포맷.
 *
 * 서버(Vercel, UTC)와 브라우저(KST)가 **같은 문자열**을 내야 하는 SSR 텍스트용이다.
 * `getFullYear()/getDate()` 같은 로컬 getter 는 실행 환경의 timezone 을 따르므로
 * 자정 전후 시각이 서버/클라에서 다른 날짜로 찍혀 hydration 불일치(React #418)가 났다
 * (`/mypage/photos`, 2026-10-05 운영 실측).
 */
const DATE_SHORT_KST = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** ISO 문자열 → `YYYY.MM.DD`(KST). 파싱 실패는 빈 문자열. */
export function formatDateShortKst(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const parts = DATE_SHORT_KST.formatToParts(d);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}.${get("month")}.${get("day")}`;
}

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

function kstInstantIso(ymd: string, time: string): string {
  if (!YMD_RE.test(ymd)) throw new RangeError(`invalid date (YYYY-MM-DD): ${ymd}`);
  const d = new Date(`${ymd}T${time}+09:00`);
  if (Number.isNaN(d.getTime())) throw new RangeError(`invalid date (YYYY-MM-DD): ${ymd}`);
  return d.toISOString();
}

/**
 * `YYYY-MM-DD`(KST 달력 날짜) → 그 날 KST 00:00:00.000 의 ISO(UTC) 문자열.
 *
 * `new Date("YYYY-MM-DD")` 는 **UTC 자정**으로 해석돼 KST 00~09시 건이 기간 필터에서
 * 빠진다. 관리자 기간 필터(from)는 이 함수로 경계를 만든다. 형식이 틀리면 RangeError.
 */
export function kstDayStartIso(ymd: string): string {
  return kstInstantIso(ymd, "00:00:00.000");
}

/** `YYYY-MM-DD`(KST) → 그 날 KST 23:59:59.999 의 ISO(UTC) 문자열 — 기간 필터 to·만료일용. */
export function kstDayEndIso(ymd: string): string {
  return kstInstantIso(ymd, "23:59:59.999");
}

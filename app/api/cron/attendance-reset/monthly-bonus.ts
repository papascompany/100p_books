/**
 * 월 20일 이상 출석 보너스 — 적립 memo 와 중복 지급 판정 키.
 *
 * 결함(수정 전): 이미 지급했는지 `point_ledger.memo LIKE '%<YYYY-MM>%'` 로 찾았다. 같은 달 10일 달성 보너스
 * (app/api/attendance/check — memo `<YYYY-MM> 10일 달성 보너스`, reason 도 같은 attendance_bonus)도 이
 * 패턴에 걸린다. 20일 이상 출석한 사용자는 거의 모두 10일 보너스를 이미 받았으므로 "이미 지급" 으로 분류돼
 * 월 보너스가 사실상 지급되지 않았다.
 * → 적립 memo 와 조회 조건을 이 함수 하나로 묶고, 조회는 memo **정확 일치**로 한다.
 *   과거 cron 이 남긴 20일 보너스도 같은 문구라 그대로 중복으로 잡힌다.
 */
export function monthlyBonusMemo(monthKey: string): string {
  return `${monthKey} 월 출석 보너스 (20일+)`;
}

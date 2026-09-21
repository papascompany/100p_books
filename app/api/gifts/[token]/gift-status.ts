/**
 * 선물 상태 판정 — 순수 함수 (I/O 없음, 시계 주입 가능).
 *
 * 왜 분리했는가:
 *   미리보기(GET)는 **읽기 요청**이므로 상태를 바꾸면 안 된다. 예전 구현은 GET 에서도
 *   `gifts.status='expired'` 를 UPDATE 해서, 단순 링크 열람이 되돌릴 수 없는 쓰기를 유발했다
 *   (부정 gift 판정 시에도 마찬가지). 이제 "지금 보여야 할 상태" 계산과 "DB 에 기록" 을 나눠
 *   GET 은 계산만 하고, 수령(POST claim)만 기록한다.
 */
export type GiftStatus = "pending" | "claimed" | "expired";

/**
 * 조회 시점에 사용자에게 보여야 할 status — DB 를 바꾸지 않는다.
 *
 * `expires_at` 이 파싱되지 않으면(NaN) 만료로 본다. 읽을 수 없는 만료일을 "아직 유효" 로
 * 해석해 수령을 열어두지 않기 위함이다(기존 동작과 동일).
 */
export function effectiveGiftStatus(
  status: GiftStatus,
  expiresAt: string,
  now: number = Date.now(),
): GiftStatus {
  if (status !== "pending") return status;
  return Date.parse(expiresAt) >= now ? "pending" : "expired";
}

/** DB 에 `status='expired'` 를 실제로 기록해야 하는 전이인가 (claim 경로 전용). */
export function shouldPersistExpiry(
  status: GiftStatus,
  expiresAt: string,
  now: number = Date.now(),
): boolean {
  return (
    status === "pending" &&
    effectiveGiftStatus(status, expiresAt, now) === "expired"
  );
}

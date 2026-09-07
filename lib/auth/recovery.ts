/**
 * 비밀번호 재설정 진입 마커.
 *
 * `/reset-password` 는 "로그인 세션이 있다"만으로 열려선 안 된다.
 * 그러면 공용 기기에 남은 세션으로 **현재 비밀번호 확인 없이** 비밀번호를 바꿀 수 있어
 * 계정이 영구 탈취된다(실측 재현됨).
 *
 * 그래서 재설정 메일 링크가 `/api/auth/callback` 에서 세션 교환에 성공한 경우에만
 * 이 쿠키를 굽고, 페이지는 쿠키 값이 현재 세션 사용자와 일치할 때만 폼을 렌더한다.
 * = 메일함 접근을 증명한 사람만 통과한다.
 */
export const PASSWORD_RECOVERY_COOKIE = "pw_recovery";

/** 링크 클릭 직후 한 번 쓰는 값이므로 짧게 — 15분. */
export const PASSWORD_RECOVERY_MAX_AGE_SEC = 15 * 60;

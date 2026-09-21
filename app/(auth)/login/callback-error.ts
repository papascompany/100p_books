/**
 * 로그인 콜백(app/api/auth/callback)이 `/login?error=코드` 로 넘기는 에러 코드 → 한국어 안내문.
 *
 * account_deleted (DEBT-3):
 *   탈퇴(익명화)는 끝났지만 auth 단계가 남은 계정으로 카카오·이메일 링크 로그인을 시도하면, 콜백이
 *   부수효과 없이 방금 만든 세션을 끊고 이 코드로 보낸다. 세션이 없으니 "마이페이지에서 탈퇴를 다시
 *   진행" 안내는 따를 수 없다 → 로그인이 막힌 이유와 고객센터 경로를 알린다.
 *   (이미 로그인된 세션에서 쓰기 API 가 주는 410 안내는 lib/auth/session.ts ACCOUNT_DELETED_MESSAGE —
 *   두 문구의 일치는 lib/auth/session.test.ts 가 고정한다.)
 */
export const ACCOUNT_DELETED_LOGIN_MESSAGE =
  "탈퇴 처리가 끝나지 않은 계정이라 카카오·이메일 링크로는 로그인할 수 없어요. 탈퇴를 마무리하려면 고객센터로 문의해 주세요.";

export function callbackErrorMessage(code: string): string {
  switch (code) {
    case "callback_failed":
      return "로그인 처리 중 문제가 발생했어요. 잠시 후 다시 시도해주세요.";
    case "account_deleted":
      return ACCOUNT_DELETED_LOGIN_MESSAGE;
    default:
      return "로그인에 실패했어요. 다시 시도해주세요.";
  }
}

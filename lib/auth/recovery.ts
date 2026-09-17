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
 *
 * 이 파일은 서버(콜백 라우트·페이지)와 클라이언트(LoginForm)가 함께 import 하므로
 * 순수 상수·함수만 둔다 (`server-only` 금지).
 */
export const PASSWORD_RECOVERY_COOKIE = "pw_recovery";

/** 링크 클릭 직후 한 번 쓰는 값이므로 짧게 — 15분. */
export const PASSWORD_RECOVERY_MAX_AGE_SEC = 15 * 60;

/** 재설정 폼 경로. resetPasswordForEmail 의 redirectTo(next) 와 마커 판정이 같은 값을 쓴다. */
export const PASSWORD_RECOVERY_PATH = "/reset-password";

/** Supabase Auth(GoTrue) 가 재설정 메일 링크로 만든 세션에 기록하는 AMR method. */
const RECOVERY_AMR_METHOD = "recovery";

/**
 * 정규화된 리다이렉트 경로(safeRedirectPath 결과)가 재설정 폼인지.
 * query/hash 는 무시하고 pathname 만 정확히 비교한다 (`/reset-passwordX` 는 아님).
 */
export function isPasswordRecoveryPath(path: string): boolean {
  const pathname = path.split(/[?#]/, 1)[0] ?? "";
  return pathname === PASSWORD_RECOVERY_PATH || pathname === `${PASSWORD_RECOVERY_PATH}/`;
}

/** base64url → UTF-8 문자열. Node(런타임·테스트)와 브라우저 모두에 있는 atob/TextDecoder 사용. */
function decodeBase64Url(segment: string): string {
  const base64 = segment.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/**
 * access token(JWT) payload 의 `amr` 클레임에서 인증 방식 목록을 꺼낸다.
 *
 * 형식 (GoTrue internal/models/sessions.go AMREntry):
 *   "amr": [{ "method": "recovery", "timestamp": 1700000000 }]
 * access token hook 을 쓰는 프로젝트는 문자열 배열일 수도 있어 둘 다 받는다.
 *
 * ⚠️ 서명 검증을 하지 않는다. 호출부는 **서버가 GoTrue 로부터 직접 받은 토큰**
 *    (exchangeCodeForSession 응답)에만 사용해야 한다. 클라이언트가 보낸 토큰에 쓰지 말 것.
 */
export function readAmrMethods(accessToken: string | null | undefined): string[] {
  if (!accessToken) return [];
  const parts = accessToken.split(".");
  if (parts.length !== 3 || !parts[1]) return [];
  try {
    const payload: unknown = JSON.parse(decodeBase64Url(parts[1]));
    if (!payload || typeof payload !== "object" || !("amr" in payload)) return [];
    const amr = (payload as { amr: unknown }).amr;
    if (!Array.isArray(amr)) return [];
    const methods: string[] = [];
    for (const entry of amr) {
      if (typeof entry === "string") {
        methods.push(entry);
      } else if (
        entry &&
        typeof entry === "object" &&
        "method" in entry &&
        typeof (entry as { method: unknown }).method === "string"
      ) {
        methods.push((entry as { method: string }).method);
      }
    }
    return methods;
  } catch {
    return [];
  }
}

/**
 * 콜백에서 재설정 마커를 발급할지 결정한다 (SEC-13).
 *
 * 두 조건을 **모두** 만족해야 한다:
 *   1. 리다이렉트 대상이 재설정 폼 — 재설정 메일의 redirectTo 는 `?next=/reset-password`
 *   2. 방금 교환한 세션의 AMR 에 `recovery` — 재설정 메일 링크로 만든 세션에만 붙는다.
 *      (GoTrue verify.go: PKCE 링크의 type=recovery → flow state 인증 방식 → PKCE 교환 시
 *       AddClaimToSession(session, Recovery). OAuth 는 `oauth`, 매직링크는 `magiclink`/`otp`.)
 *
 * 1 만 보던 이전 구현은 `/login?next=/reset-password` → 카카오 OAuth 로도 마커가 발급돼,
 * 공용 기기에 남은 카카오 세션만으로 비밀번호를 설정할 수 있었다.
 */
export function shouldIssueRecoveryMarker(args: {
  target: string;
  accessToken: string | null | undefined;
}): boolean {
  if (!isPasswordRecoveryPath(args.target)) return false;
  return readAmrMethods(args.accessToken).includes(RECOVERY_AMR_METHOD);
}

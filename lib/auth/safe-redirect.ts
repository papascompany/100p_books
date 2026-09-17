/**
 * 오픈 리다이렉트 방어 — `?next=` 류 사용자 입력을 **같은 origin 의 경로**로만 정규화한다.
 *
 * 서버(콜백 라우트)와 클라이언트(LoginForm) 가 같은 규칙을 쓰도록 순수 함수로 둔다.
 * 그래서 `server-only` 를 import 하지 않는다.
 *
 * 왜 `startsWith("/") && !startsWith("//")` 로는 부족한가 (SEC-3):
 *   WHATWG URL 파서는 특수 scheme(http/https)에서 `\` 를 `/` 로 취급하고, 탭·개행을 제거한다.
 *   그래서 `/\evil.example` 이나 `/<TAB>/evil.example` 이 위 검사를 통과한 뒤
 *   `new URL(target, origin)` 에서 `https://evil.example/` 로 해석됐다.
 *   `/.//evil.example`, `/%2e%2e//evil.example` 도 경로 정규화 후 `//evil.example` 이 된다.
 *
 * 규칙 (모두 만족해야 허용, 아니면 fallback):
 *   1. 문자열이고 길이 1~MAX_LENGTH, 첫 글자가 `/`, 두 번째 글자가 `/` 도 `\` 도 아님
 *   2. 원문 전체에 백슬래시·제어문자·공백이 없음
 *   3. **경로 부분**(첫 `?`·`#` 앞)의 퍼센트 디코딩 단계별 값에 백슬래시·제어문자·공백이 없고
 *      `//` 로 시작하지 않음 (디코딩 실패 = 거부).
 *      쿼리·해시는 origin 을 바꿀 수 없으므로 디코딩 검사하지 않는다 → `?q=a%20b`, `?p=100%25` 허용.
 *      (2 에서 원문 백슬래시·제어문자를 이미 거부했으므로, 파서가 보는 경로 끝도 첫 `?`·`#` 와 같다.)
 *   4. 고정 base 로 파싱한 결과의 origin 이 base 와 같음
 *   5. 정규화 결과(pathname+search+hash)도 1~3 을 다시 통과함 → **멱등**:
 *      `safeRedirectPath(safeRedirectPath(x)) === safeRedirectPath(x)`.
 *      예) `/%2e/%2f` 는 dot segment 정규화 뒤 `/%2f`(디코딩하면 `//`)가 되므로 거부한다.
 *      LoginForm → OAuth redirectTo → 콜백에서 같은 함수를 두 번 거쳐도 경로가 조용히 바뀌지 않는다.
 */

/** 파싱 전용 고정 base. 실제 도메인과 무관하며 절대 네비게이션에 쓰지 않는다. */
const PARSE_BASE = "https://redirect-guard.invalid";
const PARSE_ORIGIN = new URL(PARSE_BASE).origin;

/** 허용 길이 상한 — 정상 내부 경로는 이보다 훨씬 짧다. */
const MAX_LENGTH = 2048;

/** 퍼센트 디코딩 반복 상한 — 이중·삼중 인코딩 변형까지 검사. */
const MAX_DECODE_ROUNDS = 3;

export const DEFAULT_REDIRECT_PATH = "/";

/** 백슬래시 · C0 제어문자 · DEL · (유니코드 포함) 공백. */
const FORBIDDEN_CHARS = /[\\\u0000-\u001f\u007f\s]/;

function hasUnsafeShape(value: string): boolean {
  return FORBIDDEN_CHARS.test(value) || value.startsWith("//");
}

/** 첫 `?`·`#` 앞 — URL 파서가 경로로 보는 부분. */
function pathPortion(value: string): string {
  const cut = value.search(/[?#]/);
  return cut === -1 ? value : value.slice(0, cut);
}

/**
 * 경로 부분의 원문 + 퍼센트 디코딩 단계별 값이 모두 안전한지 검사.
 * 디코딩이 실패하는(잘못된 % 시퀀스) 경로는 거부한다.
 */
function passesDecodedPathChecks(path: string): boolean {
  let current = path;
  for (let round = 0; round <= MAX_DECODE_ROUNDS; round += 1) {
    if (hasUnsafeShape(current)) return false;
    if (!current.includes("%")) return true;
    let decoded: string;
    try {
      decoded = decodeURIComponent(current);
    } catch {
      return false;
    }
    if (decoded === current) return true;
    current = decoded;
  }
  // 상한까지 계속 디코딩되는 입력은 정상 경로가 아니다.
  return false;
}

/** 규칙 1~3 — 원문 형태 검사. 정규화 결과에도 그대로 다시 적용한다(멱등성). */
function passesShapeChecks(value: string): boolean {
  if (value.length === 0 || value.length > MAX_LENGTH) return false;
  if (value[0] !== "/") return false;
  if (value[1] === "/" || value[1] === "\\") return false;
  if (FORBIDDEN_CHARS.test(value)) return false;
  return passesDecodedPathChecks(pathPortion(value));
}

/**
 * 사용자 입력 리다이렉트 대상을 같은 origin 경로로 정규화한다.
 *
 * @param raw      `searchParams.get("next")` 등 신뢰할 수 없는 값
 * @param fallback 거부 시 반환할 경로 (호출부가 고정 상수로 넘긴다)
 * @returns `/` 로 시작하는 pathname + search + hash
 */
export function safeRedirectPath(
  raw: string | null | undefined,
  fallback: string = DEFAULT_REDIRECT_PATH,
): string {
  if (typeof raw !== "string") return fallback;
  if (!passesShapeChecks(raw)) return fallback;

  let url: URL;
  try {
    url = new URL(raw, PARSE_BASE);
  } catch {
    return fallback;
  }
  if (url.origin !== PARSE_ORIGIN) return fallback;
  if (url.username !== "" || url.password !== "") return fallback;

  const normalized = `${url.pathname}${url.search}${url.hash}`;
  // `/.//evil`, `/%2e%2e//evil` 처럼 경로 정규화 후 protocol-relative 가 되는 경우,
  // `/%2e/%2f` 처럼 정규화 후에야 디코딩 시 `//` 가 되는 경우를 모두 차단(= 멱등성 보장).
  if (!passesShapeChecks(normalized)) {
    return fallback;
  }
  return normalized;
}

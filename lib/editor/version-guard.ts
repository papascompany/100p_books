import "server-only";

import { computeDocVersion } from "./doc-version";
import { EDIT_CONFLICT_CODE, EDIT_CONFLICT_MESSAGE } from "./edit-conflict";

/**
 * baseVersion 이 있는 PATCH 의 stale-write 방어 (마이그레이션 없이).
 *
 * 1. 서버 문서 내용 해시 ≠ baseVersion → conflict (409).
 *    단, 서버 문서가 **보내온 문서와 내용이 같으면** 충돌이 아니다(멱등 재시도).
 *    저장은 성공했는데 응답이 유실돼 클라이언트가 옛 baseVersion 을 들고 같은 문서를 다시 보내는
 *    경우다. 같은 내용을 같은 내용으로 덮으므로 잃는 것이 없다.
 * 2. 같으면 `updated_at = 읽은 값` 조건부 UPDATE(compare-and-swap) 로 쓴다.
 *    읽기와 쓰기 사이에 다른 요청이 행을 바꿨다면 0행 → 다시 읽어 1번부터 재판정.
 *    - 표지처럼 무관한 컬럼 갱신(제목 변경 등)으로 updated_at 만 바뀐 경우:
 *      내용 해시는 그대로라 새 updated_at 으로 재시도해 저장된다(거짓 충돌 없음).
 *    - 다시 읽었는데 updated_at 이 **그대로**인데도 0행이었다면 필터 표현 불일치로 보고
 *      조건 없이 한 번 쓴다(내용 해시는 방금 재확인했다). 타임스탬프 직렬화 차이로
 *      모든 저장이 막히는 사고를 막는 안전판이다.
 * 3. 재시도 한도를 넘기면: 내용이 바뀌었으면 conflict, 내용은 같은데 경합만 계속되면 error.
 */

export interface VersionedRow {
  content: unknown;
  updatedAt: string | null;
}

export type GuardIoResult<T> =
  | { ok: true; row: T | null }
  | { ok: false; message: string };

export interface VersionGuardArgs<T> {
  baseVersion: string;
  /** 보내온 문서의 내용 버전 — 서버 문서와 같으면 base 가 옛것이어도 충돌이 아니다. */
  incomingVersion?: string;
  /** 라우트가 소유권 검사 때 이미 읽은 행. */
  initial: VersionedRow;
  /** 행 재조회 — row null 이면 행이 사라짐. */
  reread: () => Promise<GuardIoResult<VersionedRow>>;
  /**
   * 쓰기. expectedUpdatedAt 이 null 이 아니면 `updated_at = expectedUpdatedAt` 조건부.
   * row null = 조건 불일치(또는 행 없음)로 0행.
   */
  write: (expectedUpdatedAt: string | null) => Promise<GuardIoResult<T>>;
  /** 테스트 주입용. 기본 computeDocVersion. */
  versionOf?: (content: unknown) => string;
  maxAttempts?: number;
}

export type VersionGuardResult<T> =
  | { kind: "written"; row: T }
  | { kind: "conflict"; currentVersion: string }
  | { kind: "not_found" }
  | { kind: "error"; message: string };

export interface StaleCheckOptions {
  /** 테스트 주입용. 기본 computeDocVersion. */
  versionOf?: (content: unknown) => string;
  /** 보내온 문서의 내용 버전(멱등 재시도 판정). */
  incomingVersion?: string;
}

/**
 * 서버 문서가 기준 버전과 같은지 — 라우트의 조기 409 판정용.
 * 서버 문서가 보내온 문서와 같으면(incomingVersion) stale 이 아니다.
 */
export function isStaleBase(
  baseVersion: string,
  currentContent: unknown,
  opts: StaleCheckOptions = {},
): { stale: false } | { stale: true; currentVersion: string } {
  const versionOf = opts.versionOf ?? computeDocVersion;
  const currentVersion = versionOf(currentContent);
  if (currentVersion === baseVersion) return { stale: false };
  if (
    opts.incomingVersion !== undefined &&
    currentVersion === opts.incomingVersion
  ) {
    return { stale: false };
  }
  return { stale: true, currentVersion };
}

export async function writeWithVersionGuard<T>(
  args: VersionGuardArgs<T>,
): Promise<VersionGuardResult<T>> {
  const staleOpts: StaleCheckOptions = {
    versionOf: args.versionOf ?? computeDocVersion,
    incomingVersion: args.incomingVersion,
  };
  const maxAttempts = Math.max(1, args.maxAttempts ?? 3);

  let current = args.initial;
  let missedWith: string | null = null;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const check = isStaleBase(args.baseVersion, current.content, staleOpts);
    if (check.stale) {
      return { kind: "conflict", currentVersion: check.currentVersion };
    }

    // 직전 CAS 가 같은 updated_at 으로 0행이었는데 재조회 결과도 그대로 → 조건 없이 쓴다.
    const expected: string | null =
      current.updatedAt === null ||
      (missedWith !== null && missedWith === current.updatedAt)
        ? null
        : current.updatedAt;

    const written = await args.write(expected);
    if (!written.ok) return { kind: "error", message: written.message };
    if (written.row !== null) return { kind: "written", row: written.row };
    // 조건 없는 쓰기가 0행 → 행 자체가 없다.
    if (expected === null) return { kind: "not_found" };

    missedWith = expected;
    const reread = await args.reread();
    if (!reread.ok) return { kind: "error", message: reread.message };
    if (reread.row === null) return { kind: "not_found" };
    current = reread.row;
  }

  // 재시도 한도 초과 — 내용이 바뀌었으면 충돌, 아니면 경합으로 저장만 실패시킨다
  // (내용이 같은데 conflict 를 돌려주면 클라이언트가 로컬 편집을 괜히 버린다).
  const last = isStaleBase(args.baseVersion, current.content, staleOpts);
  if (last.stale) {
    return { kind: "conflict", currentVersion: last.currentVersion };
  }
  return {
    kind: "error",
    message: "동시에 저장 요청이 몰려 저장하지 못했어요. 잠시 후 다시 시도해주세요.",
  };
}

export interface GuardFailureResponse {
  code: string;
  message: string;
  status: number;
  details?: { currentVersion: string };
}

/**
 * 가드가 쓰지 못한 결과 → 라우트 fail 응답 스펙.
 *
 * 0행(not_found)은 404 가 아니라 기존 저장 경로와 같은 500 `*_UPDATE_FAILED` 로 돌려준다.
 *  - 라우트는 직전에 같은 행을 읽고 소유권까지 확인했다. 그 뒤 조건 없는 UPDATE 가 0행이면
 *    RLS UPDATE 거부이거나 동시 삭제다 — "없는 리소스" 가 아니라 "저장 실패" 다.
 *  - baseVersion 없는 기존 경로(`.update().select().single()`)는 0행을 PGRST116 오류로 받아
 *    500 PAGE_UPDATE_FAILED / COVER_UPDATE_FAILED 를 냈다. 같은 사건에 코드 체계를 둘로
 *    나누면 모니터링·클라이언트 분기가 갈라진다(클라이언트는 두 경우 모두 "failed").
 */
export function guardFailureResponse(
  result: Exclude<VersionGuardResult<unknown>, { kind: "written" }>,
  update: { code: string; fallbackMessage: string },
): GuardFailureResponse {
  switch (result.kind) {
    case "conflict":
      return {
        code: EDIT_CONFLICT_CODE,
        message: EDIT_CONFLICT_MESSAGE,
        status: 409,
        details: { currentVersion: result.currentVersion },
      };
    case "not_found":
      return { code: update.code, message: update.fallbackMessage, status: 500 };
    case "error":
      return { code: update.code, message: result.message, status: 500 };
  }
}

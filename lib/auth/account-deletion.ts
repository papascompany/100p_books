/**
 * 회원 탈퇴 결정·실행 로직 (DEBT-3).
 *
 * 라우트(app/api/account/delete)에서 Supabase 호출을 주입받아 실행한다.
 * DB·Auth 클라이언트를 직접 import 하지 않으므로 단위 테스트로 순서·실패 처리를 고정할 수 있다.
 *
 * ── 왜 hard delete 가 아니라 soft delete 인가 ─────────────────────────────
 *   `admin.auth.admin.deleteUser(id)` 기본값(hard delete)은 auth.users 행을 지운다.
 *   - profiles.id → auth.users 가 ON DELETE CASCADE 라 profiles 가 사라지려 하고,
 *     orders.user_id → profiles 는 ON DELETE 절이 없어(NO ACTION) 주문 이력이 한 건이라도
 *     있으면 FK 위반으로 **auth 삭제 자체가 실패**한다 (0001_init.sql).
 *   - 주문이 없는 회원은 반대로 profiles 가 cascade 로 지워져 0010 의 "익명화 보존" 정책과 어긋난다.
 *   - Storage 객체 소유자인 사용자는 hard delete 할 수 없다 (Supabase 문서).
 *
 *   `deleteUser(id, true)`(soft delete, GoTrue adminUserDelete) 는 한 트랜잭션에서:
 *   - auth.users 를 UPDATE 만 한다 → FK cascade·NO ACTION 모두 건드리지 않음 (주문 이력 무관)
 *   - email/phone 을 사용자 id 기반 해시로 난독화, encrypted_password=null, 일회용 토큰·메타데이터 비움
 *     → 이메일+비밀번호·매직링크·재설정 메일로 더 이상 찾을 수 없음 = 로그인 불가
 *   - identities.provider_id 난독화 → 같은 카카오 계정으로 와도 기존 사용자에 매칭되지 않음
 *   - `Logout(user_id)` 로 모든 세션 삭제 → refresh token 무효. 이미 발급된 access token 으로
 *     GET /user(getUser) 를 호출해도 "Session from session_id claim in JWT does not exist" 403
 *   - 이미 soft delete 된 사용자에 다시 호출하면 아무것도 하지 않고 200 (멱등)
 *   - 이메일이 난독화되므로 같은 이메일로 신규 가입은 가능하다 (새 user id)
 *   - 단, cascade 가 없으므로 hard delete 때 함께 지워지던 콘텐츠(프로젝트·사진·공유 링크)는
 *     별도 단계(account-content-purge.ts)로 정리해야 한다.
 *   - 난독화 값은 sha256(user_id + 원래 값) 의 base64url 이다 (GoTrue obfuscateValue).
 *     user_id 가 profiles·orders 에 남아 있으므로, 후보 이메일을 아는 사람은 행을 다시 대조할 수 있다
 *     = 익명화가 아니라 **가명처리** 수준. 법정 보존기간 경과 후 hard delete 배치가 후속 과제다.
 *
 * ── 실행 순서와 재시도 ──────────────────────────────────────────────────
 *   1. profiles 익명화 (anonymize_account — deleted_at 은 coalesce 라 멱등)
 *   2. 개인 콘텐츠 정리 (공유 링크 폐기·프로필 식별 필드·미주문 프로젝트 삭제 — 멱등)
 *   3. auth soft delete (멱등, 세션 전부 삭제)
 *   4. 탈퇴 안내 메일 (best-effort — 실패해도 탈퇴는 완료)
 *
 *   익명화를 먼저 하는 이유: auth 단계가 실패해도 세션이 살아 있어 사용자가 **같은 요청으로 재시도**
 *   할 수 있고, 그 사이 deleted_at 이 이미 채워져 requireActiveUser 가드가 돈·정체성 변경을 막는다.
 *   반대 순서면 auth 성공 후 익명화 실패 시 세션이 사라져 사용자가 재시도할 방법이 없고 PII 가 남는다.
 *   콘텐츠 정리도 같은 이유로 auth 단계 **앞**에 둔다 — 실패해도 재시도할 세션이 남고,
 *   공개 공유 링크가 열린 채로 탈퇴가 "완료"되는 일이 없다.
 *
 *   auth 단계 실패는 **성공으로 응답하지 않는다** (이전 구현은 200 authDeleted:false).
 *   안내 메일은 전체 완료 후에만 보낸다 — 실패 응답 뒤 "탈퇴 완료" 메일이 가는 일을 막고,
 *   완료 후에는 세션이 없어 재요청 자체가 불가능하므로 중복 발송도 없다.
 */

export type DeletionStepResult = { error: string | null };

export interface AccountDeletionSteps {
  /** profiles 익명화 (anonymize_account RPC). 여러 번 호출해도 안전해야 한다. */
  anonymizeProfile(): Promise<DeletionStepResult>;
  /** 개인 콘텐츠 정리 (account-content-purge). 여러 번 호출해도 안전해야 한다. */
  purgePersonalContent(): Promise<DeletionStepResult>;
  /** auth.users soft delete (`deleteUser(id, true)`). 여러 번 호출해도 안전해야 한다. */
  softDeleteAuthUser(): Promise<DeletionStepResult>;
  /** 탈퇴 완료 안내 메일 enqueue. 실패는 throw 로 알리되 탈퇴 결과에는 영향 없음. */
  enqueueDeletedNotice(): Promise<void>;
}

export type AccountDeletionDecision =
  | {
      kind: "proceed";
      /** 이전 시도에서 익명화까지 끝나고 auth 단계가 실패해 다시 들어온 요청. */
      resumed: boolean;
    }
  | {
      kind: "reject";
      status: 409;
      code: "ORDERS_IN_PROGRESS";
      message: string;
      details: { blockingCount: number };
    };

/**
 * 탈퇴 진행 여부 결정.
 *
 * profiles.deleted_at 이 이미 있는데 요청이 여기까지 왔다는 것은 getUser() 가 통과했다는 뜻이다.
 * soft delete 가 끝났다면 세션이 삭제돼 getUser() 가 실패하므로, 이 상태는
 * "익명화 완료 · auth 단계 미완료" 다 → 거부하지 않고 이어서 완료한다(resumed).
 */
export function decideAccountDeletion(input: {
  profileDeletedAt: string | null | undefined;
  blockingOrderCount: number;
}): AccountDeletionDecision {
  if (input.blockingOrderCount > 0) {
    return {
      kind: "reject",
      status: 409,
      code: "ORDERS_IN_PROGRESS",
      message:
        "처리 중인 주문이 있어 탈퇴할 수 없습니다. 결제 취소 또는 배송 완료 후 다시 시도해 주세요.",
      details: { blockingCount: input.blockingOrderCount },
    };
  }
  return { kind: "proceed", resumed: Boolean(input.profileDeletedAt) };
}

export type AccountDeletionOutcome =
  | { ok: true; noticeEnqueued: boolean }
  | {
      ok: false;
      failedStep: "anonymize" | "content" | "auth";
      /** 실패 시점에 profiles 익명화가 적용돼 있는지. */
      anonymized: boolean;
      /** 서버 로그용 원문. 클라이언트 응답에는 싣지 않는다. */
      internalMessage: string;
    };

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

async function runStep(step: () => Promise<DeletionStepResult>): Promise<string | null> {
  try {
    const { error } = await step();
    return error;
  } catch (e) {
    return errorText(e) || "unknown error";
  }
}

/** 익명화 → 콘텐츠 정리 → auth soft delete → 안내 메일 순으로 실행한다. 필수 단계가 실패하면 즉시 멈춘다. */
export async function executeAccountDeletion(
  steps: AccountDeletionSteps,
): Promise<AccountDeletionOutcome> {
  const anonymizeError = await runStep(() => steps.anonymizeProfile());
  if (anonymizeError !== null) {
    return {
      ok: false,
      failedStep: "anonymize",
      anonymized: false,
      internalMessage: anonymizeError,
    };
  }

  const contentError = await runStep(() => steps.purgePersonalContent());
  if (contentError !== null) {
    return {
      ok: false,
      failedStep: "content",
      anonymized: true,
      internalMessage: contentError,
    };
  }

  const authError = await runStep(() => steps.softDeleteAuthUser());
  if (authError !== null) {
    return {
      ok: false,
      failedStep: "auth",
      anonymized: true,
      internalMessage: authError,
    };
  }

  let noticeEnqueued = false;
  try {
    await steps.enqueueDeletedNotice();
    noticeEnqueued = true;
  } catch {
    noticeEnqueued = false;
  }
  return { ok: true, noticeEnqueued };
}

export type AccountDeletionHttpResult =
  | {
      ok: true;
      status: 200;
      data: { anonymized: true; authDeleted: true; resumed: boolean };
    }
  | {
      ok: false;
      status: 500;
      code: "ANONYMIZE_FAILED" | "CONTENT_PURGE_FAILED" | "AUTH_DELETE_FAILED";
      message: string;
      details: { anonymized: boolean; retryable: true };
    };

const RETRY_MESSAGE =
  "탈퇴 처리를 끝내지 못했어요. 잠시 후 같은 방법으로 다시 시도해 주세요. 계속 실패하면 고객센터로 문의해 주세요.";

/** 실행 결과 → HTTP 응답 형태. 콘텐츠 정리·auth 단계가 끝나지 않았으면 절대 2xx 가 아니다. */
export function toAccountDeletionHttpResult(
  outcome: AccountDeletionOutcome,
  resumed: boolean,
): AccountDeletionHttpResult {
  if (outcome.ok) {
    return {
      ok: true,
      status: 200,
      data: { anonymized: true, authDeleted: true, resumed },
    };
  }
  if (outcome.failedStep === "anonymize") {
    return {
      ok: false,
      status: 500,
      code: "ANONYMIZE_FAILED",
      message: "탈퇴 처리 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.",
      details: { anonymized: false, retryable: true },
    };
  }
  return {
    ok: false,
    status: 500,
    code: outcome.failedStep === "content" ? "CONTENT_PURGE_FAILED" : "AUTH_DELETE_FAILED",
    message: RETRY_MESSAGE,
    details: { anonymized: outcome.anonymized, retryable: true },
  };
}

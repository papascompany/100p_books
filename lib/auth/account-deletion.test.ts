import { describe, expect, it } from "vitest";

import {
  type AccountDeletionSteps,
  decideAccountDeletion,
  executeAccountDeletion,
  toAccountDeletionHttpResult,
} from "./account-deletion";

/** 호출 순서를 기록하는 가짜 단계. 실패시킬 단계를 지정할 수 있다. */
function makeSteps(opts: {
  anonymizeError?: string;
  contentError?: string;
  contentThrows?: boolean;
  authError?: string;
  authThrows?: boolean;
  noticeThrows?: boolean;
} = {}): { steps: AccountDeletionSteps; calls: string[] } {
  const calls: string[] = [];
  const steps: AccountDeletionSteps = {
    async anonymizeProfile() {
      calls.push("anonymize");
      return { error: opts.anonymizeError ?? null };
    },
    async purgePersonalContent() {
      calls.push("content");
      if (opts.contentThrows) throw new Error("share_tokens.delete: timeout");
      return { error: opts.contentError ?? null };
    },
    async softDeleteAuthUser() {
      calls.push("auth");
      if (opts.authThrows) throw new Error("network down");
      return { error: opts.authError ?? null };
    },
    async enqueueDeletedNotice() {
      calls.push("notice");
      if (opts.noticeThrows) throw new Error("queue down");
    },
  };
  return { steps, calls };
}

describe("decideAccountDeletion", () => {
  it("진행 중 주문이 있으면 409 거부", () => {
    const d = decideAccountDeletion({ profileDeletedAt: null, blockingOrderCount: 2 });
    expect(d).toMatchObject({
      kind: "reject",
      status: 409,
      code: "ORDERS_IN_PROGRESS",
      details: { blockingCount: 2 },
    });
  });

  it("처음 탈퇴 → proceed (resumed=false)", () => {
    expect(
      decideAccountDeletion({ profileDeletedAt: null, blockingOrderCount: 0 }),
    ).toEqual({ kind: "proceed", resumed: false });
  });

  it("익명화만 끝난 상태에서 재요청 → 거부하지 않고 이어서 완료 (resumed=true)", () => {
    expect(
      decideAccountDeletion({
        profileDeletedAt: "2026-09-17T00:00:00Z",
        blockingOrderCount: 0,
      }),
    ).toEqual({ kind: "proceed", resumed: true });
  });

  it("주문 이력(완료·취소·환불) 유무는 판단에 쓰지 않는다 — 진행 중 건수만 본다", () => {
    // soft delete 는 FK 와 무관하므로 과거 주문이 있어도 진행된다.
    expect(
      decideAccountDeletion({ profileDeletedAt: null, blockingOrderCount: 0 }).kind,
    ).toBe("proceed");
  });
});

describe("executeAccountDeletion", () => {
  it("성공: 익명화 → 콘텐츠 정리 → auth soft delete → 안내 메일 순서", async () => {
    const { steps, calls } = makeSteps();
    const outcome = await executeAccountDeletion(steps);
    expect(outcome).toEqual({ ok: true, noticeEnqueued: true });
    expect(calls).toEqual(["anonymize", "content", "auth", "notice"]);
  });

  it("콘텐츠 정리 실패(throw) → auth·메일 단계로 가지 않음 (세션이 남아 재시도 가능)", async () => {
    const { steps, calls } = makeSteps({ contentThrows: true });
    const outcome = await executeAccountDeletion(steps);
    expect(outcome).toEqual({
      ok: false,
      failedStep: "content",
      anonymized: true,
      internalMessage: "share_tokens.delete: timeout",
    });
    expect(calls).toEqual(["anonymize", "content"]);
  });

  it("콘텐츠 정리 실패(error 반환)도 같은 실패 결과", async () => {
    const { steps, calls } = makeSteps({ contentError: "projects.delete: fk" });
    expect(await executeAccountDeletion(steps)).toMatchObject({
      ok: false,
      failedStep: "content",
    });
    expect(calls).toEqual(["anonymize", "content"]);
  });

  it("익명화 실패 → 정리·auth·메일 단계로 가지 않음", async () => {
    const { steps, calls } = makeSteps({ anonymizeError: "rpc failed" });
    const outcome = await executeAccountDeletion(steps);
    expect(outcome).toEqual({
      ok: false,
      failedStep: "anonymize",
      anonymized: false,
      internalMessage: "rpc failed",
    });
    expect(calls).toEqual(["anonymize"]);
  });

  it("auth 실패(error 반환) → 실패 결과, 탈퇴 완료 메일 없음", async () => {
    const { steps, calls } = makeSteps({ authError: "Database error deleting user" });
    const outcome = await executeAccountDeletion(steps);
    expect(outcome).toMatchObject({ ok: false, failedStep: "auth", anonymized: true });
    expect(calls).toEqual(["anonymize", "content", "auth"]);
  });

  it("auth 실패(throw) 도 실패 결과로 변환", async () => {
    const { steps, calls } = makeSteps({ authThrows: true });
    const outcome = await executeAccountDeletion(steps);
    expect(outcome).toMatchObject({
      ok: false,
      failedStep: "auth",
      internalMessage: "network down",
    });
    expect(calls).toEqual(["anonymize", "content", "auth"]);
  });

  it("메일 enqueue 실패는 탈퇴 성공을 뒤집지 않는다", async () => {
    const { steps } = makeSteps({ noticeThrows: true });
    expect(await executeAccountDeletion(steps)).toEqual({
      ok: true,
      noticeEnqueued: false,
    });
  });

  it("재시도 멱등: auth 실패 후 같은 요청을 다시 보내면 필수 단계를 다시 실행해 완료한다", async () => {
    const first = makeSteps({ authError: "temporary" });
    expect((await executeAccountDeletion(first.steps)).ok).toBe(false);

    const retry = makeSteps();
    expect(await executeAccountDeletion(retry.steps)).toEqual({
      ok: true,
      noticeEnqueued: true,
    });
    // anonymize_account 는 coalesce(deleted_at) 로, 콘텐츠 정리는 남은 것만 처리해서,
    // soft delete 는 이미 삭제된 사용자에 200 no-op 으로 멱등.
    expect(retry.calls).toEqual(["anonymize", "content", "auth", "notice"]);
    // 첫 시도에서는 메일이 나가지 않았으므로 전체에서 안내 메일은 1회.
    expect([...first.calls, ...retry.calls].filter((c) => c === "notice")).toHaveLength(1);
  });
});

describe("toAccountDeletionHttpResult", () => {
  it("완료만 200", () => {
    expect(toAccountDeletionHttpResult({ ok: true, noticeEnqueued: false }, true)).toEqual({
      ok: true,
      status: 200,
      data: { anonymized: true, authDeleted: true, resumed: true },
    });
  });

  it("auth 단계 실패는 성공으로 응답하지 않는다 (이전: 200 authDeleted:false)", () => {
    const r = toAccountDeletionHttpResult(
      { ok: false, failedStep: "auth", anonymized: true, internalMessage: "secret detail" },
      false,
    );
    expect(r.ok).toBe(false);
    expect(r.status).toBe(500);
    if (!r.ok) {
      expect(r.code).toBe("AUTH_DELETE_FAILED");
      expect(r.details).toEqual({ anonymized: true, retryable: true });
      // 내부 오류 원문은 응답에 싣지 않는다.
      expect(JSON.stringify(r)).not.toContain("secret detail");
    }
  });

  it("콘텐츠 정리 실패 → CONTENT_PURGE_FAILED 500 (재시도 가능, 원문 비노출)", () => {
    const r = toAccountDeletionHttpResult(
      { ok: false, failedStep: "content", anonymized: true, internalMessage: "share_tokens.delete: rls" },
      true,
    );
    expect(r).toMatchObject({
      ok: false,
      status: 500,
      code: "CONTENT_PURGE_FAILED",
      details: { anonymized: true, retryable: true },
    });
    expect(JSON.stringify(r)).not.toContain("share_tokens");
  });

  it("익명화 실패 → ANONYMIZE_FAILED 500", () => {
    const r = toAccountDeletionHttpResult(
      { ok: false, failedStep: "anonymize", anonymized: false, internalMessage: "x" },
      false,
    );
    expect(r).toMatchObject({ ok: false, status: 500, code: "ANONYMIZE_FAILED" });
  });
});

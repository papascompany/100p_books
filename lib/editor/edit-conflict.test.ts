import { describe, expect, it } from "vitest";

import {
  PROJECT_LOCKED_MESSAGE,
  ProjectLockedError,
} from "@/lib/orders/edit-lock";

import {
  createEditLockGate,
  decideNavigationAfterSave,
  EDIT_CONFLICT_CODE,
  EDIT_CONFLICT_MESSAGE,
  interpretSaveResponse,
  PROJECT_LOCKED_CODE,
  PROJECT_LOCKED_FALLBACK_MESSAGE,
  type SaveOutcome,
} from "./edit-conflict";

describe("interpretSaveResponse", () => {
  it("200 ok → saved + 새 version", () => {
    expect(
      interpretSaveResponse(200, {
        ok: true,
        data: { id: "p", version: "v1-new" },
      }),
    ).toEqual({ kind: "saved", version: "v1-new" });
  });

  it("구 서버 응답(version 없음)도 saved — 기준은 갱신하지 않는다", () => {
    expect(interpretSaveResponse(200, { ok: true, data: { id: "p" } })).toEqual(
      { kind: "saved", version: null },
    );
  });

  it("409 EDIT_CONFLICT → conflict + currentVersion", () => {
    expect(
      interpretSaveResponse(409, {
        ok: false,
        error: {
          code: EDIT_CONFLICT_CODE,
          message: EDIT_CONFLICT_MESSAGE,
          details: { currentVersion: "v1-server" },
        },
      }),
    ).toEqual({ kind: "conflict", currentVersion: "v1-server" });
  });

  it("다른 오류·깨진 본문 → failed (409 라도 코드가 다르면 충돌 아님)", () => {
    expect(
      interpretSaveResponse(400, {
        ok: false,
        error: { code: "INVALID_PHOTO_REF", message: "사진 없음" },
      }),
    ).toEqual({ kind: "failed", message: "사진 없음" });
    expect(
      interpretSaveResponse(409, {
        ok: false,
        error: { code: "OTHER", message: "x" },
      }),
    ).toEqual({ kind: "failed", message: "x" });
    expect(interpretSaveResponse(500, null)).toEqual({
      kind: "failed",
      message: null,
    });
    expect(interpretSaveResponse(200, { ok: false })).toEqual({
      kind: "failed",
      message: null,
    });
  });
});

describe("interpretSaveResponse — 409 PROJECT_LOCKED (결제 후 편집 잠금)", () => {
  it("클라이언트 코드·기본 문구가 서버 ProjectLockedError 와 일치한다", () => {
    const err = new ProjectLockedError(["p"]);
    expect(PROJECT_LOCKED_CODE).toBe(err.code);
    expect(PROJECT_LOCKED_FALLBACK_MESSAGE).toBe(PROJECT_LOCKED_MESSAGE);
    expect(err.status).toBe(409);
  });

  it("409 PROJECT_LOCKED → locked + 서버 message 그대로", () => {
    expect(
      interpretSaveResponse(409, {
        ok: false,
        error: { code: PROJECT_LOCKED_CODE, message: "서버 안내 문구" },
      }),
    ).toEqual({ kind: "locked", message: "서버 안내 문구" });
  });

  it("message 가 비었거나 없으면 기본 안내", () => {
    expect(
      interpretSaveResponse(409, { ok: false, error: { code: PROJECT_LOCKED_CODE, message: " " } }),
    ).toEqual({ kind: "locked", message: PROJECT_LOCKED_FALLBACK_MESSAGE });
    expect(
      interpretSaveResponse(409, { ok: false, error: { code: PROJECT_LOCKED_CODE } }),
    ).toEqual({ kind: "locked", message: PROJECT_LOCKED_FALLBACK_MESSAGE });
  });

  it("상태가 409 가 아니면 코드가 같아도 잠금으로 보지 않는다 (503 조회 실패는 재시도 대상)", () => {
    expect(
      interpretSaveResponse(503, {
        ok: false,
        error: { code: "PROJECT_LOCK_CHECK_FAILED", message: "잠시 후" },
      }),
    ).toEqual({ kind: "failed", message: "잠시 후" });
  });
});

describe("decideNavigationAfterSave — 저장 결과별 이동", () => {
  const cases: Array<[SaveOutcome, ReturnType<typeof decideNavigationAfterSave>]> = [
    ["saved", "proceed"],
    ["conflict", "stay"],
    ["locked", "stay"],
    // blocked 는 새로고침 전까지 풀리지 않는다 — 확인 없이 멈추면 화면에 갇힌다.
    ["blocked", "confirm_discard"],
    ["failed", "confirm_discard"],
    ["skipped", "confirm_discard"],
  ];
  it.each(cases)("%s → %s", (outcome, expected) => {
    expect(decideNavigationAfterSave(outcome)).toBe(expected);
  });
});

describe("createEditLockGate — 잠금 안내는 1회", () => {
  it("처음 잠길 때만 true, 이후 409 는 false (토스트 반복 금지)", () => {
    const gate = createEditLockGate(null);
    expect(gate.locked).toBe(false);
    expect(gate.lock("첫 안내")).toBe(true);
    expect(gate.locked).toBe(true);
    expect(gate.message).toBe("첫 안내");
    expect(gate.lock("두 번째")).toBe(false);
    expect(gate.message).toBe("첫 안내");
  });

  it("진입 시 서버 페이지가 잠금을 알려줬으면(배너) 저장 409 에서도 다시 안내하지 않는다", () => {
    const gate = createEditLockGate("진입 안내");
    expect(gate.locked).toBe(true);
    expect(gate.lock("저장 409")).toBe(false);
    expect(gate.message).toBe("진입 안내");
  });

  it("빈 message 로 잠기면 기본 안내", () => {
    const gate = createEditLockGate(null);
    expect(gate.lock("")).toBe(true);
    expect(gate.message).toBe(PROJECT_LOCKED_FALLBACK_MESSAGE);
  });
});

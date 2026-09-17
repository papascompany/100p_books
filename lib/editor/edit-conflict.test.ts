import { describe, expect, it } from "vitest";

import {
  EDIT_CONFLICT_CODE,
  EDIT_CONFLICT_MESSAGE,
  interpretSaveResponse,
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

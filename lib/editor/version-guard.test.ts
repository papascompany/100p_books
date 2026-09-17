/**
 * stale-write 판정 (QA-2 · QA-3 서버 방어).
 * DB 대신 메모리 행을 쓰는 가짜 read/write 로 CAS·재판정 분기를 검증한다.
 */

import { describe, expect, it } from "vitest";

import { computeDocVersion } from "./doc-version";
import { EDIT_CONFLICT_CODE, EDIT_CONFLICT_MESSAGE } from "./edit-conflict";
import {
  guardFailureResponse,
  isStaleBase,
  writeWithVersionGuard,
  type GuardIoResult,
  type VersionedRow,
} from "./version-guard";

const OLD_DOC = { version: "1", objects: [{ objectId: "a" }] };
const NEW_DOC = { version: "1", objects: [{ objectId: "a" }, { objectId: "b" }] };
const INCOMING = { version: "1", objects: [] };

interface Row {
  content: unknown;
  updatedAt: string;
}

/** 메모리 행 + 호출 기록. hooks 로 "쓰기 직전 다른 요청" 을 끼워 넣는다. */
function fakeStore(
  initial: Row | null,
  opts: {
    beforeWrite?: (row: Row | null, attempt: number) => Row | null;
    /** CAS 필터가 절대 일치하지 않는 환경(타임스탬프 표현 차이) 흉내. */
    casNeverMatches?: boolean;
    writeError?: string;
    rereadError?: string;
  } = {},
) {
  let row = initial;
  let tick = 0;
  const writes: Array<string | null> = [];
  const store = {
    get row() {
      return row;
    },
    writes,
    reread: async (): Promise<GuardIoResult<VersionedRow>> => {
      if (opts.rereadError) return { ok: false, message: opts.rereadError };
      return { ok: true, row: row ? { ...row } : null };
    },
    write: async (
      expectedUpdatedAt: string | null,
    ): Promise<GuardIoResult<Row>> => {
      writes.push(expectedUpdatedAt);
      if (opts.writeError) return { ok: false, message: opts.writeError };
      if (opts.beforeWrite) row = opts.beforeWrite(row, writes.length);
      if (!row) return { ok: true, row: null };
      const matches =
        expectedUpdatedAt === null ||
        (!opts.casNeverMatches && expectedUpdatedAt === row.updatedAt);
      if (!matches) return { ok: true, row: null };
      tick += 1;
      row = { content: INCOMING, updatedAt: `saved-${tick}` };
      return { ok: true, row: { ...row } };
    },
  };
  return store;
}

describe("isStaleBase", () => {
  it("서버 내용 해시가 기준과 다르면 stale + currentVersion", () => {
    expect(isStaleBase(computeDocVersion(OLD_DOC), OLD_DOC)).toEqual({
      stale: false,
    });
    expect(isStaleBase(computeDocVersion(OLD_DOC), NEW_DOC)).toEqual({
      stale: true,
      currentVersion: computeDocVersion(NEW_DOC),
    });
  });

  it("서버 문서가 보내온 문서와 같으면 base 가 옛것이어도 stale 아님 (멱등 재시도)", () => {
    const oldBase = computeDocVersion(OLD_DOC);
    expect(
      isStaleBase(oldBase, INCOMING, {
        incomingVersion: computeDocVersion(INCOMING),
      }),
    ).toEqual({ stale: false });
    // 보내온 문서와도 다르면 여전히 stale.
    expect(
      isStaleBase(oldBase, NEW_DOC, {
        incomingVersion: computeDocVersion(INCOMING),
      }),
    ).toEqual({ stale: true, currentVersion: computeDocVersion(NEW_DOC) });
  });
});

describe("writeWithVersionGuard", () => {
  const base = computeDocVersion(OLD_DOC);

  it("기준과 같으면 읽은 updated_at 으로 조건부 저장", async () => {
    const store = fakeStore({ content: OLD_DOC, updatedAt: "t1" });
    const result = await writeWithVersionGuard({
      baseVersion: base,
      initial: store.row!,
      reread: store.reread,
      write: store.write,
    });
    expect(result.kind).toBe("written");
    expect(store.writes).toEqual(["t1"]);
  });

  it("저장 이전 화면(옛 기준) → conflict, 쓰기 시도 없음 — 최신본 덮어쓰기 금지", async () => {
    const store = fakeStore({ content: NEW_DOC, updatedAt: "t2" });
    const result = await writeWithVersionGuard({
      baseVersion: base,
      initial: store.row!,
      reread: store.reread,
      write: store.write,
    });
    expect(result).toEqual({
      kind: "conflict",
      currentVersion: computeDocVersion(NEW_DOC),
    });
    expect(store.writes).toEqual([]);
    expect(store.row!.content).toBe(NEW_DOC);
  });

  it("응답 유실 뒤 같은 문서 재시도: 서버가 이미 그 문서면 옛 base 라도 저장(200) — 로컬 편집을 버리지 않게", async () => {
    // 1차 저장은 서버에 반영됐지만 응답이 유실돼 클라이언트는 여전히 OLD 기준을 들고 있다.
    const store = fakeStore({ content: INCOMING, updatedAt: "t2" });
    const result = await writeWithVersionGuard({
      baseVersion: base,
      incomingVersion: computeDocVersion(INCOMING),
      initial: store.row!,
      reread: store.reread,
      write: store.write,
    });
    expect(result.kind).toBe("written");
    expect(store.writes).toEqual(["t2"]);
    expect(store.row!.content).toBe(INCOMING);
  });

  it("incomingVersion 이 있어도 서버 문서가 기준·보낸 문서 모두와 다르면 conflict", async () => {
    const store = fakeStore({ content: NEW_DOC, updatedAt: "t2" });
    const result = await writeWithVersionGuard({
      baseVersion: base,
      incomingVersion: computeDocVersion(INCOMING),
      initial: store.row!,
      reread: store.reread,
      write: store.write,
    });
    expect(result).toEqual({
      kind: "conflict",
      currentVersion: computeDocVersion(NEW_DOC),
    });
    expect(store.writes).toEqual([]);
  });

  it("읽기~쓰기 사이 무관한 컬럼 갱신(표지 제목 변경)은 거짓 충돌 없이 재시도로 저장", async () => {
    const store = fakeStore(
      { content: OLD_DOC, updatedAt: "t1" },
      {
        // 첫 쓰기 직전 제목 변경 → updated_at 만 바뀜
        beforeWrite: (row, attempt) =>
          attempt === 1 && row ? { ...row, updatedAt: "t1-title" } : row,
      },
    );
    const result = await writeWithVersionGuard({
      baseVersion: base,
      initial: { content: OLD_DOC, updatedAt: "t1" },
      reread: store.reread,
      write: store.write,
    });
    expect(result.kind).toBe("written");
    expect(store.writes).toEqual(["t1", "t1-title"]);
  });

  it("읽기~쓰기 사이 다른 탭이 내용을 저장했으면 conflict", async () => {
    const store = fakeStore(
      { content: OLD_DOC, updatedAt: "t1" },
      {
        beforeWrite: (row, attempt) =>
          attempt === 1 ? { content: NEW_DOC, updatedAt: "t2" } : row,
      },
    );
    const result = await writeWithVersionGuard({
      baseVersion: base,
      initial: { content: OLD_DOC, updatedAt: "t1" },
      reread: store.reread,
      write: store.write,
    });
    expect(result).toEqual({
      kind: "conflict",
      currentVersion: computeDocVersion(NEW_DOC),
    });
    expect(store.row!.content).toBe(NEW_DOC);
  });

  it("CAS 가 0행인데 행이 그대로면(필터 표현 차이) 내용 재확인 후 조건 없이 저장 — 저장이 영구히 막히지 않는다", async () => {
    const store = fakeStore(
      { content: OLD_DOC, updatedAt: "2026-09-17T08:04:05.123456+00:00" },
      { casNeverMatches: true },
    );
    const result = await writeWithVersionGuard({
      baseVersion: base,
      initial: store.row!,
      reread: store.reread,
      write: store.write,
    });
    expect(result.kind).toBe("written");
    expect(store.writes).toEqual(["2026-09-17T08:04:05.123456+00:00", null]);
  });

  it("updated_at 을 모르면 조건 없이 저장", async () => {
    const store = fakeStore({ content: OLD_DOC, updatedAt: "t1" });
    const result = await writeWithVersionGuard({
      baseVersion: base,
      initial: { content: OLD_DOC, updatedAt: null },
      reread: store.reread,
      write: store.write,
    });
    expect(result.kind).toBe("written");
    expect(store.writes).toEqual([null]);
  });

  it("행이 사라지면 not_found", async () => {
    const store = fakeStore(
      { content: OLD_DOC, updatedAt: "t1" },
      { beforeWrite: () => null },
    );
    const result = await writeWithVersionGuard({
      baseVersion: base,
      initial: { content: OLD_DOC, updatedAt: "t1" },
      reread: store.reread,
      write: store.write,
    });
    expect(result).toEqual({ kind: "not_found" });
  });

  it("DB 오류는 error 로 전달", async () => {
    const writeFail = fakeStore(
      { content: OLD_DOC, updatedAt: "t1" },
      { writeError: "boom" },
    );
    expect(
      await writeWithVersionGuard({
        baseVersion: base,
        initial: writeFail.row!,
        reread: writeFail.reread,
        write: writeFail.write,
      }),
    ).toEqual({ kind: "error", message: "boom" });

    const rereadFail = fakeStore(
      { content: OLD_DOC, updatedAt: "t1" },
      {
        rereadError: "reread boom",
        beforeWrite: (row) => (row ? { ...row, updatedAt: "t9" } : row),
      },
    );
    expect(
      await writeWithVersionGuard({
        baseVersion: base,
        initial: { content: OLD_DOC, updatedAt: "t1" },
        reread: rereadFail.reread,
        write: rereadFail.write,
      }),
    ).toEqual({ kind: "error", message: "reread boom" });
  });

  it("내용은 같은데 경합이 계속되면 conflict 가 아니라 error — 클라이언트가 편집을 버리지 않게", async () => {
    let n = 0;
    const store = fakeStore(
      { content: OLD_DOC, updatedAt: "t0" },
      {
        beforeWrite: (row) => (row ? { ...row, updatedAt: `bump-${++n}` } : row),
      },
    );
    const result = await writeWithVersionGuard({
      baseVersion: base,
      initial: { content: OLD_DOC, updatedAt: "t0" },
      reread: store.reread,
      write: store.write,
      maxAttempts: 3,
    });
    expect(result.kind).toBe("error");
    expect(store.writes).toHaveLength(3);
  });
});

describe("guardFailureResponse — 라우트 응답 코드 체계", () => {
  const PAGE = {
    code: "PAGE_UPDATE_FAILED",
    fallbackMessage: "페이지 저장에 실패했습니다.",
  };

  it("0행(RLS 거부·동시 삭제)은 404 가 아니라 기존 경로와 같은 500 *_UPDATE_FAILED", async () => {
    // RLS UPDATE 거부: 소유권 SELECT 는 통과했는데 UPDATE 는 0행을 돌려준다.
    const rlsDenied = await writeWithVersionGuard({
      baseVersion: computeDocVersion(OLD_DOC),
      initial: { content: OLD_DOC, updatedAt: "t1" },
      reread: async () => ({
        ok: true,
        row: { content: OLD_DOC, updatedAt: "t1" },
      }),
      write: async () => ({ ok: true, row: null }),
    });
    expect(rlsDenied).toEqual({ kind: "not_found" });
    if (rlsDenied.kind === "written") throw new Error("unreachable");
    expect(guardFailureResponse(rlsDenied, PAGE)).toEqual({
      code: "PAGE_UPDATE_FAILED",
      message: "페이지 저장에 실패했습니다.",
      status: 500,
    });
  });

  it("conflict 는 409 EDIT_CONFLICT + currentVersion", () => {
    expect(
      guardFailureResponse({ kind: "conflict", currentVersion: "v1-abc" }, PAGE),
    ).toEqual({
      code: EDIT_CONFLICT_CODE,
      message: EDIT_CONFLICT_MESSAGE,
      status: 409,
      details: { currentVersion: "v1-abc" },
    });
  });

  it("DB 오류는 500 *_UPDATE_FAILED + 원문 메시지", () => {
    expect(
      guardFailureResponse(
        { kind: "error", message: "boom" },
        { code: "COVER_UPDATE_FAILED", fallbackMessage: "표지 저장에 실패했습니다." },
      ),
    ).toEqual({ code: "COVER_UPDATE_FAILED", message: "boom", status: 500 });
  });
});

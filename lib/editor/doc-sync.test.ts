/**
 * 최신본 재로드 순서 회귀 테스트 (재리뷰 must_fix — CoverEditor 옛 메타 덮어쓰기).
 *
 * 재현 경로: 저장 큐 안의 최신본 재로드가 setCurrentDoc(state) 후 loadDoc 을 기다림 →
 * 기준 버전 갱신 → 큐에서 기다리던 저장이 **React 렌더 전에** 실행 → 렌더에서만 미러링되던
 * currentDocRef 가 옛 문서라 옛 widthMm/heightMm/배경 + 새 baseVersion 으로 PATCH →
 * 서버 최신 표지를 옛 메타로 덮음.
 *
 * React 렌더는 "나중에 flush 되는 작업" 으로 흉내 내고, 테스트 동안 flush 하지 않는다.
 */

import { describe, expect, it } from "vitest";

import { createSerialQueue } from "./async-gates";
import { decideLatestDoc, reloadEditorDoc } from "./doc-sync";

interface Meta {
  widthMm: number;
  backgroundColor: string;
}

const OLD_META: Meta = { widthMm: 300, backgroundColor: "#ffffff" };
const NEW_META: Meta = { widthMm: 312, backgroundColor: "#101010" };

function isMeta(v: unknown): v is Meta {
  return (
    typeof v === "object" &&
    v !== null &&
    typeof (v as Meta).widthMm === "number" &&
    typeof (v as Meta).backgroundColor === "string"
  );
}

/** 에디터 모델: 저장·재로드가 같은 직렬 큐를 쓰고, state 반영(렌더)은 지연된다. */
function makeEditor(opts: { mirrorRefOnRender: boolean }) {
  const queue = createSerialQueue();
  const pendingRenders: Array<() => void> = [];
  const metaRef = { current: OLD_META };
  const baseVersion = { current: "v-old" };
  let editSeq = 0;
  const saves: Array<{ meta: Meta; baseVersion: string }> = [];

  /** 문서 메타 커밋 — 수정 후: ref 동기 갱신 / 수정 전: 렌더 때 ref 미러링. */
  const commitMeta = (next: Meta) => {
    if (opts.mirrorRefOnRender) {
      pendingRenders.push(() => {
        metaRef.current = next;
      });
    } else {
      metaRef.current = next;
      pendingRenders.push(() => undefined); // setState 도 여전히 예약된다
    }
  };

  return {
    queue,
    metaRef,
    baseVersion,
    saves,
    pendingRenders,
    edit: () => {
      editSeq += 1;
    },
    reload: (loadCanvas: (doc: Meta) => Promise<boolean>) =>
      queue.run(() =>
        reloadEditorDoc({
          doc: NEW_META,
          version: "v-new",
          commitMeta,
          loadCanvas,
          commitVersion: (v) => {
            baseVersion.current = v;
          },
          readEditSeq: () => editSeq,
        }),
      ),
    save: () =>
      queue.run(async () => {
        saves.push({ meta: metaRef.current, baseVersion: baseVersion.current });
      }),
  };
}

/** 이미지 없는 문서처럼 마이크로태스크만에 끝나는 캔버스 로드. */
const fastLoad = async (): Promise<boolean> => {
  await Promise.resolve();
  return true;
};

describe("reloadEditorDoc — 재로드 직후 큐에서 실행된 저장", () => {
  it("렌더 전에 실행돼도 새 메타 + 새 기준 버전을 함께 읽는다", async () => {
    const editor = makeEditor({ mirrorRefOnRender: false });
    const reloaded = editor.reload(fastLoad);
    const saved = editor.save();
    await Promise.all([reloaded, saved]);

    expect(editor.pendingRenders.length).toBeGreaterThan(0); // 렌더는 아직이다
    expect(editor.saves).toEqual([{ meta: NEW_META, baseVersion: "v-new" }]);
  });

  it("대조군: ref 를 렌더에서만 미러링하면 옛 메타 + 새 기준 버전으로 저장된다(수정 전 결함)", async () => {
    const editor = makeEditor({ mirrorRefOnRender: true });
    const reloaded = editor.reload(fastLoad);
    const saved = editor.save();
    await Promise.all([reloaded, saved]);

    expect(editor.saves).toEqual([{ meta: OLD_META, baseVersion: "v-new" }]);
  });

  it("메타는 캔버스 로드를 시작하기 전에 커밋된다", async () => {
    const editor = makeEditor({ mirrorRefOnRender: false });
    let metaSeenByLoad: Meta | null = null;
    await editor.reload(async () => {
      metaSeenByLoad = editor.metaRef.current;
      return true;
    });
    expect(metaSeenByLoad).toEqual(NEW_META);
  });

  it("캔버스 로드가 실패하면 기준 버전을 바꾸지 않는다(옛 캔버스가 새 기준으로 저장되지 않게)", async () => {
    const editor = makeEditor({ mirrorRefOnRender: false });
    const result = await editor.reload(async () => false);
    await editor.save();
    expect(result).toEqual({ loaded: false });
    expect(editor.saves).toEqual([{ meta: NEW_META, baseVersion: "v-old" }]);
  });

  it("로드를 기다리는 동안 편집이 있으면 editedDuringLoad — 호출자가 dirty 를 내리지 않는다", async () => {
    const editor = makeEditor({ mirrorRefOnRender: false });
    editor.edit(); // 재로드 전 편집은 로드 중 편집이 아니다
    const quiet = await editor.reload(fastLoad);
    expect(quiet).toEqual({ loaded: true, editedDuringLoad: false });

    const busy = await editor.reload(async () => {
      await Promise.resolve();
      editor.edit(); // 사진 로드 대기 중 툴바로 텍스트 추가
      return true;
    });
    expect(busy).toEqual({ loaded: true, editedDuringLoad: true });
  });
});

describe("decideLatestDoc", () => {
  it("조회 실패·version 누락은 unavailable", () => {
    expect(decideLatestDoc(undefined, "v1", isMeta)).toEqual({
      kind: "unavailable",
    });
    expect(
      decideLatestDoc({ version: 1, doc: NEW_META }, "v1", isMeta),
    ).toEqual({ kind: "unavailable" });
  });

  it("기준 버전과 같으면 up_to_date (문서가 해석 불가여도 건드리지 않는다)", () => {
    expect(
      decideLatestDoc({ version: "v1", doc: null }, "v1", isMeta),
    ).toEqual({ kind: "up_to_date" });
  });

  it("버전이 다르고 문서를 해석할 수 없으면 unreadable — 저장을 멈춰 409 반복을 끊는다", () => {
    expect(
      decideLatestDoc({ version: "v2", doc: { format: "future" } }, "v1", isMeta),
    ).toEqual({ kind: "unreadable", version: "v2" });
    expect(
      decideLatestDoc({ version: "v2", doc: null }, "v1", isMeta),
    ).toEqual({ kind: "unreadable", version: "v2" });
  });

  it("버전이 다르고 문서가 유효하면 reload", () => {
    expect(
      decideLatestDoc({ version: "v2", doc: NEW_META }, "v1", isMeta),
    ).toEqual({ kind: "reload", doc: NEW_META, version: "v2" });
  });
});

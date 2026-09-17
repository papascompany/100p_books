/**
 * Undo/Redo 히스토리 스냅샷 — 캔버스 사용자 객체의 fabric 직렬화.
 *
 * ## 왜 따로 두는가 (QA-1)
 *
 * 예전 FabricStage 는 `canvas.toJSON(FABRIC_EXTRA_PROPS)` 로 스냅샷을 만들었다.
 * 그런데 설치된 fabric 6.9.1 의 `StaticCanvas.toJSON()` 은 **인자를 무시**하고
 * `this.toObject()` 만 호출한다(FabricObject.customProperties 등록도 없었다).
 * 그래서 스냅샷에서 oType·objectId·photoId·슬롯 태그가 빠졌고, undo/redo 로 복원한
 * 객체는 태그가 없어 직렬화(fabricToPageDoc)가 전부 건너뛰었다 → 0객체 문서가 자동저장.
 *
 * 규약:
 *  - 반드시 `canvas.toObject([...FABRIC_EXTRA_PROPS])` 를 쓴다(인자가 실제로 반영되는 경로).
 *    Canvas#toObject 는 ActiveSelection 안 객체의 그룹 변환도 풀어서 기록한다.
 *  - 스냅샷에는 `objects` 만 담는다. 배경은 에디터가 PageDoc 메타로 따로 관리하므로
 *    undo 가 배경을 되돌리면 화면과 저장본이 어긋난다. 비동기 배경 로드가 스냅샷을
 *    바꿔 "편집 없이 dirty" 가 되는 것도 막는다.
 *  - chrome(excludeFromExport) 객체는 fabric 이 알아서 제외한다.
 *  - 저장 포맷이 아니라 메모리 내 히스토리지만, 직렬화 규약대로 version 필드를 둔다.
 */

import * as fabric from "fabric";

import { syncPhotoClip } from "./photo-slot";
import { FABRIC_EXTRA_PROPS, type TaggedFabricObject } from "./serialize";

export const SNAPSHOT_VERSION = "1" as const;

export type SerializedFabricObject = Record<string, unknown>;

export interface CanvasSnapshot {
  version: typeof SNAPSHOT_VERSION;
  objects: SerializedFabricObject[];
}

/** 스냅샷 원천 — fabric Canvas/StaticCanvas 의 toObject 만 쓴다. */
export interface SnapshotSourceCanvas {
  toObject: (propertiesToInclude?: string[]) => unknown;
}

export type EnlivenFn = (
  objects: SerializedFabricObject[],
) => Promise<fabric.FabricObject[]>;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * 스냅샷 직렬화 정밀도.
 * fabric 기본값(4자리)은 scaleX 등을 반올림해, 큰 원본 사진은 undo 후 슬롯 배율
 * (scaleX / slotScaleX)이 어긋나 저장 슬롯이 ~0.03mm 달라졌다. 17자리면 double 이 사실상
 * 그대로 왕복한다.
 */
const SNAPSHOT_FRACTION_DIGITS = 17;

/** 캔버스 toObject 의 objects — chrome(excludeFromExport) 을 뺀 캔버스 객체 순서와 같다. */
function serializeCanvasObjects(canvas: SnapshotSourceCanvas): unknown[] {
  // toObject 는 동기 — 전역 정밀도를 이 호출 동안만 올렸다가 되돌린다.
  const prevDigits = fabric.config.NUM_FRACTION_DIGITS;
  let raw: unknown;
  fabric.config.configure({ NUM_FRACTION_DIGITS: SNAPSHOT_FRACTION_DIGITS });
  try {
    raw = canvas.toObject([...FABRIC_EXTRA_PROPS]);
  } finally {
    fabric.config.configure({ NUM_FRACTION_DIGITS: prevDigits });
  }
  return isRecord(raw) && Array.isArray(raw.objects) ? raw.objects : [];
}

function stringifySnapshot(objects: readonly unknown[]): string {
  const snapshot: CanvasSnapshot = {
    version: SNAPSHOT_VERSION,
    objects: objects.filter(isRecord),
  };
  return JSON.stringify(snapshot);
}

/** 캔버스 → 스냅샷 JSON 문자열 (동일 상태면 동일 문자열 — no-op push 판정에 쓰인다). */
export function createSnapshot(canvas: SnapshotSourceCanvas): string {
  return stringifySnapshot(serializeCanvasObjects(canvas));
}

/** omit 판정에 객체 목록이 필요한 스냅샷 원천. */
export interface SnapshotSourceCanvasWithObjects extends SnapshotSourceCanvas {
  getObjects: () => ReadonlyArray<{ excludeFromExport?: boolean }>;
}

/**
 * omit 에 든 캔버스 객체를 **뺀 것처럼** 찍은 스냅샷 — 캔버스는 건드리지 않는다.
 *
 * 문서 로드·복원을 기다리는 동안 사용자가 추가한 객체를 보존할 때, 기준점(로드한 문서)을
 * 그 객체 없이 잡고 보존 객체는 그 위의 편집 한 단계로 push 하기 위해 쓴다
 * (객체를 뺐다 다시 넣으면 선택·텍스트 편집 상태가 풀린다).
 * toObject 의 objects 는 chrome 을 뺀 캔버스 객체 순서와 같다 — 개수가 어긋나면
 * 안전하게 전체 스냅샷으로 대신한다(보존 객체가 기준점에 포함될 뿐 유실은 없다).
 */
export function createSnapshotWithout(
  canvas: SnapshotSourceCanvasWithObjects,
  omit: ReadonlySet<unknown>,
): string {
  const serialized = serializeCanvasObjects(canvas);
  if (omit.size === 0) return stringifySnapshot(serialized);
  const exportable = canvas.getObjects().filter((o) => !o.excludeFromExport);
  if (exportable.length !== serialized.length) {
    return stringifySnapshot(serialized);
  }
  return stringifySnapshot(
    serialized.filter((_, i) => !omit.has(exportable[i])),
  );
}

export function parseSnapshot(json: string): CanvasSnapshot | null {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    return null;
  }
  if (
    !isRecord(data) ||
    data.version !== SNAPSHOT_VERSION ||
    !Array.isArray(data.objects)
  ) {
    return null;
  }
  const objects = data.objects;
  if (!objects.every((o) => isRecord(o) && typeof o.type === "string")) {
    return null;
  }
  return {
    version: SNAPSHOT_VERSION,
    objects: objects as SerializedFabricObject[],
  };
}

/**
 * 사진 src 를 최신 signed URL 로 바꾼다.
 * 스냅샷은 찍힌 시점의 URL 을 들고 있어, url-refresher 이후 오래된 항목으로 undo 하면
 * 만료 URL 로 이미지 로드가 실패한다.
 */
export function remapPhotoSources(
  objects: readonly SerializedFabricObject[],
  photoUrls: Readonly<Record<string, string>>,
): SerializedFabricObject[] {
  return objects.map((o) => {
    if (
      o.oType !== "photo" ||
      typeof o.photoId !== "string" ||
      typeof o.src !== "string"
    ) {
      return o;
    }
    const fresh = photoUrls[o.photoId];
    return fresh && fresh !== o.src ? { ...o, src: fresh } : o;
  });
}

const defaultEnliven: EnlivenFn = (objects) =>
  fabric.util.enlivenObjects<fabric.FabricObject>(objects);

/**
 * 스냅샷 → fabric 객체 배열 (캔버스에 add 하는 것은 호출자 책임).
 * 사진은 슬롯 태그로 clip 을 다시 만든다(photo-slot 규약).
 * 이미지 로드 실패 등은 reject — 호출자가 히스토리 포인터를 되돌린다.
 */
export async function restoreSnapshotObjects(
  json: string,
  opts: {
    dpi: number;
    photoUrls?: Readonly<Record<string, string>>;
    enliven?: EnlivenFn;
  },
): Promise<TaggedFabricObject[]> {
  const snapshot = parseSnapshot(json);
  if (!snapshot) {
    throw new Error("히스토리 스냅샷 형식이 올바르지 않습니다.");
  }
  const objects = opts.photoUrls
    ? remapPhotoSources(snapshot.objects, opts.photoUrls)
    : snapshot.objects;
  const enliven = opts.enliven ?? defaultEnliven;
  const restored = (await enliven(objects)) as TaggedFabricObject[];
  for (const o of restored) {
    if (o.oType === "photo" && o instanceof fabric.FabricImage) {
      syncPhotoClip(o, opts.dpi);
    }
  }
  return restored;
}

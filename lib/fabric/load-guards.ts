/**
 * 캔버스 문서 교체(loadDoc)·히스토리 복원의 비동기 구간 경합 가드.
 *
 * loadDoc·undo 복원은 새 객체(사진 로드 등)를 **기다린 뒤** 캔버스를 교체한다.
 * 그 사이 사용자는 툴바로 객체를 추가하거나 배경을 고를 수 있다.
 *
 *  1. 객체: 예전에는 교체 시점에 chrome 이 아닌 객체를 전부 지워, 기다리는 동안 추가한
 *     텍스트·사진이 조용히 사라졌다. → 교체 **시작 시점**에 있던 객체만 지우고,
 *     그 뒤에 추가된 객체는 보존해 새 문서 위에 둔다(replaceUserObjects).
 *     도구를 잠그는 대안은 쓰지 않았다: addText 는 동기 API 라 호출자(뒷표지 글 추가)가
 *     직후 선택 객체를 옮기는데, 대기·무시로 바꾸면 엉뚱한 객체를 옮기거나 클릭이 사라진다.
 *  2. 배경: 교체가 끝날 때 문서 배경을 덮으면, 기다리는 동안 사용자가 고른 배경(에디터는
 *     이미 저장 메타에 반영)이 화면에서만 되돌아가 저장본과 화면이 어긋났다.
 *     → 배경 변경을 "호출 순서" 로 판정한다(createBackgroundGate). 에디터 메타도 호출 순서로
 *     갱신되므로 둘이 같은 결론에 도달한다.
 */

/** chrome(안전선 등) 판정에 쓰는 최소 속성. */
export interface ExportFlag {
  excludeFromExport?: boolean;
}

/** 교체 시작 시점의 사용자 객체(chrome 제외) 집합. 반드시 await 전에 동기로 찍는다. */
export function captureUserObjects<T extends ExportFlag>(
  objects: readonly T[],
): ReadonlySet<T> {
  return new Set(objects.filter((o) => !o.excludeFromExport));
}

/** replaceUserObjects 가 쓰는 캔버스 연산 — fabric Canvas/StaticCanvas 가 만족한다. */
export interface ReplaceTargetCanvas<T> {
  getObjects(): T[];
  remove(...objects: T[]): T[];
  insertAt(index: number, ...objects: T[]): number;
}

export interface ReplaceUserObjectsResult<T> {
  /** 제거한 기존 객체(교체 시작 시점에 있던 것). */
  removed: T[];
  /** 교체 시작 이후 추가돼 보존한 객체 — 새 문서 객체 **위**에 남는다. */
  preserved: T[];
}

/**
 * previous(교체 시작 시점 객체)만 지우고 next 를 넣는다.
 * 그 사이 추가된 객체는 지우지 않고, next 를 그 아래(가장 먼저 보존된 객체 바로 앞)에 끼워
 * "나중에 추가한 것이 위" 라는 쌓임 순서를 유지한다. chrome 은 건드리지 않는다.
 */
export function replaceUserObjects<T extends ExportFlag>(
  canvas: ReplaceTargetCanvas<T>,
  previous: ReadonlySet<T>,
  next: readonly T[],
): ReplaceUserObjectsResult<T> {
  const current = canvas.getObjects();
  const removed: T[] = [];
  const preserved: T[] = [];
  for (const o of current) {
    if (o.excludeFromExport) continue;
    if (previous.has(o)) removed.push(o);
    else preserved.push(o);
  }
  if (removed.length > 0) canvas.remove(...removed);
  if (next.length > 0) {
    const remaining = canvas.getObjects();
    const firstPreserved =
      preserved.length > 0 ? remaining.indexOf(preserved[0] as T) : -1;
    const index = firstPreserved >= 0 ? firstPreserved : remaining.length;
    canvas.insertAt(index, ...next);
  }
  return { removed, preserved };
}

/** 배경 레이어 — 색과 이미지는 따로 바뀐다(리소스 배경 선택은 이미지만 바꾼다). */
export type BackgroundLayer = "color" | "image";

export interface BackgroundClaim {
  /** 이 요청 뒤로 같은 레이어를 바꾸는 요청이 없었는지. 요청하지 않은 레이어는 false. */
  isCurrent(layer: BackgroundLayer): boolean;
}

export interface BackgroundGate {
  /**
   * 배경 변경 요청을 **호출 시점에** 등록한다. 비동기로 적용하는 쪽은 적용 직전에
   * isCurrent 를 확인해, 더 나중에 요청된 배경을 덮지 않는다.
   */
  claim(layers: readonly BackgroundLayer[]): BackgroundClaim;
}

export function createBackgroundGate(): BackgroundGate {
  const seq: Record<BackgroundLayer, number> = { color: 0, image: 0 };
  return {
    claim(layers) {
      const mine: Partial<Record<BackgroundLayer, number>> = {};
      for (const layer of layers) {
        seq[layer] += 1;
        mine[layer] = seq[layer];
      }
      return {
        isCurrent(layer) {
          return mine[layer] !== undefined && mine[layer] === seq[layer];
        },
      };
    },
  };
}

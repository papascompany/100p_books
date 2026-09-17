/**
 * Fabric.js 캔버스용 Undo/Redo 스택.
 *
 * - 스냅샷은 lib/fabric/snapshot.ts 의 createSnapshot 결과(JSON 문자열).
 *   (fabric 6.9.1 의 canvas.toJSON() 은 인자를 무시해 커스텀 태그가 빠진다 — 쓰지 말 것.)
 * - 최대 50 스텝 (FIFO drop).
 * - 동일한 스냅샷 연속 push 는 무시(noop) — 객체 수정 이벤트 노이즈 흡수.
 *
 * FabricStage 는 connectCanvasHistory 로 객체 modified/added/removed 이벤트를
 * HistoryRecorder 에 연결하고, debounce 200ms 로 push 한다.
 */

export const HISTORY_MAX = 50;

export class HistoryStack {
  private past: string[] = [];
  private future: string[] = [];
  private current: string | null = null;

  /** 현재 스냅샷 — undo/redo 포인터. */
  get currentSnapshot(): string | null {
    return this.current;
  }

  get canUndo(): boolean {
    return this.past.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }

  /** 스택 초기화 + 초기 스냅샷 설정 (loadDoc 직후 호출). */
  reset(initial: string | null): void {
    this.past = [];
    this.future = [];
    this.current = initial;
  }

  /**
   * past/future 는 그대로 두고 현재 포인터의 내용만 바꾼다.
   * 복원·URL 갱신으로 캔버스 직렬화가 저장된 스냅샷과 글자 단위로 달라졌을 때
   * (사진 src 를 최신 signed URL 로 바꾼 경우 등) 포인터를 캔버스 실제 상태에 맞춘다.
   */
  replaceCurrent(snapshot: string): void {
    this.current = snapshot;
  }

  /**
   * 새 스냅샷 push.
   *  - current 가 동일하면 무시 (변동 없음) → false.
   *  - past 에 current 를 보존, future 폐기 → true.
   *
   * 반환값이 false 면 문서가 바뀌지 않았다는 뜻이다 — 호출자는 dirty 를 올리면 안 된다.
   */
  push(snapshot: string): boolean {
    if (snapshot === this.current) return false;

    if (this.current !== null) {
      this.past.push(this.current);
      if (this.past.length > HISTORY_MAX) {
        // 가장 오래된 항목 drop
        this.past.shift();
      }
    }
    this.current = snapshot;
    this.future = [];
    return true;
  }

  /** 가장 최근 past 로 이동. 복원할 스냅샷 반환 (null 이면 더 이상 없음). */
  undo(): string | null {
    const prev = this.past.pop();
    if (prev === undefined) return null;
    if (this.current !== null) this.future.push(this.current);
    this.current = prev;
    return prev;
  }

  redo(): string | null {
    const next = this.future.pop();
    if (next === undefined) return null;
    if (this.current !== null) this.past.push(this.current);
    this.current = next;
    return next;
  }

  /** 디버깅/테스트용 카운트. */
  size(): { past: number; future: number } {
    return { past: this.past.length, future: this.future.length };
  }
}

export interface HistoryDebouncer {
  (): void;
  /** 대기 중인 호출을 버린다. */
  cancel: () => void;
  /** 대기 중인 호출이 있으면 즉시 실행한다. */
  flush: () => void;
  /** 대기 중인 호출이 있는지. */
  readonly pending: boolean;
}

/**
 * 200ms debounce 헬퍼 — 호출자가 setTimeout 관리 부담을 덜기 위함.
 * cancel/flush 를 제공한다(로드·복원 시 취소, undo 직전 flush).
 */
export function makeHistoryDebouncer(
  fn: () => void,
  ms = 200,
): HistoryDebouncer {
  let t: ReturnType<typeof setTimeout> | null = null;
  const debounced = (() => {
    if (t) clearTimeout(t);
    t = setTimeout(() => {
      t = null;
      fn();
    }, ms);
  }) as HistoryDebouncer;
  debounced.cancel = () => {
    if (t) clearTimeout(t);
    t = null;
  };
  debounced.flush = () => {
    if (!t) return;
    clearTimeout(t);
    t = null;
    fn();
  };
  Object.defineProperty(debounced, "pending", { get: () => t !== null });
  return debounced;
}

export interface HistoryRecorderOptions {
  stack: HistoryStack;
  /** 현재 캔버스 상태 스냅샷. */
  takeSnapshot: () => string;
  debounceMs?: number;
  onHistoryChange?: (canUndo: boolean, canRedo: boolean) => void;
  /** **실제로 문서가 바뀐** push 에서만 호출된다. */
  onModified?: () => void;
}

/**
 * 캔버스 이벤트 → 히스토리 push 연결부.
 *
 * 지키는 불변식 (QA-1 · QA-4 회귀 방지):
 *  1. suspend 구간(로드·복원)에 발생한 이벤트는 push 를 **예약조차 하지 않는다**.
 *     예전에는 debounce 가 끝난 뒤(가드가 이미 풀린 뒤) 가드를 검사해서,
 *     로드만 해도 push → onModified → dirty → 자동저장이 돌았다.
 *  2. suspend 진입 시 대기 중인 push 를 취소한다 — 복원 결과가 새 항목으로 push 되어
 *     redo 스택이 날아가는 것을 막는다.
 *  3. 스냅샷이 current 와 같으면(no-op) onModified 를 부르지 않는다.
 *  4. undo/redo 직전에는 대기 중인 push 를 flush 해 방금 한 편집부터 되돌린다.
 *  5. 문서 로드 전에도 기준점이 있어야 한다(ensureBaseline). 기준점이 null 이면 첫 push 가
 *     무조건 "변경" 으로 잡혀, 로드 전에 발화한 이벤트만으로 dirty 가 됐다.
 *  6. undo/redo 포인터 이동은 캔버스 반영(markRestored) 전까지 "미반영 단계" 로 센다.
 *     연속 undo 중 마지막 복원이 실패하면 미반영 단계를 전부 되돌려(revertUnapplied)
 *     포인터를 캔버스에 실제로 보이는 상태로 맞춘다.
 */
export class HistoryRecorder {
  private readonly stack: HistoryStack;
  private readonly takeSnapshot: () => string;
  private readonly onHistoryChange?: (canUndo: boolean, canRedo: boolean) => void;
  private readonly onModified?: () => void;
  private readonly debounced: HistoryDebouncer;
  private suspendDepth = 0;
  /** 포인터는 움직였지만 캔버스에 아직 반영되지 않은 단계 수 (undo -1, redo +1). */
  private unappliedSteps = 0;

  constructor(opts: HistoryRecorderOptions) {
    this.stack = opts.stack;
    this.takeSnapshot = opts.takeSnapshot;
    this.onHistoryChange = opts.onHistoryChange;
    this.onModified = opts.onModified;
    this.debounced = makeHistoryDebouncer(
      () => void this.commit(),
      opts.debounceMs ?? 200,
    );
  }

  get suspended(): boolean {
    return this.suspendDepth > 0;
  }

  get hasPendingPush(): boolean {
    return this.debounced.pending;
  }

  /** 캔버스 object:added / modified / removed 에서 호출. */
  notifyChange(): void {
    if (this.suspendDepth > 0) return;
    this.debounced();
  }

  /** 로드·복원 구간 시작 — 반드시 resume 과 짝을 맞춘다. */
  suspend(): void {
    this.suspendDepth += 1;
    this.debounced.cancel();
  }

  resume(): void {
    this.suspendDepth = Math.max(0, this.suspendDepth - 1);
  }

  /** 대기 중인 push 폐기 (캔버스 dispose 등). */
  cancel(): void {
    this.debounced.cancel();
  }

  /**
   * 기준점이 없으면(문서 로드 전) 현재 캔버스로 만든다. dirty 를 올리지 않는다.
   * 캔버스 생성 직후 호출 — 이후 로드 전에 들어온 이벤트가 내용 변화 없이 push 돼도 no-op 이 된다.
   */
  ensureBaseline(): void {
    if (this.stack.currentSnapshot !== null) return;
    this.stack.reset(this.takeSnapshot());
    this.emitHistory();
  }

  /** 로드 완료 — 현재 캔버스를 기준점으로 스택 초기화. dirty 를 올리지 않는다. */
  resetToCurrent(): void {
    this.resetTo(this.takeSnapshot());
  }

  /**
   * 로드 완료 — 주어진 스냅샷을 기준점으로 스택 초기화. dirty 를 올리지 않는다.
   * 로드 중 사용자가 추가한 객체를 뺀 기준점을 잡을 때 쓴다(그 뒤 commit 으로 한 단계 push).
   */
  resetTo(snapshot: string): void {
    this.debounced.cancel();
    this.unappliedSteps = 0;
    this.stack.reset(snapshot);
    this.emitHistory();
  }

  /**
   * 즉시 push. 실제로 바뀌었을 때만 onModified 를 부르고 true 를 반환한다.
   * suspend 중이면 아무것도 하지 않는다.
   */
  commit(): boolean {
    if (this.suspendDepth > 0) return false;
    const changed = this.stack.push(this.takeSnapshot());
    if (!changed) return false;
    this.emitHistory();
    this.onModified?.();
    return true;
  }

  /** 대기 중 편집을 반영한 뒤 한 단계 뒤로. 복원할 스냅샷(없으면 null). */
  undo(): string | null {
    this.debounced.flush();
    const snap = this.stack.undo();
    if (snap !== null) {
      this.unappliedSteps -= 1;
      this.emitHistory();
    }
    return snap;
  }

  redo(): string | null {
    this.debounced.flush();
    const snap = this.stack.redo();
    if (snap !== null) {
      this.unappliedSteps += 1;
      this.emitHistory();
    }
    return snap;
  }

  /**
   * 최신 복원이 캔버스에 반영됨. canvasSnapshot 은 반영 직후 캔버스 스냅샷 —
   * 저장된 스냅샷과 달라도(사진 src 치환 등) 포인터 내용을 캔버스에 맞춰,
   * 다음 무해한 이벤트가 "내용이 바뀐 push" 로 잡혀 redo 를 지우고 dirty 를 만들지 않게 한다.
   */
  markRestored(canvasSnapshot: string): void {
    this.unappliedSteps = 0;
    this.stack.replaceCurrent(canvasSnapshot);
  }

  /**
   * 최신 복원이 실패함 — 캔버스는 마지막으로 반영된 상태 그대로다.
   * 그 뒤로 움직인 포인터를 전부 되돌린다(연속 undo 중 앞선 복원은 순번에 밀려 반영되지 않았다).
   */
  revertUnapplied(): void {
    while (this.unappliedSteps < 0) {
      if (this.stack.redo() === null) break;
      this.unappliedSteps += 1;
    }
    while (this.unappliedSteps > 0) {
      if (this.stack.undo() === null) break;
      this.unappliedSteps -= 1;
    }
    this.unappliedSteps = 0;
    this.emitHistory();
  }

  /**
   * 편집이 아닌 캔버스 갱신(사진 URL 교체 등) 뒤 포인터 내용을 캔버스에 맞춘다.
   * 대기 중인 실제 편집은 먼저 push 한다. 로드·복원 중이면 그쪽이 기준점을 다시 잡으므로 건너뛴다.
   */
  rebaseCurrent(): void {
    if (this.suspendDepth > 0 || this.unappliedSteps !== 0) return;
    this.debounced.flush();
    if (this.stack.currentSnapshot === null) return;
    this.stack.replaceCurrent(this.takeSnapshot());
  }

  emitHistory(): void {
    this.onHistoryChange?.(this.stack.canUndo, this.stack.canRedo);
  }
}

/** 히스토리에 연결하는 캔버스 이벤트. */
export const HISTORY_CANVAS_EVENTS = [
  "object:added",
  "object:removed",
  "object:modified",
] as const;

export type HistoryCanvasEvent = (typeof HISTORY_CANVAS_EVENTS)[number];

export interface HistoryCanvasEventPayload {
  target?: { excludeFromExport?: boolean } | null;
}

/** 히스토리 이벤트 원천 — fabric Canvas/StaticCanvas 의 on(disposer 반환) 만 쓴다. */
export interface HistoryEventSource {
  on(
    eventName: HistoryCanvasEvent,
    handler: (e: HistoryCanvasEventPayload) => void,
  ): () => void;
}

/**
 * chrome(안전선 등 excludeFromExport) 객체의 이벤트인지.
 * fabric 6.9.1 은 excludeFromExport 객체 add/remove 에도 object:added/removed 를 발화한다
 * (StaticCanvas._onObjectAdded). 스냅샷에 담기지 않는 객체라 히스토리와 무관하다.
 */
export function isChromeHistoryEvent(
  e: HistoryCanvasEventPayload | undefined,
): boolean {
  return e?.target?.excludeFromExport === true;
}

/**
 * 캔버스 이벤트 → recorder.notifyChange 연결. 해제 함수를 반환한다.
 *
 * chrome 이벤트는 걸러낸다(QA-4 회귀): 예전에는 안전선 2개의 object:added 가 200ms push 를
 * 예약했고, 첫 문서 로드(사진 로드 대기)가 200ms 를 넘기면 가드 없이 push → 기준점이 없어
 * "변경" 으로 판정 → onModified → dirty → 편집 없이 자동저장·이탈 경고가 떴다.
 */
export function connectCanvasHistory(
  canvas: HistoryEventSource,
  recorder: Pick<HistoryRecorder, "notifyChange">,
): () => void {
  const handler = (e: HistoryCanvasEventPayload) => {
    if (isChromeHistoryEvent(e)) return;
    recorder.notifyChange();
  };
  const disposers = HISTORY_CANVAS_EVENTS.map((name) =>
    canvas.on(name, handler),
  );
  return () => {
    for (const dispose of disposers) dispose();
  };
}

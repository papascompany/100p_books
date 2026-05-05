/**
 * Fabric.js 캔버스용 Undo/Redo 스택.
 *
 * - 스냅샷은 fabric.Canvas#toJSON 직렬화 결과(JSON 문자열).
 * - 최대 50 스텝 (FIFO drop).
 * - 동일한 스냅샷 연속 push 는 무시(noop) — 객체 수정 이벤트 노이즈 흡수.
 *
 * FabricStage 가 객체 modified/added/removed 이벤트에 debounce 200ms 로 push 한다.
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
   * 새 스냅샷 push.
   *  - current 가 동일하면 무시 (변동 없음).
   *  - past 에 current 를 보존, future 폐기.
   */
  push(snapshot: string): void {
    if (snapshot === this.current) return;

    if (this.current !== null) {
      this.past.push(this.current);
      if (this.past.length > HISTORY_MAX) {
        // 가장 오래된 항목 drop
        this.past.shift();
      }
    }
    this.current = snapshot;
    this.future = [];
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

/**
 * 200ms debounce 헬퍼 — 호출자가 setTimeout 관리 부담을 덜기 위함.
 */
export function makeHistoryDebouncer(
  fn: () => void,
  ms = 200,
): () => void {
  let t: ReturnType<typeof setTimeout> | null = null;
  return () => {
    if (t) clearTimeout(t);
    t = setTimeout(() => {
      t = null;
      fn();
    }, ms);
  };
}

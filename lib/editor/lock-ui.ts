/**
 * 결제 후 편집 잠금의 **화면 표현** 공용 규약 — 표지·내지 목록·페이지 에디터가 같은 판정과 문구를 쓴다.
 *
 * 역할 구분:
 *   - 서버 진입 판정: lib/editor/lock-notice.ts (server-only)
 *   - 저장 409 해석·잠금 게이트: lib/editor/edit-conflict.ts
 *   - 화면 비활성 범위·안내 문구: 이 모듈
 *
 * 클라이언트 컴포넌트가 import 하므로 server-only 가 아니다.
 */

import { PROJECT_LOCKED_FALLBACK_MESSAGE } from "./edit-conflict";

/** 읽기 전용 배너 제목 — 표지·내지 목록·페이지 에디터 공용(문구 출처는 이 상수 하나). */
export const READ_ONLY_NOTICE_TITLE = "읽기 전용으로 보고 있어요";

/** 비활성 컨트롤 옆에 붙이는 짧은 상태 표시(표지 저장 버튼의 "읽기 전용" 과 같은 톤). */
export const READ_ONLY_BADGE_LABEL = "읽기 전용";

/**
 * 잠금 안내 정규화.
 *  - null·undefined → null (잠기지 않음)
 *  - 공백뿐인 문구 → 기본 안내 (createEditLockGate 와 같은 규칙 — 빈 배너를 그리지 않는다)
 *  - 그 외 → 원문 그대로
 */
export function normalizeLockMessage(
  message: string | null | undefined,
): string | null {
  if (message === null || message === undefined) return null;
  return message.trim().length > 0 ? message : PROJECT_LOCKED_FALLBACK_MESSAGE;
}

/** 잠금 안내가 있으면 편집이 잠긴 것이다. */
export function isEditingLocked(message: string | null | undefined): boolean {
  return normalizeLockMessage(message) !== null;
}

/** 제목 인라인 편집(내지 목록 TopBar · 표지 헤더)의 잠금 상태. */
export interface TitleFieldLockState {
  /** input disabled — 저장 중이거나 잠겨 있으면 편집할 수 없다. */
  disabled: boolean;
  /** 잠겨 있을 때의 안내(정상 상태·단순 저장 중이면 null). */
  lockMessage: string | null;
  /** 잠겨 있으면 PATCH 를 보내지 않고 직전 제목으로 되돌린다(서버도 409 로 막는다). */
  canPersist: boolean;
}

export function resolveTitleFieldLockState(input: {
  /** 제목 저장 요청이 진행 중인지. */
  saving: boolean;
  /** 서버 진입 판정 또는 저장 409 가 준 잠금 안내. */
  lockMessage: string | null | undefined;
}): TitleFieldLockState {
  const lockMessage = normalizeLockMessage(input.lockMessage);
  const locked = lockMessage !== null;
  return {
    disabled: locked || input.saving,
    lockMessage,
    canPersist: !locked,
  };
}

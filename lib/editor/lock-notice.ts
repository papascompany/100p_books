import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/db/types";
import {
  fetchLockedProjectIds,
  PROJECT_LOCKED_MESSAGE,
} from "@/lib/orders/edit-lock";

/**
 * 편집 화면 진입 안내용 결제 후 편집 잠금 판정 (표지·내지·페이지 목록·업로드 서버 페이지).
 *
 * 반환: 잠겨 있으면 안내 문구, 아니면 null.
 *
 * 조회가 실패하면 null(안내 생략)이다 — 진입 화면을 에러로 막지 않는다. 쓰기는 API 가
 * assertProjectsEditable 로 fail-closed(503) 판정하고, 잠겨 있으면 저장 409 PROJECT_LOCKED 를 받은
 * 에디터가 그때 읽기 전용으로 전환한다. 즉 이 판정은 안내일 뿐 보안 경계가 아니다.
 *
 * 호출 전에 프로젝트 소유권을 검증할 것(lib/orders/edit-lock.ts 와 같은 이유 — 남의 결제 여부 비노출).
 */
export async function readProjectLockNotice(
  admin: SupabaseClient<Database>,
  projectId: string,
): Promise<string | null> {
  try {
    const locked = await fetchLockedProjectIds(admin, projectId);
    return locked.length > 0 ? PROJECT_LOCKED_MESSAGE : null;
  } catch (err) {
    console.warn(
      "[editor/lock-notice] 진입 잠금 판정 실패 — 안내 생략(쓰기는 API 가 막는다):",
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database, OrderStatus } from "@/lib/db/types";

/**
 * 결제 후 편집 잠금 (DEBT-2).
 *
 * 왜 필요한가:
 *   주문 금액·표지 규격은 주문 생성 시점의 페이지 수로 정해지는데, 인쇄 PDF 는 confirm 이후
 *   백그라운드 빌드·관리자 rebuild-pdf 에서 **그 시점의 현재** pages/photos 로 매번 새로 만든다
 *   (lib/pdf/build-job.ts). 결제 뒤에 페이지를 넣고 빼거나 사진을 휴지통에 보내면
 *   결제액·책등 폭과 실제 인쇄물이 어긋난다. RLS 는 소유권만 본다.
 *
 * 판정 기준 (lib/orders/state.ts 의 상태 머신):
 *   - 잠금: paid · in_production · shipped · delivered — 결제가 캡처됐고 환불되지 않은 주문.
 *     (canDownloadPdfs 와 같은 집합 — 인쇄 PDF 가 유효한 상태)
 *   - 허용: pending · cancelled · refunded
 *     · pending 은 결제 전이다. 결제창을 이탈한 pending 주문은 정리 수단이 없어 영구히 남으므로
 *       (DEBT-6) pending 으로 잠그면 그 포토북은 영영 편집할 수 없게 된다.
 *     · cancelled/refunded 는 종착 상태라 인쇄 대상이 아니다.
 *   - DB 에서 코드가 모르는 상태 문자열이 오면 잠금(fail-closed) — 인쇄물 불일치보다 편집 거부가 낫다.
 *
 * 사용법: 라우트에서 **소유권 검증 뒤**, 쓰기 직전에 `await assertProjectsEditable(admin, projectId)`.
 *   잠겨 있으면 ProjectLockedError(409 PROJECT_LOCKED) 를 throw → 라우트의 failFromError 가 표준 응답으로 변환.
 *   소유권보다 먼저 부르면 남의 프로젝트 결제 여부가 409/403 차이로 새므로 순서를 지킨다.
 *   여러 포토북의 사진이 섞일 수 있는 배치(라이브러리·휴지통 전체 선택)는 `excludeLockedProjectRows` 로
 *   잠긴 포토북 사진만 빼고 처리한다 — 전부 잠겨 있을 때만 409.
 *
 * 한계: 확인 → 쓰기 사이에 결제가 끝나는 경쟁은 막지 못한다(수 ms 창). 완전한 차단은 DB(RLS/트리거) 몫이다.
 */

/** 주문 상태별 편집 잠금 여부. Record 라서 OrderStatus 가 늘면 컴파일 단계에서 결정을 강제한다. */
const LOCKS_EDITING: Record<OrderStatus, boolean> = {
  pending: false,
  paid: true,
  in_production: true,
  shipped: true,
  delivered: true,
  cancelled: false,
  refunded: false,
};

/** 이 주문 상태가 프로젝트 편집을 잠그는지. 모르는 상태는 잠금(fail-closed). */
export function orderStatusLocksEditing(status: string): boolean {
  if (Object.prototype.hasOwnProperty.call(LOCKS_EDITING, status)) {
    return LOCKS_EDITING[status as OrderStatus];
  }
  return true;
}

export interface ProjectOrderStatusRow {
  project_id: string;
  status: string;
}

/** 주문 행들 중 편집을 잠그는 주문이 달린 프로젝트 id (중복 제거, 입력 순서 유지). */
export function findLockedProjectIds(rows: readonly ProjectOrderStatusRow[]): string[] {
  const locked = new Set<string>();
  for (const row of rows) {
    if (orderStatusLocksEditing(row.status)) locked.add(row.project_id);
  }
  return Array.from(locked);
}

export const PROJECT_LOCKED_MESSAGE =
  "결제가 완료된 포토북은 수정할 수 없어요. 수정이 필요하면 고객센터로 문의해 주세요.";

export class ProjectLockedError extends Error {
  status = 409;
  code = "PROJECT_LOCKED";
  constructor(public projectIds: string[]) {
    super(PROJECT_LOCKED_MESSAGE);
    this.name = "ProjectLockedError";
  }
}

/** 주문 조회 실패 — 잠금 여부를 모르면 쓰기를 통과시키지 않는다(fail-closed, 503). */
export class ProjectLockCheckError extends Error {
  status = 503;
  code = "PROJECT_LOCK_CHECK_FAILED";
  /** 서버 로그용 원문 — 응답에는 싣지 않는다. */
  constructor(public internalMessage: string) {
    super("포토북 주문 상태를 확인하지 못했어요. 잠시 후 다시 시도해 주세요.");
    this.name = "ProjectLockCheckError";
  }
}

/**
 * 주어진 프로젝트 중 결제 이후 주문이 달린 프로젝트 id (중복 제거). 조회 실패는 ProjectLockCheckError(503).
 *
 * @param admin service_role 클라이언트 — orders RLS(본인 주문만 SELECT)에 기대지 않고
 *              프로젝트에 달린 주문 전부를 본다. 호출 전에 소유권을 반드시 검증할 것.
 */
export async function fetchLockedProjectIds(
  admin: SupabaseClient<Database>,
  projectIds: string | readonly string[],
): Promise<string[]> {
  const ids = Array.from(new Set(typeof projectIds === "string" ? [projectIds] : projectIds));
  if (ids.length === 0) return [];

  const { data, error } = await admin
    .from("orders")
    .select("project_id, status")
    .in("project_id", ids);

  if (error) {
    console.warn("[orders/edit-lock] orders 조회 실패:", error.message);
    throw new ProjectLockCheckError(error.message);
  }

  return findLockedProjectIds(data ?? []);
}

/** 주어진 프로젝트들 중 하나라도 결제 이후 주문이 있으면 ProjectLockedError 를 throw. */
export async function assertProjectsEditable(
  admin: SupabaseClient<Database>,
  projectIds: string | readonly string[],
): Promise<void> {
  const locked = await fetchLockedProjectIds(admin, projectIds);
  if (locked.length > 0) {
    throw new ProjectLockedError(locked);
  }
}

/** 행을 잠긴 프로젝트 소속과 나머지로 나눈다 (입력 순서 유지). */
export function partitionRowsByProjectLock<T extends { project_id: string }>(
  rows: readonly T[],
  lockedProjectIds: readonly string[],
): { editable: T[]; locked: T[] } {
  const lockedSet = new Set(lockedProjectIds);
  const editable: T[] = [];
  const locked: T[] = [];
  for (const row of rows) {
    (lockedSet.has(row.project_id) ? locked : editable).push(row);
  }
  return { editable, locked };
}

/**
 * 여러 포토북에 걸친 배치용 — 잠긴 포토북 소속 행만 빼고 나머지를 돌려준다.
 * 한 장이 잠긴 포토북 소속이라는 이유로 배치 전체가 실패하지 않게 한다.
 * 행이 있는데 **전부** 잠겨 있으면 ProjectLockedError(409) — 단일 포토북 흐름은 assertProjectsEditable 과 같다.
 *
 * 호출 전에 모든 행의 프로젝트 소유권을 검증할 것 (assertProjectsEditable 과 같은 이유).
 */
export async function excludeLockedProjectRows<T extends { project_id: string }>(
  admin: SupabaseClient<Database>,
  rows: readonly T[],
): Promise<{ editable: T[]; skippedLocked: number }> {
  if (rows.length === 0) return { editable: [], skippedLocked: 0 };
  const lockedIds = await fetchLockedProjectIds(
    admin,
    rows.map((r) => r.project_id),
  );
  const { editable, locked } = partitionRowsByProjectLock(rows, lockedIds);
  if (editable.length === 0) {
    throw new ProjectLockedError(lockedIds);
  }
  return { editable, skippedLocked: locked.length };
}

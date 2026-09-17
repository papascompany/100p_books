/**
 * 회원 탈퇴 — 개인 콘텐츠 정리 단계 (DEBT-3 후속).
 *
 * 왜 필요한가:
 *   이전 구현의 hard delete 는 주문이 없는 회원이면 auth.users 삭제가
 *   profiles → projects → photos·pages·share_tokens 로 cascade 돼 콘텐츠 행이 함께 사라졌다.
 *   soft delete(`deleteUser(id, true)`)는 auth.users 를 UPDATE 만 하므로 cascade 가 없다.
 *   이 단계가 없으면 탈퇴 뒤에도
 *     - 공개 공유 링크(share_tokens, 기본 무기한)가 사진 썸네일·파일명·촬영일을 계속 노출하고
 *     - 작업 중이던 프로젝트·사진이 그대로 남아
 *   개인정보 처리방침 §3("탈퇴를 요청한 경우 지체 없이 파기")과 탈퇴 카드 안내에 어긋난다.
 *
 * 정리 범위 (모두 멱등 — 재시도 시 남은 것만 다시 처리):
 *   1. 본인 프로젝트의 공유 링크 전부 폐기 (주문 여부 무관 — 공개 노출 차단이 최우선)
 *   2. profiles.avatar_url · oauth_provider 비움 (anonymize_account 가 건드리지 않는 식별 필드)
 *   3. 주문에 연결되지 않은 프로젝트 삭제 → photos·pages·share_tokens·pdf_build_jobs cascade
 *      - 주문된 프로젝트는 남긴다: 전자상거래법 거래기록 보존 + orders.project_id FK(NO ACTION)
 *   4. 삭제한 프로젝트의 사진 Storage 객체 제거 (best-effort)
 *      - 본인 폴더(`${userId}/`) 키만, 그리고 삭제 후에도 다른 photos 행이 참조하지 않는 키만 지운다
 *        (선물 수령 프로젝트는 복사 실패 시 발신자 원본 키를 그대로 참조한다 — gifts/[token])
 *      - 실패해도 탈퇴는 진행한다: 행이 사라진 원본은 orphan-photos cron 이 참조를 다시 확인한 뒤 회수한다
 *
 * 1~3 중 하나라도 실패하면 throw → 탈퇴 전체가 5xx(재시도 가능)로 끝난다.
 * DB·Storage 호출은 포트로 주입받아 이 파일은 순수 로직만 가진다 (단위 테스트 대상).
 */

export type PhotoKeyRow = { storage_key: string; thumb_key: string | null };

export type PhotoKeyColumn = "storage_key" | "thumb_key";

export type PhotoBucketKind = "originals" | "thumbs";

export interface AccountContentPort {
  /** 본인 소유 프로젝트 id 전부 (페이지네이션은 구현이 책임). */
  listOwnedProjectIds(): Promise<string[]>;
  /** 주어진 프로젝트들의 share_tokens 삭제. */
  revokeShareTokens(projectIds: string[]): Promise<void>;
  /** profiles.avatar_url · oauth_provider = null. */
  clearProfileIdentityFields(): Promise<void>;
  /** 주어진 프로젝트 중 주문(orders.project_id)이 하나라도 있는 id. */
  listOrderedProjectIds(projectIds: string[]): Promise<string[]>;
  /** 주어진 프로젝트의 photos(휴지통 포함) Storage 키. */
  listPhotoKeys(projectIds: string[]): Promise<PhotoKeyRow[]>;
  /** 프로젝트 삭제 (본인 소유로 한정, cascade). */
  deleteProjects(projectIds: string[]): Promise<void>;
  /** 주어진 키 중 아직 photos 행이 참조하는 키. */
  listReferencedKeys(column: PhotoKeyColumn, keys: string[]): Promise<string[]>;
  /** Storage 객체 삭제. 없는 키는 무시돼야 한다. */
  removeStorageObjects(bucket: PhotoBucketKind, keys: string[]): Promise<void>;
}

export interface AccountContentPurgeReport {
  ownedProjects: number;
  /** 주문 이력 때문에 남긴 프로젝트 수. */
  retainedOrderedProjects: number;
  deletedProjects: number;
  removedStorageObjects: number;
  /** Storage 정리를 끝내지 못해 orphan-photos cron 에 맡긴 경우. */
  storageCleanupDeferred: boolean;
  /** 서버 로그용 (storageCleanupDeferred 일 때만). */
  storageCleanupError: string | null;
}

function unique(values: Iterable<string>): string[] {
  return Array.from(new Set(values));
}

/** 본인 폴더(`${userId}/...`) 아래 키만 남긴다. 다른 사용자 폴더의 객체는 절대 지우지 않는다. */
export function ownStorageKeys(userId: string, keys: Iterable<string | null>): string[] {
  const prefix = `${userId}/`;
  const out: string[] = [];
  for (const key of keys) {
    if (typeof key !== "string" || key.length <= prefix.length) continue;
    if (!key.startsWith(prefix)) continue;
    // 경로 조작 흔적이 있는 키는 건드리지 않는다 (서버가 만든 키에는 없다).
    if (key.includes("..") || key.includes("\\")) continue;
    out.push(key);
  }
  return unique(out);
}

async function cleanupPhotoStorage(
  userId: string,
  photos: PhotoKeyRow[],
  port: AccountContentPort,
): Promise<{ removed: number; deferred: boolean; error: string | null }> {
  const originals = ownStorageKeys(userId, photos.map((p) => p.storage_key));
  const thumbs = ownStorageKeys(userId, photos.map((p) => p.thumb_key));
  if (originals.length === 0 && thumbs.length === 0) {
    return { removed: 0, deferred: false, error: null };
  }
  try {
    // 프로젝트 행을 지운 **뒤** 참조를 확인해야 방금 지운 행이 참조로 잡히지 않는다.
    const stillOriginals = new Set(
      originals.length > 0 ? await port.listReferencedKeys("storage_key", originals) : [],
    );
    const stillThumbs = new Set(
      thumbs.length > 0 ? await port.listReferencedKeys("thumb_key", thumbs) : [],
    );
    const removableOriginals = originals.filter((k) => !stillOriginals.has(k));
    const removableThumbs = thumbs.filter((k) => !stillThumbs.has(k));

    if (removableOriginals.length > 0) {
      await port.removeStorageObjects("originals", removableOriginals);
    }
    if (removableThumbs.length > 0) {
      await port.removeStorageObjects("thumbs", removableThumbs);
    }
    return {
      removed: removableOriginals.length + removableThumbs.length,
      deferred: false,
      error: null,
    };
  } catch (e) {
    return {
      removed: 0,
      deferred: true,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

/**
 * 개인 콘텐츠 정리. 필수 단계(공유 링크·프로필 식별 필드·미주문 프로젝트) 실패는 throw.
 * 여러 번 호출해도 안전하다 — 이미 지운 것은 조회되지 않으므로 남은 것만 처리한다.
 */
export async function purgeAccountContent(
  userId: string,
  port: AccountContentPort,
): Promise<AccountContentPurgeReport> {
  const projectIds = unique(await port.listOwnedProjectIds());

  // 1) 공개 공유 링크 — 주문된 프로젝트 포함 전부
  if (projectIds.length > 0) {
    await port.revokeShareTokens(projectIds);
  }

  // 2) 프로필 식별 필드
  await port.clearProfileIdentityFields();

  if (projectIds.length === 0) {
    return {
      ownedProjects: 0,
      retainedOrderedProjects: 0,
      deletedProjects: 0,
      removedStorageObjects: 0,
      storageCleanupDeferred: false,
      storageCleanupError: null,
    };
  }

  // 3) 주문에 연결되지 않은 프로젝트만 삭제
  const ordered = new Set(await port.listOrderedProjectIds(projectIds));
  const deletable = projectIds.filter((id) => !ordered.has(id));
  const retained = projectIds.length - deletable.length;

  if (deletable.length === 0) {
    return {
      ownedProjects: projectIds.length,
      retainedOrderedProjects: retained,
      deletedProjects: 0,
      removedStorageObjects: 0,
      storageCleanupDeferred: false,
      storageCleanupError: null,
    };
  }

  // 키는 행을 지우기 전에 모아 둔다 (cascade 뒤에는 조회할 수 없다).
  const photos = await port.listPhotoKeys(deletable);
  await port.deleteProjects(deletable);

  // 4) Storage — best-effort
  const storage = await cleanupPhotoStorage(userId, photos, port);

  return {
    ownedProjects: projectIds.length,
    retainedOrderedProjects: retained,
    deletedProjects: deletable.length,
    removedStorageObjects: storage.removed,
    storageCleanupDeferred: storage.deferred,
    storageCleanupError: storage.error,
  };
}

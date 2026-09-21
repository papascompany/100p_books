/**
 * 고아 storage 객체 판정 — 순수 함수 (I/O·시계 없음).
 *
 * 왜 분리했는가:
 *   `/api/cron/orphan-photos` 는 **되돌릴 수 없는 삭제**를 한다. 판정이 한 줄만 틀려도
 *   결제 완료 포토북의 원본·썸네일이 사라진다. 그래서 "무엇을 지울지" 결정은 storage/DB 없이
 *   테스트할 수 있게 여기로 뺀다.
 *
 * 두 버킷 모두 `{userId}/{projectId}/{파일}` 규약을 쓰고, 참조 컬럼이 다르다:
 *   - `photo-originals` 객체 ← `photos.storage_key`
 *   - `photo-thumbs`    객체 ← `photos.thumb_key`
 *
 * ⚠️ 예전 구현은 원본 버킷만 스캔하고, 썸네일은 고아 원본 키의 확장자를 `.webp` 로 바꿔
 * **추측으로** 지웠다. 그 추측은 선물 수령(app/api/gifts/[token]) 폴백 때문에 위험하다 —
 * 썸네일 복사만 성공하고 원본 복사가 실패하면(또는 그 반대) 수령자 행이 **발신자 키를 그대로 참조**한다.
 * 발신자 원본이 고아가 되는 순간, 같은 경로의 썸네일은 아직 수령자 행이 참조 중인데도 함께 지워졌다.
 * 이제 썸네일도 자기 버킷을 스캔하고 `thumb_key` 참조를 직접 확인한 뒤에만 지운다.
 */

/** Supabase storage `list()` 항목 중 판정에 쓰는 필드만. */
export interface StorageEntry {
  name: string;
  /** 폴더는 null, 객체는 uuid. */
  id: string | null;
  created_at?: string;
}

/**
 * 삭제 후보인가 — 폴더가 아니고, `cutoffMs` 보다 오래된 객체인가.
 * 생성 시각을 못 읽으면 후보에서 뺀다(업로드 중인 파일을 지우지 않기 위해 보수적으로).
 */
export function isAgedObject(entry: StorageEntry, cutoffMs: number): boolean {
  if (entry.id === null) return false;
  const created = entry.created_at ? Date.parse(entry.created_at) : NaN;
  return Number.isFinite(created) && created <= cutoffMs;
}

export interface ReferencedKeys {
  /** `photos.storage_key` 로 참조되는 키 (photo-originals). */
  storageKeys: ReadonlySet<string>;
  /** `photos.thumb_key` 로 참조되는 키 (photo-thumbs). */
  thumbKeys: ReadonlySet<string>;
}

export interface BucketPlan {
  /** cutoff 를 넘긴 후보 수. */
  scanned: number;
  /** 그중 참조가 없는 고아 수. */
  orphans: number;
  /** 이번 실행에서 실제로 지울 키 (삭제 예산 적용 후). */
  toDelete: string[];
}

export interface OrphanPlan {
  originals: BucketPlan;
  thumbs: BucketPlan;
  /** 삭제 예산에 걸려 남긴 고아가 있는가. */
  deleteTruncated: boolean;
}

/** 살아 있는 행이 참조하지 않는 키만. 참조가 하나라도 있으면 남긴다. */
export function selectOrphans(
  candidates: readonly string[],
  referenced: ReadonlySet<string>,
): string[] {
  return candidates.filter((key) => !referenced.has(key));
}

/**
 * 삭제 예산(`ORPHAN_MAX_DELETES`)을 두 버킷에 나눈다.
 *
 * 총량은 그대로 유지하되(한 번에 지우는 blast radius 상한), 먼저 절반씩 보장한 뒤 남는 예산을
 * 상대 버킷에 돌려준다. 원본 고아가 수만 건이어도 썸네일 회수가 영원히 굶지 않게 하기 위함이다.
 */
export function splitDeleteBudget(
  counts: { originals: number; thumbs: number },
  maxDeletes: number,
): { originals: number; thumbs: number } {
  const max = Math.max(0, maxDeletes);
  const half = Math.floor(max / 2);
  const reservedOriginals = Math.min(counts.originals, half);
  const thumbs = Math.min(counts.thumbs, max - reservedOriginals);
  const originals = Math.min(counts.originals, max - thumbs);
  return { originals, thumbs };
}

/**
 * 버킷별 후보 + 참조 집합 → 이번 실행의 삭제 계획.
 *
 * 핵심 규약: **원본 후보는 `storage_key`, 썸네일 후보는 `thumb_key` 로만 판정한다.**
 * 버킷이 다르면 같은 경로 문자열이라도 다른 객체다.
 */
export function planOrphanDeletion(
  candidates: { originals: readonly string[]; thumbs: readonly string[] },
  referenced: ReferencedKeys,
  maxDeletes: number,
): OrphanPlan {
  const originalOrphans = selectOrphans(
    candidates.originals,
    referenced.storageKeys,
  );
  const thumbOrphans = selectOrphans(candidates.thumbs, referenced.thumbKeys);

  const budget = splitDeleteBudget(
    { originals: originalOrphans.length, thumbs: thumbOrphans.length },
    maxDeletes,
  );

  const originals: BucketPlan = {
    scanned: candidates.originals.length,
    orphans: originalOrphans.length,
    toDelete: originalOrphans.slice(0, budget.originals),
  };
  const thumbs: BucketPlan = {
    scanned: candidates.thumbs.length,
    orphans: thumbOrphans.length,
    toDelete: thumbOrphans.slice(0, budget.thumbs),
  };

  return {
    originals,
    thumbs,
    deleteTruncated:
      originals.toDelete.length < originals.orphans ||
      thumbs.toDelete.length < thumbs.orphans,
  };
}

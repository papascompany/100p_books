/**
 * 휴지통 화면의 복원·영구 삭제 응답 → 토스트 문구.
 *
 * POST /api/photos/restore 는 결제가 끝난 포토북(편집 잠금, DEBT-2)의 사진(skippedLocked)과
 * 100장 한도를 넘는 사진(skippedQuota)을 빼고 복원한다. 예전 토스트는 한도 제외만 알려, 잠긴 포토북
 * 사진이 섞이면 "N장 복원" 만 보이고 나머지가 왜 휴지통에 남았는지 알 수 없었다.
 * (전부 잠긴 포토북 소속이면 서버가 409 PROJECT_LOCKED 로 거절 — 호출자의 실패 토스트가 서버 문구를 보인다.)
 */

export interface RestoreResponseData {
  restored?: number;
  skipped?: number;
  skippedQuota?: number;
  skippedLocked?: number;
  reason?: string;
}

export interface PurgeResponseData {
  deleted?: number;
  skipped?: number;
}

export interface ResultToast {
  title: string;
  description: string;
  variant: "success" | "warning";
}

function count(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : 0;
}

export function describeRestoreResult(
  data: RestoreResponseData | undefined,
  requested: number,
): ResultToast {
  const restored = count(data?.restored);
  const skippedQuota = count(data?.skippedQuota);
  const skippedLocked = count(data?.skippedLocked);
  const skipped =
    data?.skipped !== undefined ? count(data.skipped) : Math.max(0, requested - restored);
  const skippedOther = Math.max(0, skipped - skippedQuota - skippedLocked);

  const notes: string[] = [];
  if (skippedLocked > 0) {
    notes.push(`결제가 완료된 포토북의 사진 ${skippedLocked}장은 복원할 수 없어 휴지통에 남았어요.`);
  }
  if (skippedQuota > 0) {
    notes.push(`${skippedQuota}장은 포토북 한도(100장) 초과로 제외됐어요.`);
  }
  if (skippedOther > 0) {
    notes.push(`휴지통에 없는 사진 ${skippedOther}장은 건너뛰었어요.`);
  }

  if (restored === 0) {
    return {
      title: "복원한 사진이 없어요",
      description: notes.join(" ") || "선택한 사진을 복원하지 못했어요.",
      variant: "warning",
    };
  }
  if (notes.length === 0) {
    return {
      title: "복원 완료",
      description: `${restored}장이 라이브러리로 돌아왔어요.`,
      variant: "success",
    };
  }
  return {
    title: "일부만 복원했어요",
    description: [`${restored}장을 복원했어요.`, ...notes].join(" "),
    variant: "warning",
  };
}

export function describePurgeResult(
  data: PurgeResponseData | undefined,
  requested: number,
): ResultToast {
  const deleted = count(data?.deleted);
  const skipped =
    data?.skipped !== undefined ? count(data.skipped) : Math.max(0, requested - deleted);
  const note =
    skipped > 0 ? ` 이미 삭제됐거나 휴지통에 없는 사진 ${skipped}장은 건너뛰었어요.` : "";
  if (deleted === 0) {
    return {
      title: "영구 삭제한 사진이 없어요",
      description: note.trim() || "선택한 사진을 찾을 수 없어요.",
      variant: "warning",
    };
  }
  return {
    title: "영구 삭제 완료",
    description: `${deleted}장이 영구 삭제됐어요.${note}`,
    variant: "success",
  };
}

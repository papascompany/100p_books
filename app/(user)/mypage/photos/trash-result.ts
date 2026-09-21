/**
 * POST /api/photos/trash 응답 → 사진 라이브러리 토스트 문구.
 *
 * 서버는 결제가 끝난 포토북(편집 잠금, DEBT-2)의 사진을 빼고 나머지만 옮긴다(skippedLocked).
 * 예전 토스트는 선택한 장수(selected.size)를 그대로 "휴지통에 있어요" 로 보여, 잠긴 포토북 사진이 섞인
 * 배치에서 옮긴 장수가 부풀려졌다. 서버가 실제로 옮긴 수(updated)와 제외 사유를 그대로 알린다.
 * (전부 잠긴 포토북 소속이면 서버가 409 PROJECT_LOCKED 로 거절 — 호출자의 실패 토스트가 서버 문구를 보인다.)
 */

export interface TrashResponseData {
  updated?: number;
  skipped?: number;
  skippedLocked?: number;
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

export function describeTrashResult(
  data: TrashResponseData | undefined,
  requested: number,
): ResultToast {
  const updated = count(data?.updated);
  const skippedLocked = count(data?.skippedLocked);
  // skipped 가 없으면(구 서버) 요청 수에서 추정한다.
  const skipped =
    data?.skipped !== undefined ? count(data.skipped) : Math.max(0, requested - updated);
  const skippedOther = Math.max(0, skipped - skippedLocked);

  const notes: string[] = [];
  if (skippedLocked > 0) {
    notes.push(`결제가 완료된 포토북의 사진 ${skippedLocked}장은 옮기지 않았어요.`);
  }
  if (skippedOther > 0) {
    notes.push(`이미 휴지통에 있거나 찾을 수 없는 사진 ${skippedOther}장은 건너뛰었어요.`);
  }

  if (updated === 0) {
    return {
      title: "휴지통으로 옮긴 사진이 없어요.",
      description: notes.join(" ") || "선택한 사진을 찾을 수 없어요.",
      variant: "warning",
    };
  }

  const moved = `${updated}장을 휴지통으로 옮겼어요.`;
  if (notes.length === 0) {
    return {
      title: "휴지통으로 옮겼어요.",
      description: `${updated}장이 휴지통에 있어요.`,
      variant: "success",
    };
  }
  return {
    title: skippedLocked > 0 ? "일부 사진만 휴지통으로 옮겼어요." : "휴지통으로 옮겼어요.",
    description: [moved, ...notes].join(" "),
    variant: skippedLocked > 0 ? "warning" : "success",
  };
}

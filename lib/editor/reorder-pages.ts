/**
 * 드래그&드롭 재정렬 결과 계산 (PreviewGrid 드래그 종료 핸들러에서 사용).
 *
 * `current` 에서 `draggedId` 항목을 빼 `targetIndex` 자리에 끼운 새 배열을 돌려준다.
 * 변경이 없거나(같은 자리·드래그/타깃 없음·항목 없음) 적용할 수 없으면 `null` —
 * 호출부는 null 이면 낙관적 업데이트와 onReorder 호출을 하지 않는다.
 * `current` 는 변경하지 않는다(실패 시 롤백 스냅샷으로 그대로 쓴다).
 */
export function reorderById<T extends { id: string }>(
  current: readonly T[],
  draggedId: string | null,
  targetIndex: number | null,
): T[] | null {
  if (draggedId == null || targetIndex == null) return null;
  const fromIdx = current.findIndex((p) => p.id === draggedId);
  if (fromIdx === targetIndex || fromIdx < 0) return null;
  const next = [...current];
  const [moved] = next.splice(fromIdx, 1);
  if (!moved) return null;
  next.splice(targetIndex, 0, moved);
  return next;
}

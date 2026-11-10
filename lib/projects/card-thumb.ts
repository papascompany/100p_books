/**
 * 내 포토북 카드 썸네일에 쓸 사진 고르기 (런북 백로그 "내 포토북 카드 썸네일").
 *
 * 이전 구현은 cover_json 에서 `type: "image"` + `src` 를 찾았지만, 저장 형식(PageDoc)의
 * 사진 객체는 `type: "photo"` + `photoId` 라서 썸네일이 한 번도 나오지 않았다.
 *
 * 우선순위: 표지의 첫 사진 → 프로젝트에서 가장 먼저 올린 사진 → 없음(아이콘).
 */

/** cover_json(PageDoc) 에서 첫 사진 객체의 photoId. 형식이 다르면 null. */
export function coverPhotoId(coverJson: unknown): string | null {
  if (!coverJson || typeof coverJson !== "object") return null;
  const objects = (coverJson as { objects?: unknown }).objects;
  if (!Array.isArray(objects)) return null;
  for (const obj of objects) {
    if (!obj || typeof obj !== "object") continue;
    const o = obj as { type?: unknown; photoId?: unknown };
    if (o.type === "photo" && typeof o.photoId === "string" && o.photoId) {
      return o.photoId;
    }
  }
  return null;
}

export interface CardPhotoCandidate {
  id: string;
  project_id: string;
  thumb_key: string | null;
}

/**
 * 프로젝트별 썸네일 thumb_key 결정.
 * @param projects  목록의 프로젝트(id, cover_json)
 * @param photos    해당 프로젝트들의 살아 있는 사진 — 업로드 순(created_at 오름차순)으로 정렬돼 있어야 한다.
 * @returns projectId → thumb_key
 */
export function pickCardThumbKeys(
  projects: ReadonlyArray<{ id: string; cover_json: unknown }>,
  photos: ReadonlyArray<CardPhotoCandidate>,
): Map<string, string> {
  const byId = new Map<string, CardPhotoCandidate>();
  const firstByProject = new Map<string, CardPhotoCandidate>();
  for (const p of photos) {
    byId.set(p.id, p);
    if (p.thumb_key && !firstByProject.has(p.project_id)) firstByProject.set(p.project_id, p);
  }
  const out = new Map<string, string>();
  for (const project of projects) {
    const coverId = coverPhotoId(project.cover_json);
    const cover = coverId ? byId.get(coverId) : undefined;
    // 표지 사진이 다른 프로젝트 소속이면(복사 등으로 어긋난 경우) 쓰지 않는다.
    const chosen =
      cover && cover.project_id === project.id && cover.thumb_key
        ? cover
        : firstByProject.get(project.id);
    if (chosen?.thumb_key) out.set(project.id, chosen.thumb_key);
  }
  return out;
}

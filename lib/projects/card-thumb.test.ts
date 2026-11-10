import { describe, expect, it } from "vitest";

import { coverPhotoId, pickCardThumbKeys } from "./card-thumb";

describe("coverPhotoId", () => {
  it("PageDoc 의 첫 photo 객체 photoId 를 고른다", () => {
    expect(
      coverPhotoId({
        objects: [
          { type: "text", text: "제목" },
          { type: "photo", photoId: "p2" },
          { type: "photo", photoId: "p3" },
        ],
      }),
    ).toBe("p2");
  });

  it("형식이 다르거나 비어 있으면 null", () => {
    expect(coverPhotoId(null)).toBeNull();
    expect(coverPhotoId({ objects: "x" })).toBeNull();
    expect(coverPhotoId({ objects: [{ type: "image", src: "https://x" }] })).toBeNull();
  });
});

describe("pickCardThumbKeys", () => {
  const photos = [
    { id: "a1", project_id: "A", thumb_key: "t/a1" },
    { id: "a2", project_id: "A", thumb_key: "t/a2" },
    { id: "b1", project_id: "B", thumb_key: null },
    { id: "b2", project_id: "B", thumb_key: "t/b2" },
  ];

  it("표지 사진 우선, 없으면 가장 먼저 올린 사진", () => {
    const m = pickCardThumbKeys(
      [
        { id: "A", cover_json: { objects: [{ type: "photo", photoId: "a2" }] } },
        { id: "B", cover_json: null },
        { id: "C", cover_json: null },
      ],
      photos,
    );
    expect(m.get("A")).toBe("t/a2");
    expect(m.get("B")).toBe("t/b2"); // thumb_key 없는 b1 은 건너뛴다
    expect(m.has("C")).toBe(false);
  });

  it("표지 사진이 다른 프로젝트 소속이거나 삭제됐으면 첫 사진으로 폴백", () => {
    const m = pickCardThumbKeys(
      [
        { id: "A", cover_json: { objects: [{ type: "photo", photoId: "b2" }] } },
        { id: "B", cover_json: { objects: [{ type: "photo", photoId: "gone" }] } },
      ],
      photos,
    );
    expect(m.get("A")).toBe("t/a1");
    expect(m.get("B")).toBe("t/b2");
  });
});

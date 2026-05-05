import { describe, expect, it } from "vitest";

import type { Photo } from "@/lib/db/types";
import { sortPhotos } from "./sort";

function mkPhoto(p: Partial<Photo> & { id: string }): Photo {
  return {
    id: p.id,
    project_id: p.project_id ?? "00000000-0000-0000-0000-000000000000",
    storage_key: p.storage_key ?? `${p.id}.jpg`,
    thumb_key: p.thumb_key ?? null,
    filename: p.filename ?? `${p.id}.jpg`,
    mime: p.mime ?? "image/jpeg",
    size_bytes: p.size_bytes ?? 0,
    width: p.width ?? null,
    height: p.height ?? null,
    exif_taken_at: p.exif_taken_at ?? null,
    exif_camera: p.exif_camera ?? null,
    order_idx: p.order_idx ?? 0,
    created_at: p.created_at ?? "2026-01-01T00:00:00Z",
    deleted_at: p.deleted_at ?? null,
  };
}

describe("sortPhotos — exif", () => {
  it("오름차순 + null 은 뒤로", () => {
    const input: Photo[] = [
      mkPhoto({ id: "a", exif_taken_at: "2026-03-01T00:00:00Z" }),
      mkPhoto({ id: "b", exif_taken_at: null }),
      mkPhoto({ id: "c", exif_taken_at: "2026-01-01T00:00:00Z" }),
      mkPhoto({ id: "d", exif_taken_at: "2026-02-01T00:00:00Z" }),
    ];
    const out = sortPhotos(input, "exif");
    expect(out.map((p) => p.id)).toEqual(["c", "d", "a", "b"]);
  });

  it("동률이면 파일명 natural → order_idx 로 tiebreak", () => {
    const t = "2026-01-01T00:00:00Z";
    const input: Photo[] = [
      mkPhoto({ id: "x", exif_taken_at: t, filename: "IMG_10.jpg", order_idx: 1 }),
      mkPhoto({ id: "y", exif_taken_at: t, filename: "IMG_2.jpg", order_idx: 2 }),
    ];
    const out = sortPhotos(input, "exif");
    expect(out.map((p) => p.id)).toEqual(["y", "x"]);
  });

  it("원본 배열을 변형하지 않는다", () => {
    const input: Photo[] = [
      mkPhoto({ id: "a", exif_taken_at: "2026-02-01T00:00:00Z" }),
      mkPhoto({ id: "b", exif_taken_at: "2026-01-01T00:00:00Z" }),
    ];
    const snapshot = input.map((p) => p.id);
    const out = sortPhotos(input, "exif");
    expect(out).not.toBe(input);
    expect(input.map((p) => p.id)).toEqual(snapshot);
  });
});

describe("sortPhotos — filename", () => {
  it("자연 정렬: IMG_2 < IMG_10", () => {
    const input: Photo[] = [
      mkPhoto({ id: "b", filename: "IMG_10.jpg" }),
      mkPhoto({ id: "a", filename: "IMG_2.jpg" }),
      mkPhoto({ id: "c", filename: "IMG_3.jpg" }),
    ];
    const out = sortPhotos(input, "filename");
    expect(out.map((p) => p.filename)).toEqual([
      "IMG_2.jpg",
      "IMG_3.jpg",
      "IMG_10.jpg",
    ]);
  });

  it("한글 로케일 파일명도 자연 정렬", () => {
    const input: Photo[] = [
      mkPhoto({ id: "b", filename: "여행 10.jpg" }),
      mkPhoto({ id: "a", filename: "여행 2.jpg" }),
    ];
    const out = sortPhotos(input, "filename");
    expect(out.map((p) => p.id)).toEqual(["a", "b"]);
  });

  it("대소문자 섞여도 안정", () => {
    const input: Photo[] = [
      mkPhoto({ id: "a", filename: "banana.jpg" }),
      mkPhoto({ id: "b", filename: "Apple.jpg" }),
    ];
    const out = sortPhotos(input, "filename");
    expect(out[0]!.id).toBe("b");
  });
});

describe("sortPhotos — upload", () => {
  it("order_idx 오름차순", () => {
    const input: Photo[] = [
      mkPhoto({ id: "b", order_idx: 2 }),
      mkPhoto({ id: "a", order_idx: 1 }),
      mkPhoto({ id: "c", order_idx: 3 }),
    ];
    const out = sortPhotos(input, "upload");
    expect(out.map((p) => p.id)).toEqual(["a", "b", "c"]);
  });
});

describe("sortPhotos — random", () => {
  it("같은 seed 는 재현 가능", () => {
    const input: Photo[] = Array.from({ length: 8 }, (_, i) =>
      mkPhoto({ id: String(i), order_idx: i }),
    );
    const a = sortPhotos(input, "random", 42).map((p) => p.id);
    const b = sortPhotos(input, "random", 42).map((p) => p.id);
    expect(a).toEqual(b);
  });

  it("다른 seed 는 (일반적으로) 다른 결과", () => {
    const input: Photo[] = Array.from({ length: 16 }, (_, i) =>
      mkPhoto({ id: String(i), order_idx: i }),
    );
    const a = sortPhotos(input, "random", 1).map((p) => p.id);
    const b = sortPhotos(input, "random", 2).map((p) => p.id);
    expect(a).not.toEqual(b);
  });

  it("모든 원소를 유지", () => {
    const input: Photo[] = Array.from({ length: 10 }, (_, i) =>
      mkPhoto({ id: String(i) }),
    );
    const out = sortPhotos(input, "random", 7);
    expect(out.length).toBe(input.length);
    expect(new Set(out.map((p) => p.id)).size).toBe(input.length);
  });
});

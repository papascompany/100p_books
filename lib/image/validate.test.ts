import { describe, expect, it } from "vitest";

import { MAX_FILE_BYTES } from "./constants";
import { validateFile } from "./validate";

describe("validateFile", () => {
  it("returns null for a valid JPEG within size limit", () => {
    expect(
      validateFile({ name: "sunset.jpg", type: "image/jpeg", size: 4 * 1024 * 1024 }),
    ).toBeNull();
  });

  it("accepts HEIC by extension even when MIME is empty (iOS Safari quirk)", () => {
    expect(
      validateFile({ name: "IMG_0001.HEIC", type: "", size: 10 * 1024 * 1024 }),
    ).toBeNull();
  });

  it("rejects unsupported MIME types", () => {
    const msg = validateFile({
      name: "movie.mp4",
      type: "video/mp4",
      size: 1024,
    });
    expect(msg).toMatch(/형식만 업로드/);
  });

  it("rejects files larger than the max", () => {
    const msg = validateFile({
      name: "huge.jpg",
      type: "image/jpeg",
      size: MAX_FILE_BYTES + 1,
    });
    expect(msg).toMatch(/MB를 초과/);
  });

  it("rejects empty files", () => {
    const msg = validateFile({ name: "empty.jpg", type: "image/jpeg", size: 0 });
    expect(msg).toMatch(/빈 파일|읽을 수 없습니다/);
  });
});

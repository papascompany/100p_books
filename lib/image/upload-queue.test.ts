import { beforeEach, describe, expect, it } from "vitest";

import { MAX_FILE_BYTES } from "./constants";
import {
  describeInvalidFile,
  UPLOAD_ERROR_MESSAGES,
  uploadStatusMessage,
  useUploadStore,
} from "./upload-queue";

/** 실제 바이트를 만들지 않고 크기만 흉내 낸 File. */
function fakeFile(name: string, type: string, size: number): File {
  const file = new File(["x"], name, { type });
  Object.defineProperty(file, "size", { value: size });
  return file;
}

beforeEach(() => {
  // UploadQueue 인스턴스가 없으므로 네트워크 없이 store 동작만 본다.
  useUploadStore.getState().reset();
});

describe("describeInvalidFile — 검증 실패 사유를 쉬운 말로", () => {
  it("통과하면 null", () => {
    expect(describeInvalidFile(fakeFile("a.jpg", "image/jpeg", 1000))).toBeNull();
  });

  it("용량 초과", () => {
    const mb = Math.round(MAX_FILE_BYTES / 1024 / 1024);
    expect(
      describeInvalidFile(fakeFile("a.jpg", "image/jpeg", MAX_FILE_BYTES + 1)),
    ).toBe(`${mb}MB 이하 사진만 올릴 수 있어요.`);
  });

  it("형식 불가", () => {
    expect(describeInvalidFile(fakeFile("a.gif", "image/gif", 1000))).toBe(
      "JPEG·PNG·WebP·HEIC 사진만 올릴 수 있어요.",
    );
  });

  it("빈 파일", () => {
    expect(describeInvalidFile(fakeFile("a.jpg", "image/jpeg", 0))).toBe(
      "빈 파일이라 올릴 수 없어요.",
    );
  });
});

describe("uploadStatusMessage — 상태 코드는 화면에 노출하지 않는다", () => {
  it.each([
    [403, UPLOAD_ERROR_MESSAGES.expired],
    [401, UPLOAD_ERROR_MESSAGES.signedOut],
    [429, UPLOAD_ERROR_MESSAGES.rateLimited],
    [500, UPLOAD_ERROR_MESSAGES.network],
    [0, UPLOAD_ERROR_MESSAGES.network],
  ])("%i", (status, expected) => {
    const msg = uploadStatusMessage(status);
    expect(msg).toBe(expected);
    expect(msg).not.toMatch(/\d{3}/);
  });
});

describe("검증 실패 항목 — 재시도 대상이 아니다", () => {
  it("addFiles 는 검증 실패를 invalid 로 표시하고, 유효한 파일은 대기열에 둔다", () => {
    useUploadStore
      .getState()
      .addFiles([
        fakeFile("big.jpg", "image/jpeg", MAX_FILE_BYTES + 1),
        fakeFile("ok.jpg", "image/jpeg", 1000),
      ]);
    const [big, ok] = useUploadStore.getState().items;
    expect(big?.status).toBe("error");
    expect(big?.errorKind).toBe("invalid");
    expect(ok?.status).toBe("pending");
    expect(ok?.errorKind).toBeUndefined();
  });

  it("retry 는 검증을 다시 하고, 여전히 실패면 대기열로 보내지 않는다", () => {
    useUploadStore
      .getState()
      .addFiles([fakeFile("big.jpg", "image/jpeg", MAX_FILE_BYTES + 1)]);
    const id = useUploadStore.getState().items[0]!.id;
    useUploadStore.getState().retry(id);
    const item = useUploadStore.getState().items[0]!;
    expect(item.status).toBe("error");
    expect(item.errorKind).toBe("invalid");
  });

  it("업로드 실패 항목의 retry 는 대기열로 되돌리고 실패 표시를 지운다", () => {
    useUploadStore.getState().addFiles([fakeFile("ok.jpg", "image/jpeg", 1000)]);
    const id = useUploadStore.getState().items[0]!.id;
    useUploadStore.getState()._patch(id, {
      status: "error",
      error: UPLOAD_ERROR_MESSAGES.network,
      errorKind: "upload",
      photoId: "p1",
    });
    useUploadStore.getState().retry(id);
    const item = useUploadStore.getState().items[0]!;
    expect(item.status).toBe("pending");
    expect(item.error).toBeUndefined();
    expect(item.errorKind).toBeUndefined();
    expect(item.photoId).toBeUndefined();
  });
});

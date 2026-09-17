// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * app/api/photos/complete/route.test.ts
 *
 * 고정하려는 계약(SEC-1): **바이트 형식 판정이 디코드보다 먼저다.**
 *
 * 예전 구현은 sharp 로 원본 전체를 디코드·재인코드(toBuffer)한 뒤에야 포맷을 검사했고,
 * 클라이언트 선언 MIME 만 믿었다. 그래서 AVIF 를 image/jpeg 로 올리면 libheif 까지 도달했다.
 * 이 테스트는 sharp 를 가짜로 바꿔 "허용되지 않는 바이트면 sharp 생성자조차 호출되지 않는다"와
 * "sharp 판정이 매직 바이트와 다르면 픽셀 디코드(toBuffer) 전에 멈춘다"를 확인한다.
 */

const USER_ID = "11111111-1111-4111-8111-111111111111";
const PROJECT_ID = "22222222-2222-4222-8222-222222222222";
const PHOTO_ID = "33333333-3333-4333-8333-333333333333";

const h = vi.hoisted(() => {
  const pipeline = {
    format: "jpeg" as string,
    rotate: vi.fn(),
    metadata: vi.fn(),
    toBuffer: vi.fn(),
    resize: vi.fn(),
    webp: vi.fn(),
  };
  const sharpFn = vi.fn();
  const download = vi.fn();
  const upload = vi.fn();
  const upsert = vi.fn();
  return { pipeline, sharpFn, download, upload, upsert };
});

vi.mock("@/lib/auth/session", () => ({
  requireUser: async () => ({ id: USER_ID }),
}));

vi.mock("@/lib/security/rate-limit", () => ({
  enforceRateLimit: async () => ({ success: true, limit: 30, remaining: 29, reset: 0 }),
}));

vi.mock("@/lib/db/server", () => ({
  createServerSupabase: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: { id: PROJECT_ID, user_id: USER_ID }, error: null }),
        }),
      }),
    }),
  }),
}));

vi.mock("@/lib/db/admin", () => ({
  createAdminSupabase: () => ({
    storage: {
      from: () => ({ download: h.download, upload: h.upload, remove: vi.fn() }),
    },
    from: () => ({
      select: (_cols: string, opts?: { head?: boolean }) =>
        opts?.head
          ? { eq: () => ({ is: async () => ({ count: 0, error: null }) }) }
          : { in: async () => ({ data: [], error: null }) },
      upsert: h.upsert,
    }),
  }),
}));

vi.mock("@/lib/image/sharp-safe", () => ({
  UNTRUSTED_INPUT_OPTIONS: { limitInputPixels: 200_000_000 },
  loadHardenedSharp: async () => h.sharpFn,
}));

import { POST } from "./route";

const ascii = (s: string): number[] => Array.from(s, (c) => c.charCodeAt(0));
const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, ...ascii("JFIF"), 0x00, 0x01]);
const AVIF = Uint8Array.from([0, 0, 0, 0x1c, ...ascii("ftypavif"), 0, 0, 0, 0, ...ascii("avifmif1miaf")]);
const HEIC = Uint8Array.from([0, 0, 0, 0x18, ...ascii("ftypheic"), 0, 0, 0, 0, ...ascii("mif1heic")]);
const GIF = Uint8Array.from([...ascii("GIF89a"), 1, 0, 1, 0, 0, 0, 0]);

function request(mime = "image/jpeg"): Request {
  return new Request("http://localhost/api/photos/complete", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      projectId: PROJECT_ID,
      photos: [
        {
          photoId: PHOTO_ID,
          storageKey: `${USER_ID}/${PROJECT_ID}/${PHOTO_ID}.jpg`,
          filename: "IMG_0001.jpg",
          mime,
          sizeBytes: 1234,
          orderIdx: 0,
        },
      ],
    }),
  });
}

interface CompleteBody {
  ok: boolean;
  data: {
    inserted: Array<{ id: string; mime: string }>;
    failed: Array<{ photoId: string; error: string }>;
  };
}

async function run(bytes: Uint8Array<ArrayBuffer>, mime?: string): Promise<CompleteBody> {
  h.download.mockResolvedValue({ data: new Blob([bytes]), error: null });
  const res = await POST(request(mime));
  expect(res.status).toBe(200);
  return (await res.json()) as CompleteBody;
}

beforeEach(() => {
  vi.clearAllMocks();
  const p = h.pipeline;
  p.format = "jpeg";
  p.rotate.mockReturnValue(p);
  p.resize.mockReturnValue(p);
  p.webp.mockReturnValue(p);
  p.metadata.mockImplementation(async () => ({ format: p.format, width: 40, height: 30 }));
  p.toBuffer.mockResolvedValue(Buffer.from(JPEG));
  h.sharpFn.mockReturnValue(p);
  h.upload.mockResolvedValue({ error: null });
  h.upsert.mockImplementation((rows: unknown[]) => ({
    select: async () => ({ data: rows, error: null }),
  }));
});

describe("POST /api/photos/complete — 형식 판정이 디코드보다 먼저", () => {
  it.each([
    ["AVIF", AVIF, "avif"],
    ["GIF", GIF, "gif"],
  ])("%s 바이트를 image/jpeg 로 선언해도 sharp 에 넘기지 않고 거부한다", async (_name, bytes, format) => {
    const body = await run(bytes, "image/jpeg");

    expect(body.data.failed).toEqual([
      { photoId: PHOTO_ID, error: `허용되지 않는 이미지 포맷: ${format}` },
    ]);
    expect(body.data.inserted).toEqual([]);
    expect(h.sharpFn).not.toHaveBeenCalled();
    expect(h.upload).not.toHaveBeenCalled();
    expect(h.upsert).not.toHaveBeenCalled();
  });

  it("HEIC 원본은 허용 목록이지만 서버에서 디코드하지 않고 안내와 함께 거부한다", async () => {
    const body = await run(HEIC, "image/heic");

    expect(body.data.failed).toHaveLength(1);
    expect(body.data.failed[0]!.error).toMatch(/HEIC 원본은 서버에서 처리할 수 없습니다/);
    expect(h.sharpFn).not.toHaveBeenCalled();
    expect(h.upload).not.toHaveBeenCalled();
  });

  it("sharp 판정이 매직 바이트와 다르면 픽셀 디코드(toBuffer) 전에 멈춘다", async () => {
    h.pipeline.format = "png"; // 바이트는 JPEG 인데 디코더는 PNG 라고 보고
    const body = await run(JPEG);

    expect(body.data.failed).toEqual([
      { photoId: PHOTO_ID, error: "허용되지 않는 이미지 포맷: png" },
    ]);
    expect(h.pipeline.metadata).toHaveBeenCalledTimes(1);
    expect(h.pipeline.toBuffer).not.toHaveBeenCalled();
    expect(h.upload).not.toHaveBeenCalled();
  });

  it("JPEG 는 픽셀 한도·failOn 옵션으로 sharp 에 넘기고 판정 MIME 으로 저장한다", async () => {
    const body = await run(JPEG, "image/jpeg");

    expect(body.data.failed).toEqual([]);
    expect(h.sharpFn).toHaveBeenCalledWith(
      expect.any(Buffer),
      expect.objectContaining({ limitInputPixels: 200_000_000, failOn: "none" }),
    );
    expect(h.pipeline.rotate).toHaveBeenCalled();
    expect(h.upload).toHaveBeenCalledWith(
      `${USER_ID}/${PROJECT_ID}/${PHOTO_ID}.jpg`,
      expect.any(Buffer),
      expect.objectContaining({ contentType: "image/jpeg" }),
    );
    expect(body.data.inserted).toEqual([
      expect.objectContaining({ id: PHOTO_ID, mime: "image/jpeg" }),
    ]);
  });
});

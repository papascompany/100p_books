// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

import {
  RESOURCES_BUCKET,
  RESOURCE_CONSTRAINTS,
  finalizeResourceUpload,
  isResourceId,
  issueUploadTarget,
  sniffResourceBytes,
  validateResourceMeta,
  validateUploadDeclaration,
} from "./resources";

const ID = "123e4567-e89b-12d3-a456-426614174000";
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
const TTF = Uint8Array.from([0x00, 0x01, 0x00, 0x00, 1, 2]);

describe("validateUploadDeclaration", () => {
  it("확장자·크기·MIME 을 검증한다", () => {
    const mb = 1024 * 1024;
    expect(validateUploadDeclaration("background", { name: "a.jpg", size: 9 * mb, type: "image/jpeg" }).ok).toBe(true);
    expect(validateUploadDeclaration("background", { name: "a.jpg", size: 11 * mb, type: "image/jpeg" }).ok).toBe(false);
    expect(validateUploadDeclaration("background", { name: "a.gif", size: 1, type: "image/gif" }).ok).toBe(false);
    expect(validateUploadDeclaration("clipart", { name: "a.svg", size: 3 * mb, type: "image/svg+xml" }).ok).toBe(false);
    expect(validateUploadDeclaration("clipart", { name: "a.png", size: 10, type: "text/html" }).ok).toBe(false);
    expect(validateUploadDeclaration("font", { name: "a.ttf", size: 10, type: "" }).ok).toBe(true);
    expect(validateUploadDeclaration("font", { name: "a.ttf", size: 0, type: "" }).ok).toBe(false);
  });
});

describe("issueUploadTarget / isResourceId", () => {
  it("path 는 type+id+ext 로만 만든다", () => {
    expect(issueUploadTarget("background", "x/../evil.JPG", ID).path).toBe(`backgrounds/${ID}.jpg`);
    expect(isResourceId(ID)).toBe(true);
    expect(isResourceId("../x")).toBe(false);
  });
});

describe("sniffResourceBytes", () => {
  it("폰트·클립아트 매직 바이트", () => {
    expect(sniffResourceBytes("font", "ttf", TTF).ok).toBe(true);
    expect(sniffResourceBytes("font", "woff2", TTF).ok).toBe(false);
    expect(sniffResourceBytes("clipart", "png", PNG).ok).toBe(true);
    expect(sniffResourceBytes("clipart", "png", new TextEncoder().encode("<svg/>")).ok).toBe(false);
    expect(sniffResourceBytes("clipart", "svg", new TextEncoder().encode('<?xml version="1.0"?><svg xmlns="x"></svg>')).ok).toBe(true);
    expect(sniffResourceBytes("clipart", "svg", new TextEncoder().encode("<html></html>")).ok).toBe(false);
  });
});

describe("validateResourceMeta", () => {
  it("폰트는 family/licenseName 필수", () => {
    expect(validateResourceMeta("font", { family: "A" })).not.toBeNull();
    expect(validateResourceMeta("font", { family: "A", licenseName: "OFL" })).toBeNull();
    expect(validateResourceMeta("clipart", null)).toBeNull();
  });
});

interface FakeOpts {
  exists?: boolean;
  info?: { size?: number } | null;
  bytes?: Uint8Array;
  insertError?: { code?: string; message: string } | null;
}

function makeAdmin(o: FakeOpts = {}) {
  const remove = vi.fn(async () => ({ data: [], error: null }));
  const insert = vi.fn((row: Record<string, unknown>) => ({
    select: () => ({
      single: async () =>
        o.insertError
          ? { data: null, error: o.insertError }
          : { data: { ...row, active: true, created_at: "t" }, error: null },
    }),
  }));
  const bytes = o.bytes ?? TTF;
  const admin = {
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: o.exists ? { id: ID } : null, error: null }) }),
      }),
      insert,
    }),
    storage: {
      from: (bucket: string) => {
        expect(bucket).toBe(RESOURCES_BUCKET);
        return {
          info: async () =>
            o.info === null
              ? { data: null, error: { message: "nf" } }
              : { data: { size: o.info?.size ?? bytes.length }, error: null },
          download: async () => ({ data: new Blob([bytes as BlobPart]), error: null }),
          remove,
        };
      },
    },
  };
  return { admin: admin as never, remove, insert };
}

const base = { type: "font" as const, resourceId: ID, filename: "A.ttf", name: "A", meta: { family: "A", licenseName: "OFL" } };

describe("finalizeResourceUpload", () => {
  it("성공 시 서버 계산 path 로 INSERT 한다", async () => {
    const { admin, insert, remove } = makeAdmin();
    const r = await finalizeResourceUpload(admin, base);
    expect(r.ok).toBe(true);
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ id: ID, storage_key: `fonts/${ID}.ttf`, active: true }));
    expect(remove).not.toHaveBeenCalled();
  });

  it("객체가 없으면 400 UPLOAD_NOT_FOUND, 삭제·INSERT 없음", async () => {
    const { admin, insert, remove } = makeAdmin({ info: null });
    const r = await finalizeResourceUpload(admin, base);
    expect(r).toMatchObject({ ok: false, code: "UPLOAD_NOT_FOUND", status: 400 });
    expect(insert).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });

  it("실제 크기 초과면 객체 삭제 후 거부", async () => {
    const { admin, insert, remove } = makeAdmin({ info: { size: RESOURCE_CONSTRAINTS.font.maxBytes + 1 } });
    const r = await finalizeResourceUpload(admin, base);
    expect(r).toMatchObject({ ok: false, code: "INVALID_FILE" });
    expect(remove).toHaveBeenCalledWith([`fonts/${ID}.ttf`]);
    expect(insert).not.toHaveBeenCalled();
  });

  it("매직 바이트 불일치면 객체 삭제 후 거부", async () => {
    const { admin, insert, remove } = makeAdmin({ bytes: new TextEncoder().encode("<html>") });
    const r = await finalizeResourceUpload(admin, base);
    expect(r).toMatchObject({ ok: false, code: "INVALID_FILE" });
    expect(remove).toHaveBeenCalledTimes(1);
    expect(insert).not.toHaveBeenCalled();
  });

  it("배경은 허용되지 않는 실제 형식이면 거부", async () => {
    const gif = new TextEncoder().encode("GIF89a000000");
    const { admin, remove } = makeAdmin({ bytes: gif });
    const r = await finalizeResourceUpload(admin, { ...base, type: "background", filename: "a.jpg", meta: null });
    expect(r).toMatchObject({ ok: false, code: "INVALID_FILE" });
    expect(remove).toHaveBeenCalledWith([`backgrounds/${ID}.jpg`]);
  });

  it("이미 등록된 id 는 409 이고 객체를 지우지 않는다", async () => {
    const { admin, remove } = makeAdmin({ exists: true });
    const r = await finalizeResourceUpload(admin, base);
    expect(r).toMatchObject({ ok: false, status: 409, code: "ALREADY_REGISTERED" });
    expect(remove).not.toHaveBeenCalled();
  });

  it("INSERT 실패면 객체를 삭제하고 500", async () => {
    const { admin, remove } = makeAdmin({ insertError: { message: "boom" } });
    const r = await finalizeResourceUpload(admin, base);
    expect(r).toMatchObject({ ok: false, status: 500, code: "INSERT_FAILED" });
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it("허용되지 않는 확장자는 즉시 거부", async () => {
    const { admin } = makeAdmin();
    const r = await finalizeResourceUpload(admin, { ...base, filename: "a.exe" });
    expect(r).toMatchObject({ ok: false, code: "INVALID_FILE" });
  });
});

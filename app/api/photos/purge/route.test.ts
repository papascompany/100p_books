// @vitest-environment node
import type * as ReactModule from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { harness, readJson, resetHarness, USER_ID } from "@/app/api/payments/_test/harness";
import type { MemoryDb, Row } from "@/app/api/payments/_test/memory-supabase";

import { selectRemovablePhotoKeys } from "./storage-cleanup";

/**
 * POST /api/photos/purge — Storage 키 소유·참조 확인 (방어 보강).
 *
 * 선물 수령 복사 실패 폴백(app/api/gifts/[token])은 수령자 행이 발신자 원본 키를 그대로 참조하게 만든다.
 * 예전 purge 는 키를 검증 없이 service_role 로 지워 발신자의 결제 완료 포토북 원본을 없앨 수 있었다.
 */

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof ReactModule>();
  return { ...actual, cache: <T>(fn: T): T => fn };
});

const storage = vi.hoisted(() => ({
  removed: [] as Array<{ bucket: string; keys: string[] }>,
  failRemove: false,
}));

/**
 * 인메모리 하네스에는 `.not(col, "is", null)` 이 없다 — 같은 의미인 neq(col, null)(IS NOT NULL)로 잇는다.
 * (하네스는 결제 샤드 소유라 고치지 않고 테스트 쪽에서 감싼다.)
 */
const adapt = vi.hoisted(() => ({
  withNot<T extends { from: (t: string) => unknown }>(client: T): T {
    return {
      ...client,
      from: (table: string) => {
        const b = client.from(table) as {
          neq: (c: string, v: unknown) => unknown;
          not?: (c: string, op: string, v: unknown) => unknown;
        };
        b.not = (column: string, op: string, value: unknown) => {
          if (op !== "is") throw new Error(`not(${op}) 은 테스트 어댑터에서 지원하지 않음`);
          return b.neq(column, value);
        };
        return b;
      },
    };
  },
}));

vi.mock("@/lib/db/server", async () => {
  const { harness: h, USER_ID: uid } = await import("@/app/api/payments/_test/harness");
  return {
    createServerSupabase: () => ({
      ...adapt.withNot(h.db.client()),
      auth: { getUser: async () => ({ data: { user: { id: uid } } }) },
    }),
  };
});
vi.mock("@/lib/db/admin", async () => {
  const { harness: h } = await import("@/app/api/payments/_test/harness");
  return {
    createAdminSupabase: () => ({
      ...adapt.withNot(h.db.client()),
      storage: {
        from: (bucket: string) => ({
          remove: async (keys: string[]) => {
            if (storage.failRemove) return { data: null, error: { message: "storage down" } };
            storage.removed.push({ bucket, keys: [...keys] });
            return { data: [], error: null };
          },
        }),
      },
    }),
  };
});

import { POST } from "./route";

const SENDER = "99999999-9999-4999-8999-999999999999";
const P_MINE = "22222222-2222-4222-8222-222222222222";
const P_SENDER = "33333333-3333-4333-8333-333333333333";

function setup(): MemoryDb {
  const db = resetHarness({ atomic: true });
  db.seed("profiles", { id: USER_ID, deleted_at: null });
  db.seed("projects", { id: P_MINE, user_id: USER_ID });
  db.seed("projects", { id: P_SENDER, user_id: SENDER });
  storage.removed = [];
  storage.failRemove = false;
  return db;
}

function photo(db: MemoryDb, over: Row): Row {
  return db.seed("photos", {
    project_id: P_MINE,
    deleted_at: "2026-09-10T00:00:00Z",
    ...over,
  });
}

function purge(photoIds: unknown[]) {
  return POST(
    new Request("https://100pbooks.vercel.app/api/photos/purge", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ photoIds }),
    }),
  );
}

function removedKeys(): string[] {
  return storage.removed.flatMap((r) => r.keys);
}

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "info").mockImplementation(() => undefined);
});

describe("POST /api/photos/purge — Storage 키 소유·참조 확인", () => {
  it("본인 폴더 키이고 다른 참조가 없으면 원본·썸네일을 지운다", async () => {
    const db = setup();
    const p = photo(db, {
      storage_key: `${USER_ID}/${P_MINE}/a.jpg`,
      thumb_key: `${USER_ID}/${P_MINE}/a.webp`,
    });
    const res = await purge([p.id]);
    expect(res.status).toBe(200);
    expect((await readJson(res)).data).toEqual({ deleted: 1, skipped: 0 });
    expect(db.find("photos", (r) => r.id === p.id)).toBeUndefined();
    expect(storage.removed).toEqual([
      { bucket: "photo-originals", keys: [`${USER_ID}/${P_MINE}/a.jpg`] },
      { bucket: "photo-thumbs", keys: [`${USER_ID}/${P_MINE}/a.webp`] },
    ]);
  });

  it("선물 폴백으로 발신자 키를 참조하는 행 — 행은 지우고 발신자 원본·썸네일은 남긴다", async () => {
    const db = setup();
    const senderOriginal = `${SENDER}/${P_SENDER}/orig.jpg`;
    const senderThumb = `${SENDER}/${P_SENDER}/orig.webp`;
    // 발신자 원래 행(결제 완료 포토북)
    db.seed("photos", {
      project_id: P_SENDER,
      storage_key: senderOriginal,
      thumb_key: senderThumb,
      deleted_at: null,
    });
    const shared = photo(db, { storage_key: senderOriginal, thumb_key: senderThumb });
    const res = await purge([shared.id]);
    expect(res.status).toBe(200);
    expect(db.find("photos", (r) => r.id === shared.id)).toBeUndefined();
    expect(removedKeys()).toEqual([]);
  });

  it("발신자 행이 이미 없어도 남의 폴더 키는 지우지 않는다(소유 검증만으로 차단)", async () => {
    const db = setup();
    const shared = photo(db, {
      storage_key: `${SENDER}/${P_SENDER}/gone.jpg`,
      thumb_key: `${SENDER}/${P_SENDER}/gone.webp`,
    });
    await purge([shared.id]);
    expect(removedKeys()).toEqual([]);
  });

  it("본인 사진과 폴백 공유 사진이 섞인 배치 — 본인 폴더 키만 지운다", async () => {
    const db = setup();
    const own = photo(db, { storage_key: `${USER_ID}/${P_MINE}/own.jpg`, thumb_key: null });
    const shared = photo(db, {
      storage_key: `${SENDER}/${P_SENDER}/shared.jpg`,
      thumb_key: `${SENDER}/${P_SENDER}/shared.webp`,
    });
    const res = await purge([own.id, shared.id]);
    expect((await readJson(res)).data).toEqual({ deleted: 2, skipped: 0 });
    expect(removedKeys()).toEqual([`${USER_ID}/${P_MINE}/own.jpg`]);
  });

  it("본인 폴더 키라도 다른 photos 행(수령자 폴백)이 참조하면 남긴다", async () => {
    const db = setup();
    const key = `${USER_ID}/${P_MINE}/b.jpg`;
    const thumb = `${USER_ID}/${P_MINE}/b.webp`;
    const mine = photo(db, { storage_key: key, thumb_key: thumb });
    db.seed("photos", {
      project_id: "44444444-4444-4444-8444-444444444444",
      storage_key: key,
      thumb_key: thumb,
      deleted_at: null,
    });
    const res = await purge([mine.id]);
    expect(res.status).toBe(200);
    expect(db.find("photos", (r) => r.id === mine.id)).toBeUndefined();
    expect(removedKeys()).toEqual([]);
  });

  it("경로 조작 흔적이 있는 키는 본인 prefix 여도 지우지 않는다", async () => {
    const db = setup();
    const p = photo(db, { storage_key: `${USER_ID}/../${SENDER}/x.jpg`, thumb_key: null });
    await purge([p.id]);
    expect(removedKeys()).toEqual([]);
  });

  it("참조 조회 실패 → 영구 삭제는 성공, Storage 는 건드리지 않는다(cron 회수)", async () => {
    const db = setup();
    const p = photo(db, { storage_key: `${USER_ID}/${P_MINE}/c.jpg`, thumb_key: null });
    // 1) 휴지통 조회(server)는 통과, 2) 참조 조회(admin select:photos 두 번째)에서 실패 주입
    const originalRun = db.client;
    let selects = 0;
    db.client = function patched(this: MemoryDb) {
      const c = originalRun.call(this);
      return {
        ...c,
        from: (t: string) => {
          if (t === "photos") {
            selects += 1;
            if (selects === 3) db.failOnce.set("select:photos", { message: "timeout" });
          }
          return c.from(t);
        },
      };
    } as typeof db.client;
    const res = await purge([p.id]);
    expect(res.status).toBe(200);
    expect((await readJson(res)).data).toEqual({ deleted: 1, skipped: 0 });
    expect(db.find("photos", (r) => r.id === p.id)).toBeUndefined();
    expect(removedKeys()).toEqual([]);
  });

  it("행 삭제 실패 → 500, Storage 는 건드리지 않는다", async () => {
    const db = setup();
    const p = photo(db, { storage_key: `${USER_ID}/${P_MINE}/d.jpg`, thumb_key: null });
    db.failOnce.set("delete:photos", { message: "deadlock" });
    const res = await purge([p.id]);
    expect(res.status).toBe(500);
    expect(harness.db.find("photos", (r) => r.id === p.id)).toBeDefined();
    expect(removedKeys()).toEqual([]);
  });

  it("남의 프로젝트 사진 → 403, 삭제 0건", async () => {
    const db = setup();
    const theirs = db.seed("photos", {
      project_id: P_SENDER,
      storage_key: `${SENDER}/${P_SENDER}/e.jpg`,
      deleted_at: "2026-09-10T00:00:00Z",
    });
    const res = await purge([theirs.id]);
    expect(res.status).toBe(403);
    expect(db.find("photos", (r) => r.id === theirs.id)).toBeDefined();
    expect(removedKeys()).toEqual([]);
  });
});

describe("selectRemovablePhotoKeys (순수 판정)", () => {
  it("본인 폴더·미참조 키만 남긴다", () => {
    const rows = [
      { storage_key: `${USER_ID}/p/1.jpg`, thumb_key: `${USER_ID}/p/1.webp` },
      { storage_key: `${SENDER}/p/2.jpg`, thumb_key: `${SENDER}/p/2.webp` },
      { storage_key: `${USER_ID}/p/3.jpg`, thumb_key: null },
    ];
    expect(
      selectRemovablePhotoKeys(USER_ID, rows, {
        originals: new Set([`${USER_ID}/p/3.jpg`]),
        thumbs: new Set(),
      }),
    ).toEqual({ originals: [`${USER_ID}/p/1.jpg`], thumbs: [`${USER_ID}/p/1.webp`] });
  });
});

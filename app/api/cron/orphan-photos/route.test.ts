// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * GET /api/cron/orphan-photos — 고아 객체 회수 (FU2-b).
 *
 * 인증은 실제 lib/security/cron-auth 를 쓰고, service_role 클라이언트만 인메모리 storage + photos 로
 * 바꾼다. 이 cron 은 **되돌릴 수 없는 삭제**를 하므로 두 방향을 모두 고정한다:
 *   1) 원본(photo-originals)과 썸네일(photo-thumbs) **양쪽**이 실제로 회수되는가
 *   2) 살아 있는 행이 참조하는 객체는 절대 지우지 않는가
 *      — 특히 선물 수령 폴백으로 수령자 행이 **발신자 키를 공유**하는 경우
 */

import {
  planOrphanDeletion,
  selectOrphans,
  splitDeleteBudget,
  isAgedObject,
} from "./orphan-select";

type PhotoRow = {
  storage_key: string;
  thumb_key: string | null;
  deleted_at?: string | null;
};

const ORIGINALS = "photo-originals";
const THUMBS = "photo-thumbs";

const state = vi.hoisted(() => ({
  objects: {} as Record<string, Array<{ key: string; created_at: string }>>,
  photos: [] as Array<{
    storage_key: string;
    thumb_key: string | null;
    deleted_at?: string | null;
  }>,
  removed: [] as string[],
  listCalls: [] as string[],
  /** 컬럼별 조회 실패 주입 — "storage_key" | "thumb_key". */
  selectFails: new Set<string>(),
  removeFails: new Set<string>(),
}));

interface Entry {
  name: string;
  id: string | null;
  created_at?: string;
}

/** `{user}/{project}/{file}` 트리를 prefix 깊이에 맞춰 폴더/객체로 펼친다. */
function listEntries(bucket: string, prefix: string): Entry[] {
  const depth = prefix === "" ? 0 : prefix.split("/").length;
  const folders = new Map<string, Entry>();
  const objects: Entry[] = [];
  for (const obj of state.objects[bucket] ?? []) {
    if (prefix !== "" && !obj.key.startsWith(`${prefix}/`)) continue;
    const seg = obj.key.split("/");
    if (seg.length > depth + 1) {
      const name = seg[depth]!;
      if (!folders.has(name)) folders.set(name, { name, id: null });
    } else if (seg.length === depth + 1) {
      objects.push({ name: seg[depth]!, id: `obj-${obj.key}`, created_at: obj.created_at });
    }
  }
  return [...folders.values(), ...objects];
}

function bucketApi(bucket: string) {
  return {
    list: async (prefix: string, opts: { limit: number; offset: number }) => {
      await Promise.resolve();
      state.listCalls.push(`${bucket}:${prefix}`);
      const all = listEntries(bucket, prefix);
      return { data: all.slice(opts.offset, opts.offset + opts.limit), error: null };
    },
    remove: async (keys: string[]) => {
      await Promise.resolve();
      if (state.removeFails.has(bucket)) {
        return { data: null, error: { message: `${bucket} remove 실패` } };
      }
      for (const k of keys) state.removed.push(`${bucket}:${k}`);
      state.objects[bucket] = (state.objects[bucket] ?? []).filter(
        (o) => !keys.includes(o.key),
      );
      return { data: [], error: null };
    },
  };
}

function photosTable(name: string) {
  if (name !== "photos") throw new Error(`unexpected table ${name}`);
  let cols: string[] = [];
  let filter: { col: string; vals: unknown[] } | null = null;
  const b = {
    select(c: string) {
      cols = c.split(",").map((s) => s.trim());
      return b;
    },
    in(col: string, vals: unknown[]) {
      filter = { col, vals };
      return b;
    },
    then<T>(
      resolve: (v: {
        data: Array<Record<string, unknown>> | null;
        error: { message: string } | null;
      }) => T,
      reject?: (e: unknown) => T,
    ) {
      return Promise.resolve()
        .then(() => {
          const col = filter?.col ?? "";
          if (state.selectFails.has(col)) {
            return { data: null, error: { message: `${col} 조회 실패` } };
          }
          const hits = state.photos.filter(
            (r) =>
              !filter ||
              filter.vals.includes((r as unknown as Record<string, unknown>)[filter.col]),
          );
          return {
            data: hits.map((r) =>
              Object.fromEntries(
                cols.map((c) => [c, (r as unknown as Record<string, unknown>)[c] ?? null]),
              ),
            ),
            error: null,
          };
        })
        .then(resolve, reject);
    },
  };
  return b;
}

vi.mock("@/lib/db/admin", () => ({
  createAdminSupabase: () => ({
    from: (name: string) => photosTable(name),
    storage: { from: (bucket: string) => bucketApi(bucket) },
  }),
}));

import { GET } from "./route";

const DAY = 86_400_000;
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
const OLD = () => ago(30 * DAY);
const FRESH = () => ago(60_000);

interface BucketReport {
  scanned: number;
  orphans: number;
  deleted?: number;
  wouldDelete?: number;
  sample?: string[];
}
type Body = {
  ok: boolean;
  data?: {
    dryRun: boolean;
    scanned: number;
    orphans: number;
    deleted?: number;
    wouldDelete?: number;
    truncated: boolean;
    buckets: Record<string, BucketReport>;
  };
  error?: { code: string; message: string };
};

function req(query = "") {
  return new Request(`https://100p.test/api/cron/orphan-photos${query}`, {
    headers: { authorization: "Bearer test-cron-secret" },
  });
}

async function run(query = ""): Promise<Body> {
  const res = await GET(req(query));
  return (await res.json()) as Body;
}

function seedObjects(
  bucket: string,
  entries: Array<{ key: string; created_at?: string }>,
) {
  state.objects[bucket] = entries.map((e) => ({
    key: e.key,
    created_at: e.created_at ?? OLD(),
  }));
}

function seedPhotos(rows: PhotoRow[]) {
  state.photos = rows;
}

beforeEach(() => {
  vi.stubEnv("CRON_SECRET", "test-cron-secret");
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  state.objects = {};
  state.photos = [];
  state.removed = [];
  state.listCalls = [];
  state.selectFails = new Set();
  state.removeFails = new Set();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("원본과 썸네일 양쪽을 회수한다", () => {
  it("두 버킷을 모두 스캔하고, 참조 없는 객체를 버킷별로 지운다", async () => {
    seedObjects(ORIGINALS, [{ key: "u1/p1/dead.jpg" }]);
    seedObjects(THUMBS, [{ key: "u1/p1/dead.webp" }]);
    seedPhotos([]);

    const body = await run();

    expect(body.ok).toBe(true);
    expect(state.listCalls.some((c) => c.startsWith(`${ORIGINALS}:`))).toBe(true);
    expect(state.listCalls.some((c) => c.startsWith(`${THUMBS}:`))).toBe(true);
    expect(body.data?.deleted).toBe(2);
    expect(body.data?.buckets[ORIGINALS]).toMatchObject({
      scanned: 1,
      orphans: 1,
      deleted: 1,
    });
    expect(body.data?.buckets[THUMBS]).toMatchObject({
      scanned: 1,
      orphans: 1,
      deleted: 1,
    });
    expect(state.removed.sort()).toEqual([
      `${ORIGINALS}:u1/p1/dead.jpg`,
      `${THUMBS}:u1/p1/dead.webp`,
    ]);
  });

  it("photos 행이 없는 썸네일만의 고아도 회수한다 (complete 가 INSERT 전에 끊긴 경우)", async () => {
    seedObjects(ORIGINALS, [{ key: "u1/p1/live.jpg" }]);
    seedObjects(THUMBS, [{ key: "u1/p1/live.webp" }, { key: "u1/p1/ghost.webp" }]);
    seedPhotos([{ storage_key: "u1/p1/live.jpg", thumb_key: "u1/p1/live.webp" }]);

    const body = await run();

    expect(state.removed).toEqual([`${THUMBS}:u1/p1/ghost.webp`]);
    expect(body.data?.buckets[ORIGINALS]?.orphans).toBe(0);
    expect(body.data?.buckets[THUMBS]?.orphans).toBe(1);
  });
});

describe("살아 있는 행이 참조하는 객체는 지우지 않는다", () => {
  it("선물 폴백 — 수령자 행이 발신자 썸네일을 공유하면 원본만 지운다", async () => {
    // 발신자는 photos 행을 지웠지만(원본 고아), 수령 시 썸네일 복사가 실패해
    // 수령자 행의 thumb_key 가 발신자 키를 그대로 가리킨다.
    seedObjects(ORIGINALS, [{ key: "sender/ps/shared.jpg" }]);
    seedObjects(THUMBS, [{ key: "sender/ps/shared.webp" }]);
    seedPhotos([
      { storage_key: "recipient/pr/new.jpg", thumb_key: "sender/ps/shared.webp" },
    ]);

    const body = await run();

    expect(state.removed).toEqual([`${ORIGINALS}:sender/ps/shared.jpg`]);
    expect(state.removed).not.toContain(`${THUMBS}:sender/ps/shared.webp`);
    expect(body.data?.buckets[THUMBS]).toMatchObject({ scanned: 1, orphans: 0 });
  });

  it("선물 폴백 반대 방향 — 수령자 행이 발신자 원본을 공유하면 썸네일만 지운다", async () => {
    seedObjects(ORIGINALS, [{ key: "sender/ps/shared.jpg" }]);
    seedObjects(THUMBS, [{ key: "sender/ps/shared.webp" }]);
    seedPhotos([
      { storage_key: "sender/ps/shared.jpg", thumb_key: "recipient/pr/new.webp" },
    ]);

    expect((await run()).ok).toBe(true);
    expect(state.removed).toEqual([`${THUMBS}:sender/ps/shared.webp`]);
  });

  it("휴지통(soft delete) 행의 참조도 유효하다 — 복구할 수 있어야 한다", async () => {
    seedObjects(ORIGINALS, [{ key: "u1/p1/trashed.jpg" }]);
    seedObjects(THUMBS, [{ key: "u1/p1/trashed.webp" }]);
    seedPhotos([
      {
        storage_key: "u1/p1/trashed.jpg",
        thumb_key: "u1/p1/trashed.webp",
        deleted_at: ago(2 * DAY),
      },
    ]);

    expect((await run()).ok).toBe(true);
    expect(state.removed).toEqual([]);
  });

  it("cutoff 안쪽(최근) 객체는 후보에도 들어가지 않는다 — 업로드 중인 파일 보호", async () => {
    seedObjects(ORIGINALS, [{ key: "u1/p1/uploading.jpg", created_at: FRESH() }]);
    seedObjects(THUMBS, [{ key: "u1/p1/uploading.webp", created_at: FRESH() }]);
    seedPhotos([]);

    const body = await run();

    expect(body.data?.scanned).toBe(0);
    expect(state.removed).toEqual([]);
  });

  it("thumb_key 참조 조회가 실패하면 아무것도 지우지 않는다", async () => {
    seedObjects(ORIGINALS, [{ key: "u1/p1/dead.jpg" }]);
    seedObjects(THUMBS, [{ key: "u1/p1/dead.webp" }]);
    seedPhotos([]);
    state.selectFails.add("thumb_key");

    const body = await run();

    expect(body.ok).toBe(false);
    expect(body.error?.code).toBe("PHOTOS_THUMB_QUERY_FAILED");
    expect(state.removed).toEqual([]);
  });
});

describe("dryRun / 예산", () => {
  it("dryRun 은 삭제하지 않고 버킷별 건수를 드러낸다", async () => {
    seedObjects(ORIGINALS, [{ key: "u1/p1/a.jpg" }, { key: "u1/p1/b.jpg" }]);
    seedObjects(THUMBS, [{ key: "u1/p1/a.webp" }]);
    seedPhotos([{ storage_key: "u1/p1/a.jpg", thumb_key: "u1/p1/a.webp" }]);

    const body = await run("?dryRun=1");

    expect(body.data?.dryRun).toBe(true);
    expect(state.removed).toEqual([]);
    expect(body.data?.buckets[ORIGINALS]).toMatchObject({
      scanned: 2,
      orphans: 1,
      wouldDelete: 1,
    });
    expect(body.data?.buckets[ORIGINALS]?.sample).toEqual(["u1/p1/b.jpg"]);
    expect(body.data?.buckets[THUMBS]).toMatchObject({
      scanned: 1,
      orphans: 0,
      wouldDelete: 0,
    });
  });

  it("삭제 예산은 두 버킷에 나뉜다 — 원본이 예산을 독식하지 않는다", async () => {
    vi.stubEnv("ORPHAN_MAX_DELETES", "2");
    seedObjects(ORIGINALS, [
      { key: "u1/p1/a.jpg" },
      { key: "u1/p1/b.jpg" },
      { key: "u1/p1/c.jpg" },
    ]);
    seedObjects(THUMBS, [
      { key: "u1/p1/a.webp" },
      { key: "u1/p1/b.webp" },
      { key: "u1/p1/c.webp" },
    ]);
    seedPhotos([]);

    const body = await run();

    expect(body.data?.deleted).toBe(2);
    expect(body.data?.buckets[ORIGINALS]?.deleted).toBe(1);
    expect(body.data?.buckets[THUMBS]?.deleted).toBe(1);
    expect(body.data?.truncated).toBe(true);
  });

  it("한 버킷의 remove 가 실패해도 다른 버킷은 회수된다", async () => {
    seedObjects(ORIGINALS, [{ key: "u1/p1/dead.jpg" }]);
    seedObjects(THUMBS, [{ key: "u1/p1/dead.webp" }]);
    seedPhotos([]);
    state.removeFails.add(ORIGINALS);

    const body = await run();

    expect(body.data?.buckets[ORIGINALS]?.deleted).toBe(0);
    expect(body.data?.buckets[THUMBS]?.deleted).toBe(1);
  });
});

describe("orphan-select (순수 판정)", () => {
  it("isAgedObject — 폴더·최근 객체·시각 불명은 후보가 아니다", () => {
    const cutoff = Date.parse("2026-09-01T00:00:00Z");
    expect(isAgedObject({ name: "d", id: null }, cutoff)).toBe(false);
    expect(
      isAgedObject({ name: "a", id: "x", created_at: "2026-08-01T00:00:00Z" }, cutoff),
    ).toBe(true);
    expect(
      isAgedObject({ name: "a", id: "x", created_at: "2026-09-02T00:00:00Z" }, cutoff),
    ).toBe(false);
    expect(isAgedObject({ name: "a", id: "x" }, cutoff)).toBe(false);
    expect(
      isAgedObject({ name: "a", id: "x", created_at: "nope" }, cutoff),
    ).toBe(false);
  });

  it("selectOrphans — 참조 집합에 있으면 남긴다", () => {
    expect(selectOrphans(["a", "b"], new Set(["b"]))).toEqual(["a"]);
    expect(selectOrphans([], new Set(["b"]))).toEqual([]);
  });

  it("splitDeleteBudget — 총량을 지키면서 남는 예산은 상대 버킷에 넘긴다", () => {
    expect(splitDeleteBudget({ originals: 1000, thumbs: 0 }, 500)).toEqual({
      originals: 500,
      thumbs: 0,
    });
    expect(splitDeleteBudget({ originals: 0, thumbs: 1000 }, 500)).toEqual({
      originals: 0,
      thumbs: 500,
    });
    expect(splitDeleteBudget({ originals: 1000, thumbs: 1000 }, 500)).toEqual({
      originals: 250,
      thumbs: 250,
    });
    expect(splitDeleteBudget({ originals: 1000, thumbs: 100 }, 500)).toEqual({
      originals: 400,
      thumbs: 100,
    });
    expect(splitDeleteBudget({ originals: 3, thumbs: 3 }, 0)).toEqual({
      originals: 0,
      thumbs: 0,
    });
  });

  it("planOrphanDeletion — 원본은 storage_key, 썸네일은 thumb_key 로만 판정한다", () => {
    const plan = planOrphanDeletion(
      { originals: ["u/p/x.jpg"], thumbs: ["u/p/x.webp"] },
      {
        storageKeys: new Set<string>(),
        thumbKeys: new Set(["u/p/x.webp"]),
      },
      500,
    );
    expect(plan.originals.toDelete).toEqual(["u/p/x.jpg"]);
    expect(plan.thumbs.toDelete).toEqual([]);
    expect(plan.deleteTruncated).toBe(false);
  });

  it("planOrphanDeletion — 예산에 걸리면 deleteTruncated 로 알린다", () => {
    const plan = planOrphanDeletion(
      { originals: ["a", "b", "c"], thumbs: [] },
      { storageKeys: new Set<string>(), thumbKeys: new Set<string>() },
      2,
    );
    expect(plan.originals.toDelete).toEqual(["a", "b"]);
    expect(plan.deleteTruncated).toBe(true);
  });
});

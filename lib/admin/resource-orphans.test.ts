// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { reapOrphanResources } from "./resource-orphans";

type Obj = { key: string; created_at?: string };

const state = {
  objects: [] as Obj[],
  rows: [] as string[],
  removed: [] as string[],
  listCalls: 0,
  selectError: false,
};

const NOW = Date.parse("2026-11-11T12:00:00Z");
const OLD = "2026-11-09T00:00:00Z";
const YOUNG = "2026-11-11T11:00:00Z";
const cutoffMs = NOW - 24 * 3_600_000;

function fakeAdmin() {
  return {
    storage: {
      from: (_b: string) => ({
        list: async (prefix: string, o: { limit: number; offset: number }) => {
          state.listCalls += 1;
          const all = state.objects
            .filter((x) => x.key.startsWith(`${prefix}/`))
            .map((x) => ({
              name: x.key.slice(prefix.length + 1),
              id: `id-${x.key}`,
              created_at: x.created_at,
            }));
          return { data: all.slice(o.offset, o.offset + o.limit), error: null };
        },
        remove: async (keys: string[]) => {
          state.removed.push(...keys);
          return { data: [], error: null };
        },
      }),
    },
    from: (_t: string) => ({
      select: (_c: string) => ({
        in: async (_col: string, vals: string[]) =>
          state.selectError
            ? { data: null, error: { message: "boom" } }
            : {
                data: state.rows
                  .filter((k) => vals.includes(k))
                  .map((k) => ({ storage_key: k })),
                error: null,
              },
      }),
    }),
  } as unknown as Parameters<typeof reapOrphanResources>[0];
}

const base = { cutoffMs, maxListCalls: 100, maxDeletes: 100, dryRun: false };

beforeEach(() => {
  state.objects = [];
  state.rows = [];
  state.removed = [];
  state.listCalls = 0;
  state.selectError = false;
});

describe("reapOrphanResources", () => {
  it("참조된 객체는 오래돼도 남기고, 어린 고아는 남기고, 오래된 고아만 지운다", async () => {
    state.objects = [
      { key: "fonts/a.ttf", created_at: OLD },
      { key: "cliparts/b.png", created_at: OLD },
      { key: "backgrounds/c.jpg", created_at: YOUNG },
      { key: "backgrounds/d.jpg", created_at: OLD },
      { key: "fonts/e.ttf" }, // 생성 시각 불명 → 보존
    ];
    state.rows = ["fonts/a.ttf"];
    const r = await reapOrphanResources(fakeAdmin(), base);
    expect(r.ok).toBe(true);
    expect(state.removed.sort()).toEqual(["backgrounds/d.jpg", "cliparts/b.png"]);
    expect(r).toMatchObject({ scanned: 3, orphans: 2, deleted: 2, truncated: false });
  });

  it("dryRun 은 아무것도 지우지 않고 후보를 반환한다", async () => {
    state.objects = [{ key: "fonts/x.ttf", created_at: OLD }];
    const r = await reapOrphanResources(fakeAdmin(), { ...base, dryRun: true });
    expect(state.removed).toEqual([]);
    expect(r).toMatchObject({ deleted: 0, wouldDelete: 1, sample: ["fonts/x.ttf"] });
  });

  it("삭제 상한을 지키고 truncated 로 알린다", async () => {
    state.objects = [1, 2, 3, 4, 5].map((i) => ({
      key: `cliparts/o${i}.png`,
      created_at: OLD,
    }));
    const r = await reapOrphanResources(fakeAdmin(), { ...base, maxDeletes: 2 });
    expect(state.removed).toHaveLength(2);
    expect(r).toMatchObject({ orphans: 5, deleted: 2, truncated: true });
  });

  it("list 페이지네이션 — 100건 초과 prefix 도 전부 훑는다", async () => {
    state.objects = Array.from({ length: 230 }, (_, i) => ({
      key: `backgrounds/p${i}.jpg`,
      created_at: OLD,
    }));
    const r = await reapOrphanResources(fakeAdmin(), { ...base, maxDeletes: 1000 });
    expect(r.scanned).toBe(230);
    expect(state.removed).toHaveLength(230);
  });

  it("list 호출 예산 초과 시 truncated", async () => {
    state.objects = [{ key: "fonts/a.ttf", created_at: OLD }];
    const r = await reapOrphanResources(fakeAdmin(), { ...base, maxListCalls: 1 });
    expect(r.truncated).toBe(true);
    expect(state.listCalls).toBe(1);
  });

  it("참조 조회 실패 시 아무것도 지우지 않는다", async () => {
    state.objects = [{ key: "fonts/a.ttf", created_at: OLD }];
    state.selectError = true;
    const r = await reapOrphanResources(fakeAdmin(), base);
    expect(r.ok).toBe(false);
    expect(state.removed).toEqual([]);
  });
});

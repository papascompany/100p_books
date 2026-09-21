// @vitest-environment node
import type * as ReactModule from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  readJson,
  resetHarness,
  seedOrder,
  seedProject,
  USER_ID,
} from "@/app/api/payments/_test/harness";
import type { MemoryDb, Row } from "@/app/api/payments/_test/memory-supabase";
import { computeDocVersion } from "@/lib/editor/doc-version";
import type { PageDoc } from "@/lib/layout/types";

/**
 * PATCH /api/cover — 결제 후 편집 잠금(DEBT-2) + 탈퇴 가드(DEBT-3).
 *
 * 판정 순서 계약: 소유권(403) → 잠금(409 PROJECT_LOCKED) → 버전(409 EDIT_CONFLICT).
 * lib/auth/session 과 lib/orders/edit-lock 은 mock 하지 않는다.
 */

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof ReactModule>();
  return { ...actual, cache: <T>(fn: T): T => fn };
});

vi.mock("@/lib/db/server", async () => {
  const { harness: h, USER_ID: uid } = await import("@/app/api/payments/_test/harness");
  return {
    createServerSupabase: () => ({
      ...h.db.client(),
      auth: { getUser: async () => ({ data: { user: { id: uid } } }) },
    }),
  };
});
vi.mock("@/lib/db/admin", async () => {
  const { harness: h } = await import("@/app/api/payments/_test/harness");
  return { createAdminSupabase: () => h.db.client() };
});
vi.mock("@/lib/analytics/funnel", async () => {
  const { fakes } = await import("@/app/api/payments/_test/harness");
  return { trackFunnelEvent: fakes.trackFunnelEvent };
});

import { PATCH } from "./route";

const LOCKING = ["paid", "in_production", "shipped", "delivered"] as const;
const OTHER_USER = "99999999-9999-4999-8999-999999999999";

function setup(opts: { orders?: readonly string[]; deleted?: boolean; owner?: string } = {}): {
  db: MemoryDb;
  project: Row;
} {
  const db = resetHarness({ atomic: true });
  const { projectId } = seedProject(db, { pages: 2 });
  const project = db.find("projects", (r) => r.id === projectId)!;
  if (opts.owner) project.user_id = opts.owner;
  db.find("profiles", (r) => r.id === USER_ID)!.deleted_at = opts.deleted
    ? "2026-09-17T00:00:00Z"
    : null;
  for (const status of opts.orders ?? []) {
    seedOrder(db, { projectId, pages: 2, status });
  }
  db.calls = [];
  return { db, project };
}

function edited(project: Row): PageDoc {
  return { ...(project.cover_json as PageDoc), backgroundColor: "#000000" };
}

function patch(body: unknown) {
  return PATCH(
    new Request("https://100pbooks.vercel.app/api/cover", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

function writes(db: MemoryDb): string[] {
  return db.calls.filter((c) => !c.startsWith("select:"));
}

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

describe("PATCH /api/cover — 결제 후 편집 잠금", () => {
  it.each(LOCKING)("%s 주문이 있으면 409 PROJECT_LOCKED, 표지·퍼널 쓰기 0건", async (status) => {
    const { db, project } = setup({ orders: [status] });
    const res = await patch({
      projectId: project.id,
      fabricJson: edited(project),
      baseVersion: computeDocVersion(project.cover_json),
    });
    const json = await readJson(res);
    expect(res.status).toBe(409);
    expect(json.error?.code).toBe("PROJECT_LOCKED");
    expect(json.error?.message).toContain("결제가 완료된 포토북은 수정할 수 없어요");
    expect(writes(db)).toEqual([]);
    expect((project.cover_json as PageDoc).backgroundColor).toBe("#ffffff");
  });

  it("잠금이 버전 판정보다 먼저 — 옛 baseVersion 이어도 PROJECT_LOCKED", async () => {
    const { db, project } = setup({ orders: ["delivered"] });
    const res = await patch({
      projectId: project.id,
      fabricJson: edited(project),
      baseVersion: "v1-stale-base-version",
    });
    expect(res.status).toBe(409);
    expect((await readJson(res)).error?.code).toBe("PROJECT_LOCKED");
    expect(writes(db)).toEqual([]);
  });

  it("pending·cancelled·refunded 주문만 있으면 저장된다", async () => {
    const { db, project } = setup({ orders: ["pending", "cancelled", "refunded"] });
    const res = await patch({
      projectId: project.id,
      fabricJson: edited(project),
      baseVersion: computeDocVersion(project.cover_json),
    });
    expect(res.status).toBe(200);
    expect(writes(db)).toContain("update:projects");
    const saved = db.find("projects", (r) => r.id === project.id)!;
    expect((saved.cover_json as PageDoc).backgroundColor).toBe("#000000");
  });

  it("남의 결제된 표지는 403 — 잠금 조회 전에 멈춘다", async () => {
    const { db, project } = setup({ orders: ["paid"], owner: OTHER_USER });
    const res = await patch({
      projectId: project.id,
      fabricJson: edited(project),
      baseVersion: computeDocVersion(project.cover_json),
    });
    expect(res.status).toBe(403);
    expect(db.calls).not.toContain("select:orders");
    expect(writes(db)).toEqual([]);
  });

  it("탈퇴 계정 → 410 ACCOUNT_DELETED, 프로젝트 조회 전에 멈춘다", async () => {
    const { db, project } = setup({ deleted: true });
    const res = await patch({
      projectId: project.id,
      fabricJson: edited(project),
      baseVersion: computeDocVersion(project.cover_json),
    });
    expect(res.status).toBe(410);
    expect((await readJson(res)).error?.code).toBe("ACCOUNT_DELETED");
    expect(db.calls).toEqual(["select:profiles"]);
  });
});

// @vitest-environment node
import type * as ReactModule from "react";
import { describe, expect, it, vi } from "vitest";

import { readJson, resetHarness, USER_ID } from "@/app/api/payments/_test/harness";
import type { MemoryDb } from "@/app/api/payments/_test/memory-supabase";

/**
 * POST /api/photos/trash · /api/photos/restore — 성공 응답 모양 일관화.
 *
 * 클라이언트(PhotoLibraryClient·TrashClient)가 skippedLocked·skippedQuota 를 읽어 제외 사유를 안내한다.
 * 조기 반환 경로(휴지통 사진 없음·한도 초과)에도 같은 필드가 있어야 undefined 처리 없이 읽을 수 있다.
 * (부분 잠금 처리 자체는 lib/orders/edit-lock.routes.test.ts 가 고정한다.)
 */

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof ReactModule>();
  return { ...actual, cache: <T>(fn: T): T => fn };
});

/** 인메모리 하네스에 없는 `.not(col, "is", null)` 을 neq(col, null)(IS NOT NULL)로 잇는다. */
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
  return { createAdminSupabase: () => adapt.withNot(h.db.client()) };
});

import { POST as restore } from "./route";
import { POST as trash } from "../trash/route";

const PROJECT = "22222222-2222-4222-8222-222222222222";

function setup(): MemoryDb {
  const db = resetHarness({ atomic: true });
  db.seed("profiles", { id: USER_ID, deleted_at: null });
  db.seed("projects", { id: PROJECT, user_id: USER_ID });
  return db;
}

function post(handler: (req: Request) => Promise<Response>, photoIds: string[]) {
  return handler(
    new Request("https://100pbooks.vercel.app/api/photos/x", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ photoIds }),
    }),
  );
}

describe("응답 모양 일관화 — 조기 반환에도 skippedLocked·skippedQuota", () => {
  it("trash: 옮길 사진이 없으면 { updated: 0, skipped, skippedLocked: 0 }", async () => {
    const db = setup();
    const trashed = db.seed("photos", { project_id: PROJECT, deleted_at: "2026-09-10T00:00:00Z" });
    const res = await post(trash, [String(trashed.id)]);
    expect(res.status).toBe(200);
    expect((await readJson(res)).data).toEqual({ updated: 0, skipped: 1, skippedLocked: 0 });
  });

  it("restore: 휴지통 사진이 없으면 NOT_IN_TRASH + skippedQuota 0 + skippedLocked 0", async () => {
    const db = setup();
    const active = db.seed("photos", { project_id: PROJECT, deleted_at: null });
    const res = await post(restore, [String(active.id)]);
    expect(res.status).toBe(200);
    expect((await readJson(res)).data).toEqual({
      restored: 0,
      skipped: 1,
      skippedQuota: 0,
      skippedLocked: 0,
      reason: "NOT_IN_TRASH",
    });
  });

  it("restore: 전부 한도 초과면 QUOTA_EXCEEDED + 실제 skippedQuota 수", async () => {
    const db = setup();
    for (let i = 0; i < 100; i += 1) {
      db.seed("photos", { project_id: PROJECT, deleted_at: null });
    }
    const a = db.seed("photos", { project_id: PROJECT, deleted_at: "2026-09-10T00:00:00Z" });
    const b = db.seed("photos", { project_id: PROJECT, deleted_at: "2026-09-10T00:00:00Z" });
    const res = await post(restore, [String(a.id), String(b.id)]);
    expect(res.status).toBe(200);
    expect((await readJson(res)).data).toEqual({
      restored: 0,
      skipped: 2,
      skippedQuota: 2,
      skippedLocked: 0,
      reason: "QUOTA_EXCEEDED",
    });
  });

  it("restore: 정상 복원도 같은 필드", async () => {
    const db = setup();
    const a = db.seed("photos", { project_id: PROJECT, deleted_at: "2026-09-10T00:00:00Z" });
    const res = await post(restore, [String(a.id)]);
    expect((await readJson(res)).data).toEqual({
      restored: 1,
      skipped: 0,
      skippedQuota: 0,
      skippedLocked: 0,
    });
  });
});

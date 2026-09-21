// @vitest-environment node
import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MemoryDb } from "@/app/api/payments/_test/memory-supabase";
import type { Database } from "@/lib/db/types";
import { PROJECT_LOCKED_MESSAGE } from "@/lib/orders/edit-lock";

import { readProjectLockNotice } from "./lock-notice";

/**
 * 진입 안내용 잠금 판정 — 잠김/열림/조회 실패(안내 생략, 진입은 막지 않음).
 */

const PROJECT = "22222222-2222-4222-8222-222222222222";

function admin(db: MemoryDb): SupabaseClient<Database> {
  return db.client() as unknown as SupabaseClient<Database>;
}

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

describe("readProjectLockNotice", () => {
  it.each(["paid", "in_production", "shipped", "delivered"])("%s 주문 → 잠금 안내 문구", async (status) => {
    const db = new MemoryDb();
    db.seed("orders", { project_id: PROJECT, status });
    await expect(readProjectLockNotice(admin(db), PROJECT)).resolves.toBe(PROJECT_LOCKED_MESSAGE);
  });

  it("pending·cancelled·refunded 만 있거나 주문이 없으면 null", async () => {
    const db = new MemoryDb();
    await expect(readProjectLockNotice(admin(db), PROJECT)).resolves.toBeNull();
    for (const status of ["pending", "cancelled", "refunded"]) {
      db.seed("orders", { project_id: PROJECT, status });
    }
    await expect(readProjectLockNotice(admin(db), PROJECT)).resolves.toBeNull();
  });

  it("다른 프로젝트의 결제 주문은 영향 없음", async () => {
    const db = new MemoryDb();
    db.seed("orders", { project_id: "33333333-3333-4333-8333-333333333333", status: "paid" });
    await expect(readProjectLockNotice(admin(db), PROJECT)).resolves.toBeNull();
  });

  it("주문 조회 실패 → null (진입 화면을 막지 않는다 — 쓰기는 API 가 fail-closed)", async () => {
    const db = new MemoryDb();
    db.seed("orders", { project_id: PROJECT, status: "paid" });
    db.failOnce.set("select:orders", { message: "timeout" });
    await expect(readProjectLockNotice(admin(db), PROJECT)).resolves.toBeNull();
  });
});

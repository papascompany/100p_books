// @vitest-environment node
import type * as ReactModule from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { readJson, resetHarness, USER_ID } from "@/app/api/payments/_test/harness";
import type { MemoryDb, Row } from "@/app/api/payments/_test/memory-supabase";

import { effectiveGiftStatus, shouldPersistExpiry } from "./gift-status";
import { giftSenderOwnsOrder } from "./sender-guard";

/**
 * GET·POST /api/gifts/[token] — 발신자 = 원본 주문자 = 프로젝트 소유자 검증 (방어 보강).
 *
 * 0032(클라이언트 직접 쓰기 봉쇄) 전에는 사용자 JWT 로 gifts 를 직접 INSERT 해 **남의 결제 주문**을
 * 가리키는 선물을 만들 수 있었다. revoke 는 이미 생긴 행을 지우지 않으므로 수령 시점에 다시 막는다.
 */

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof ReactModule>();
  return { ...actual, cache: <T>(fn: T): T => fn };
});

const storage = vi.hoisted(() => ({ copies: [] as string[] }));

vi.mock("@/lib/db/server", async () => {
  const { harness: h, USER_ID: uid } = await import("@/app/api/payments/_test/harness");
  return {
    createServerSupabase: () => ({
      ...h.db.client(),
      auth: {
        getUser: async () => ({ data: { user: { id: uid, email: "recipient@example.com" } } }),
      },
    }),
  };
});
vi.mock("@/lib/db/admin", async () => {
  const { harness: h } = await import("@/app/api/payments/_test/harness");
  return {
    createAdminSupabase: () => ({
      ...h.db.client(),
      storage: {
        from: (bucket: string) => ({
          copy: async (from: string, to: string) => {
            storage.copies.push(`${bucket}:${from}->${to}`);
            return { data: {}, error: null };
          },
          remove: async () => ({ data: [], error: null }),
        }),
      },
    }),
  };
});
vi.mock("@/lib/email/queue", async () => {
  const { fakes } = await import("@/app/api/payments/_test/harness");
  return { enqueueEmail: fakes.enqueueEmail };
});

import { GET, POST } from "./route";

const SENDER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const VICTIM = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const TOKEN = "0c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f";
const PROJECT = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

function setup(opts: {
  orderUser: string;
  projectUser: string;
  status?: "pending" | "claimed" | "expired";
  expiresAt?: string;
}): { db: MemoryDb; gift: Row } {
  const db = resetHarness({ atomic: true });
  storage.copies = [];
  db.seed("profiles", { id: USER_ID, deleted_at: null, email: "recipient@example.com" });
  db.seed("profiles", { id: SENDER, display_name: "보낸이", email: "sender@example.com" });
  db.seed("projects", { id: PROJECT, user_id: opts.projectUser, title: "남의 책" });
  db.seed("photos", {
    project_id: PROJECT,
    storage_key: `${opts.projectUser}/${PROJECT}/p.jpg`,
    thumb_key: null,
    filename: "p.jpg",
    mime: "image/jpeg",
    size_bytes: 10,
    width: 10,
    height: 10,
    exif_taken_at: null,
    exif_camera: null,
    order_idx: 0,
    deleted_at: null,
  });
  // MemoryDb 는 중첩 select 를 모르므로 조인 결과(orders → projects)를 행에 미리 싣는다.
  const gift = db.seed("gifts", {
    order_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    sender_id: SENDER,
    recipient_email: "recipient@example.com",
    message: null,
    gift_token: TOKEN,
    status: opts.status ?? "pending",
    claimed_project_id: opts.status === "claimed" ? "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee" : null,
    claimed_at: null,
    expires_at: opts.expiresAt ?? "2099-01-01T00:00:00Z",
    created_at: "2026-09-01T00:00:00Z",
    orders: {
      id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      user_id: opts.orderUser,
      status: "paid",
      project_id: PROJECT,
      projects: {
        id: PROJECT,
        user_id: opts.projectUser,
        title: "남의 책",
        layout_mode: "polaroid",
        cover_json: null,
        book_size_id: "ffffffff-ffff-4fff-8fff-ffffffffffff",
        book_sizes: { name: "A5" },
      },
    },
  });
  db.calls = [];
  return { db, gift };
}

function claim() {
  return POST(
    new Request(`https://100pbooks.vercel.app/api/gifts/${TOKEN}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "claim" }),
    }),
    { params: Promise.resolve({ token: TOKEN }) },
  );
}

function preview() {
  return GET(new Request(`https://100pbooks.vercel.app/api/gifts/${TOKEN}`), {
    params: Promise.resolve({ token: TOKEN }),
  });
}

/** MemoryDb 호출 로그(`action:table`) 중 쓰기만. GET 이 읽기 전용인지 검사한다. */
function writeCalls(db: MemoryDb): string[] {
  return db.calls.filter((c) =>
    /^(insert|update|upsert|delete|rpc):/.test(c),
  );
}

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("선물 수령 — 발신자가 원본 주문자가 아니면 거부·만료", () => {
  it("남의 주문을 가리키는 pending 선물 → 404(토큰 없음과 같은 응답), 만료, 복제 0건", async () => {
    const { db, gift } = setup({ orderUser: VICTIM, projectUser: VICTIM });
    const res = await claim();
    const json = await readJson(res);
    expect(res.status).toBe(404);
    expect(json.error).toEqual({ code: "NOT_FOUND", message: "유효하지 않은 선물 링크입니다." });
    expect(db.find("gifts", (r) => r.id === gift.id)?.status).toBe("expired");
    expect(db.calls).not.toContain("insert:projects");
    expect(db.calls).not.toContain("insert:photos");
    expect(storage.copies).toEqual([]);
  });

  it("주문자는 맞아도 프로젝트 소유자가 다르면 거부", async () => {
    const { db } = setup({ orderUser: SENDER, projectUser: VICTIM });
    const res = await claim();
    expect(res.status).toBe(404);
    expect(db.calls).not.toContain("insert:projects");
  });

  it("이미 수령된 부정 선물 — 멱등 응답으로 프로젝트 id 를 내주지 않고, 수령 기록은 바꾸지 않는다", async () => {
    const { db, gift } = setup({ orderUser: VICTIM, projectUser: VICTIM, status: "claimed" });
    const res = await claim();
    expect(res.status).toBe(404);
    expect((await readJson(res)).data).toBeUndefined();
    expect(db.find("gifts", (r) => r.id === gift.id)?.status).toBe("claimed");
  });

  it("미리보기(GET)도 같은 판정 — 남의 포토북 제목·장수를 노출하지 않는다", async () => {
    const { db, gift } = setup({ orderUser: VICTIM, projectUser: VICTIM });
    const res = await preview();
    expect(res.status).toBe(404);
    expect(JSON.stringify(await readJson(res))).not.toContain("남의 책");
    // 탐지는 하되 **쓰기는 하지 않는다** — 만료 처리는 claim 경로 몫이다.
    expect(db.find("gifts", (r) => r.id === gift.id)?.status).toBe("pending");
    expect(writeCalls(db)).toEqual([]);
  });

  it("정상 선물(발신자 = 주문자 = 소유자)은 수령된다", async () => {
    const { db, gift } = setup({ orderUser: SENDER, projectUser: SENDER });
    const res = await claim();
    const json = await readJson(res);
    expect(res.status).toBe(200);
    expect(json.data?.alreadyClaimed).toBe(false);
    expect(db.calls).toContain("insert:projects");
    expect(db.find("gifts", (r) => r.id === gift.id)?.status).toBe("claimed");
  });
});

describe("미리보기(GET)는 읽기 전용 — 상태를 바꾸지 않는다", () => {
  const PAST = "2020-01-01T00:00:00Z";

  it("만료된 pending 선물 — 응답 status 는 expired 지만 DB 행은 그대로", async () => {
    const { db, gift } = setup({
      orderUser: SENDER,
      projectUser: SENDER,
      expiresAt: PAST,
    });
    const res = await preview();
    const json = await readJson(res);
    expect(res.status).toBe(200);
    expect(json.data?.status).toBe("expired");
    expect(db.find("gifts", (r) => r.id === gift.id)?.status).toBe("pending");
    expect(writeCalls(db)).toEqual([]);
  });

  it("정상 pending 선물 — 미리보기가 깨지지 않고, 쓰기도 없다", async () => {
    const { db, gift } = setup({ orderUser: SENDER, projectUser: SENDER });
    const res = await preview();
    const json = await readJson(res);
    expect(res.status).toBe(200);
    expect(json.data?.status).toBe("pending");
    expect((json.data?.project as { title?: string } | undefined)?.title).toBe("남의 책");
    expect(json.data?.senderName).toBe("보낸이");
    expect(db.find("gifts", (r) => r.id === gift.id)?.status).toBe("pending");
    expect(writeCalls(db)).toEqual([]);
  });

  it("이미 수령된 선물 — status 는 claimed 그대로, 쓰기 없음", async () => {
    const { db } = setup({
      orderUser: SENDER,
      projectUser: SENDER,
      status: "claimed",
    });
    const res = await preview();
    expect((await readJson(res)).data?.status).toBe("claimed");
    expect(writeCalls(db)).toEqual([]);
  });

  it("만료 처리(쓰기)는 claim 경로에만 남는다 — 410 + DB expired", async () => {
    const { db, gift } = setup({
      orderUser: SENDER,
      projectUser: SENDER,
      expiresAt: PAST,
    });
    const res = await claim();
    expect(res.status).toBe(410);
    expect((await readJson(res)).error?.code).toBe("GIFT_EXPIRED");
    expect(db.find("gifts", (r) => r.id === gift.id)?.status).toBe("expired");
  });

  it("부정 gift 의 만료 처리도 claim 경로에서만 일어난다", async () => {
    const { db, gift } = setup({ orderUser: VICTIM, projectUser: VICTIM });
    await preview();
    expect(db.find("gifts", (r) => r.id === gift.id)?.status).toBe("pending");
    await claim();
    expect(db.find("gifts", (r) => r.id === gift.id)?.status).toBe("expired");
  });
});

describe("effectiveGiftStatus / shouldPersistExpiry", () => {
  const NOW = Date.parse("2026-09-21T00:00:00Z");

  it("pending 은 만료일이 지났을 때만 expired 로 계산된다", () => {
    expect(effectiveGiftStatus("pending", "2026-09-22T00:00:00Z", NOW)).toBe("pending");
    expect(effectiveGiftStatus("pending", "2026-09-21T00:00:00Z", NOW)).toBe("pending");
    expect(effectiveGiftStatus("pending", "2026-09-20T23:59:59Z", NOW)).toBe("expired");
  });

  it("pending 이 아니면 만료일과 무관하게 그대로", () => {
    expect(effectiveGiftStatus("claimed", "2020-01-01T00:00:00Z", NOW)).toBe("claimed");
    expect(effectiveGiftStatus("expired", "2099-01-01T00:00:00Z", NOW)).toBe("expired");
  });

  it("파싱 불가한 만료일은 만료로 본다 (유효로 오인해 수령을 열지 않는다)", () => {
    expect(effectiveGiftStatus("pending", "not-a-date", NOW)).toBe("expired");
  });

  it("DB 기록이 필요한 전이는 pending → expired 뿐", () => {
    expect(shouldPersistExpiry("pending", "2026-09-20T00:00:00Z", NOW)).toBe(true);
    expect(shouldPersistExpiry("pending", "2026-09-22T00:00:00Z", NOW)).toBe(false);
    expect(shouldPersistExpiry("claimed", "2020-01-01T00:00:00Z", NOW)).toBe(false);
    expect(shouldPersistExpiry("expired", "2020-01-01T00:00:00Z", NOW)).toBe(false);
  });
});

describe("giftSenderOwnsOrder", () => {
  it("세 값이 모두 같을 때만 true", () => {
    expect(giftSenderOwnsOrder({ senderId: SENDER, orderUserId: SENDER, projectUserId: SENDER })).toBe(true);
    expect(giftSenderOwnsOrder({ senderId: SENDER, orderUserId: VICTIM, projectUserId: SENDER })).toBe(false);
    expect(giftSenderOwnsOrder({ senderId: SENDER, orderUserId: SENDER, projectUserId: VICTIM })).toBe(false);
    expect(giftSenderOwnsOrder({ senderId: SENDER, orderUserId: null, projectUserId: SENDER })).toBe(false);
    expect(giftSenderOwnsOrder({ senderId: "", orderUserId: "", projectUserId: "" })).toBe(false);
  });
});

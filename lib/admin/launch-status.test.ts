import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * lib/admin/launch-status.test.ts
 *
 * 고정하는 계약: CRON_SECRET 미설정은 "주의" 가 아니라 런치 **차단** 이다.
 * lib/security/cron-auth.ts(SEC-14)가 배포 환경에서 CRON_SECRET 없이는 모든 cron 을 거부
 * (fail-closed)하므로, 메일 재시도·출석 리셋·PDF 보존·사진 정리가 전부 멈춘다.
 * 관리자 카드(components/admin/LaunchChecklist.tsx)는 blocking && status !== "ok" 를 차단으로 센다.
 */

vi.mock("server-only", () => ({}));

vi.mock("@/lib/db/admin", () => {
  // resources·book_sizes head-count — select().eq()...(await) 체인. 1건씩 있다고 본다.
  function countQuery() {
    const q = {
      select: () => q,
      eq: () => q,
      then: (resolve: (v: { count: number; error: null }) => unknown) =>
        Promise.resolve({ count: 1, error: null }).then(resolve),
    };
    return q;
  }
  return { createAdminSupabase: () => ({ from: () => countQuery() }) };
});

import { getLaunchStatus, type LaunchItem } from "./launch-status";

async function cronItem(): Promise<LaunchItem> {
  const item = (await getLaunchStatus()).find((i) => i.key === "cron");
  if (!item) throw new Error("cron 항목이 없습니다");
  return item;
}

/** LaunchChecklist.tsx 의 차단 판정과 같은 식. */
const isBlocker = (i: LaunchItem) => i.blocking && i.status !== "ok";

beforeEach(() => {
  vi.stubEnv("CRON_SECRET", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("getLaunchStatus — cron (CRON_SECRET)", () => {
  it("미설정이면 차단 항목(off·blocking)이고 라벨이 필수임을 드러낸다", async () => {
    const item = await cronItem();

    expect(item).toMatchObject({
      label: "Cron 실행 (CRON_SECRET 필수)",
      status: "off",
      blocking: true,
    });
    expect(isBlocker(item)).toBe(true);
    expect(item.impact).toContain("cron 4종");
  });

  it("공백뿐인 값도 미설정으로 본다", async () => {
    vi.stubEnv("CRON_SECRET", "   ");

    expect(isBlocker(await cronItem())).toBe(true);
  });

  it("설정되면 ok — 차단에서 빠진다", async () => {
    vi.stubEnv("CRON_SECRET", "cron-secret-0123456789abcdef");

    const item = await cronItem();

    expect(item.status).toBe("ok");
    expect(isBlocker(item)).toBe(false);
  });
});

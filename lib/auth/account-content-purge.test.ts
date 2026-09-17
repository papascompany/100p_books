import { beforeEach, describe, expect, it } from "vitest";

import {
  type AccountContentPort,
  ownStorageKeys,
  purgeAccountContent,
} from "./account-content-purge";

/**
 * 탈퇴 콘텐츠 정리 — 인메모리 저장소로 FK cascade·참조 공유를 흉내 내 의미를 검증한다.
 */

const ME = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";

interface Db {
  projects: Array<{ id: string; user_id: string }>;
  orders: Array<{ id: string; project_id: string }>;
  photos: Array<{ id: string; project_id: string; storage_key: string; thumb_key: string | null }>;
  shareTokens: Array<{ id: string; project_id: string }>;
  profile: { avatar_url: string | null; oauth_provider: string | null };
  originals: Set<string>;
  thumbs: Set<string>;
}

let db: Db;

function seed(): Db {
  const photo = (id: string, projectId: string, owner: string) => ({
    id,
    project_id: projectId,
    storage_key: `${owner}/${projectId}/${id}.jpg`,
    thumb_key: `${owner}/${projectId}/${id}.webp`,
  });
  const photos = [
    // 주문 없는 초안 프로젝트
    photo("ph-draft-1", "p-draft", ME),
    { ...photo("ph-draft-2", "p-draft", ME), thumb_key: null },
    // 주문된 프로젝트
    photo("ph-ordered-1", "p-ordered", ME),
    // 선물 수령 프로젝트 — 복사 실패 폴백으로 발신자(OTHER) 원본 키를 그대로 참조
    {
      id: "ph-gift-1",
      project_id: "p-gift",
      storage_key: `${OTHER}/p-sender/ph-src.jpg`,
      thumb_key: `${OTHER}/p-sender/ph-src.webp`,
    },
    // 초안 사진과 같은 키를 주문된 프로젝트가 참조 (키 공유)
    {
      id: "ph-ordered-shared",
      project_id: "p-ordered",
      storage_key: `${ME}/p-draft/ph-draft-1.jpg`,
      thumb_key: `${ME}/p-draft/ph-draft-1.webp`,
    },
    // 다른 사용자의 사진 — 절대 건드리면 안 됨
    { id: "ph-sender", project_id: "p-sender", storage_key: `${OTHER}/p-sender/ph-src.jpg`, thumb_key: `${OTHER}/p-sender/ph-src.webp` },
  ];
  return {
    projects: [
      { id: "p-draft", user_id: ME },
      { id: "p-ordered", user_id: ME },
      { id: "p-gift", user_id: ME },
      { id: "p-sender", user_id: OTHER },
    ],
    orders: [
      { id: "o-1", project_id: "p-ordered" },
      { id: "o-2", project_id: "p-ordered" },
      { id: "o-sender", project_id: "p-sender" },
    ],
    photos,
    shareTokens: [
      { id: "st-draft", project_id: "p-draft" },
      { id: "st-ordered", project_id: "p-ordered" },
      { id: "st-sender", project_id: "p-sender" },
    ],
    profile: { avatar_url: "https://k.kakaocdn.net/me.jpg", oauth_provider: "kakao" },
    originals: new Set(photos.map((p) => p.storage_key)),
    thumbs: new Set(photos.map((p) => p.thumb_key).filter((k): k is string => k !== null)),
  };
}

function makePort(
  userId: string,
  opts: { failOn?: keyof AccountContentPort } = {},
): { port: AccountContentPort; calls: string[] } {
  const calls: string[] = [];
  const guard = (name: keyof AccountContentPort) => {
    calls.push(name);
    if (opts.failOn === name) throw new Error(`${name}: injected failure`);
  };
  const port: AccountContentPort = {
    async listOwnedProjectIds() {
      guard("listOwnedProjectIds");
      return db.projects.filter((p) => p.user_id === userId).map((p) => p.id);
    },
    async revokeShareTokens(ids) {
      guard("revokeShareTokens");
      db.shareTokens = db.shareTokens.filter((t) => !ids.includes(t.project_id));
    },
    async clearProfileIdentityFields() {
      guard("clearProfileIdentityFields");
      db.profile = { avatar_url: null, oauth_provider: null };
    },
    async listOrderedProjectIds(ids) {
      guard("listOrderedProjectIds");
      return db.orders.filter((o) => ids.includes(o.project_id)).map((o) => o.project_id);
    },
    async listPhotoKeys(ids) {
      guard("listPhotoKeys");
      return db.photos
        .filter((p) => ids.includes(p.project_id))
        .map((p) => ({ storage_key: p.storage_key, thumb_key: p.thumb_key }));
    },
    async deleteProjects(ids) {
      guard("deleteProjects");
      const targets = db.projects.filter((p) => ids.includes(p.id) && p.user_id === userId).map((p) => p.id);
      if (db.orders.some((o) => targets.includes(o.project_id))) {
        throw new Error("orders_project_id_fkey");
      }
      // FK cascade: photos · share_tokens
      db.projects = db.projects.filter((p) => !targets.includes(p.id));
      db.photos = db.photos.filter((p) => !targets.includes(p.project_id));
      db.shareTokens = db.shareTokens.filter((t) => !targets.includes(t.project_id));
    },
    async listReferencedKeys(column, keys) {
      guard("listReferencedKeys");
      return db.photos
        .map((p) => p[column])
        .filter((k): k is string => typeof k === "string" && keys.includes(k));
    },
    async removeStorageObjects(bucket, keys) {
      guard("removeStorageObjects");
      const set = bucket === "originals" ? db.originals : db.thumbs;
      for (const k of keys) set.delete(k);
    },
  };
  return { port, calls };
}

beforeEach(() => {
  db = seed();
});

describe("purgeAccountContent", () => {
  it("공유 링크 전부 폐기(주문된 프로젝트 포함), 다른 사용자 링크는 유지", async () => {
    await purgeAccountContent(ME, makePort(ME).port);
    expect(db.shareTokens.map((t) => t.id)).toEqual(["st-sender"]);
  });

  it("profiles.avatar_url · oauth_provider 를 비운다", async () => {
    await purgeAccountContent(ME, makePort(ME).port);
    expect(db.profile).toEqual({ avatar_url: null, oauth_provider: null });
  });

  it("주문 없는 프로젝트만 삭제, 주문된 프로젝트와 그 사진은 보존", async () => {
    const report = await purgeAccountContent(ME, makePort(ME).port);
    expect(db.projects.map((p) => p.id).sort()).toEqual(["p-ordered", "p-sender"]);
    expect(db.photos.map((p) => p.id).sort()).toEqual([
      "ph-ordered-1",
      "ph-ordered-shared",
      "ph-sender",
    ]);
    expect(report).toMatchObject({
      ownedProjects: 3,
      retainedOrderedProjects: 1,
      deletedProjects: 2,
      storageCleanupDeferred: false,
    });
  });

  it("Storage: 본인 폴더 + 참조가 끊긴 키만 제거 (공유 키·다른 사용자 키 보존)", async () => {
    const report = await purgeAccountContent(ME, makePort(ME).port);
    // ph-draft-1 키는 주문된 프로젝트가 아직 참조 → 보존
    expect(db.originals.has(`${ME}/p-draft/ph-draft-1.jpg`)).toBe(true);
    expect(db.thumbs.has(`${ME}/p-draft/ph-draft-1.webp`)).toBe(true);
    // ph-draft-2 는 참조가 없어져 제거 (썸네일은 원래 없음)
    expect(db.originals.has(`${ME}/p-draft/ph-draft-2.jpg`)).toBe(false);
    // 선물 폴백으로 참조하던 발신자 원본은 본인 폴더가 아니므로 절대 제거하지 않음
    expect(db.originals.has(`${OTHER}/p-sender/ph-src.jpg`)).toBe(true);
    expect(db.thumbs.has(`${OTHER}/p-sender/ph-src.webp`)).toBe(true);
    // 주문된 프로젝트의 사진 원본 보존
    expect(db.originals.has(`${ME}/p-ordered/ph-ordered-1.jpg`)).toBe(true);
    expect(report.removedStorageObjects).toBe(1);
  });

  it("단계 순서: 공유 링크 → 프로필 → 주문 조회 → 키 수집 → 프로젝트 삭제 → 참조 확인 → Storage", async () => {
    const { port, calls } = makePort(ME);
    await purgeAccountContent(ME, port);
    expect(calls).toEqual([
      "listOwnedProjectIds",
      "revokeShareTokens",
      "clearProfileIdentityFields",
      "listOrderedProjectIds",
      "listPhotoKeys",
      "deleteProjects",
      "listReferencedKeys",
      "listReferencedKeys",
      "removeStorageObjects",
    ]);
  });

  it("공유 링크 폐기 실패 → throw, 이후 단계(프로젝트 삭제 등) 실행 안 함", async () => {
    const { port, calls } = makePort(ME, { failOn: "revokeShareTokens" });
    await expect(purgeAccountContent(ME, port)).rejects.toThrow("revokeShareTokens");
    expect(calls).toEqual(["listOwnedProjectIds", "revokeShareTokens"]);
    expect(db.projects).toHaveLength(4);
  });

  it("프로젝트 삭제 실패(예: 방금 주문이 붙어 FK 위반) → throw (탈퇴 5xx, 재시도)", async () => {
    const { port } = makePort(ME, { failOn: "deleteProjects" });
    await expect(purgeAccountContent(ME, port)).rejects.toThrow("deleteProjects");
  });

  it("Storage 제거 실패는 throw 하지 않고 cron 에 맡긴다 (행은 이미 삭제됨)", async () => {
    const { port } = makePort(ME, { failOn: "removeStorageObjects" });
    const report = await purgeAccountContent(ME, port);
    expect(report.storageCleanupDeferred).toBe(true);
    expect(report.storageCleanupError).toContain("removeStorageObjects");
    expect(db.projects.map((p) => p.id)).not.toContain("p-draft");
  });

  it("참조 확인 실패도 Storage 를 건드리지 않고 cron 에 맡긴다", async () => {
    const { port, calls } = makePort(ME, { failOn: "listReferencedKeys" });
    const report = await purgeAccountContent(ME, port);
    expect(report.storageCleanupDeferred).toBe(true);
    expect(calls).not.toContain("removeStorageObjects");
    expect(db.originals.has(`${ME}/p-draft/ph-draft-2.jpg`)).toBe(true);
  });

  it("멱등: 두 번 실행해도 결과가 같고 두 번째는 지울 것이 없다", async () => {
    await purgeAccountContent(ME, makePort(ME).port);
    const snapshot = JSON.stringify({
      ...db,
      originals: [...db.originals].sort(),
      thumbs: [...db.thumbs].sort(),
    });
    const { port, calls } = makePort(ME);
    const second = await purgeAccountContent(ME, port);
    expect(second).toMatchObject({ deletedProjects: 0, removedStorageObjects: 0 });
    expect(calls).not.toContain("deleteProjects");
    expect(
      JSON.stringify({ ...db, originals: [...db.originals].sort(), thumbs: [...db.thumbs].sort() }),
    ).toBe(snapshot);
  });

  it("프로젝트 삭제 도중 실패 후 재시도하면 남은 것을 마저 정리한다", async () => {
    await expect(
      purgeAccountContent(ME, makePort(ME, { failOn: "deleteProjects" }).port),
    ).rejects.toThrow();
    await purgeAccountContent(ME, makePort(ME).port);
    expect(db.projects.map((p) => p.id).sort()).toEqual(["p-ordered", "p-sender"]);
    expect(db.shareTokens.map((t) => t.id)).toEqual(["st-sender"]);
  });

  it("프로젝트가 없어도 프로필 식별 필드는 비운다", async () => {
    const { port, calls } = makePort("33333333-3333-4333-8333-333333333333");
    const report = await purgeAccountContent("33333333-3333-4333-8333-333333333333", port);
    expect(calls).toEqual(["listOwnedProjectIds", "clearProfileIdentityFields"]);
    expect(report).toMatchObject({ ownedProjects: 0, deletedProjects: 0 });
  });
});

describe("ownStorageKeys", () => {
  it("본인 폴더 키만, 중복 제거", () => {
    expect(
      ownStorageKeys(ME, [
        `${ME}/p/a.jpg`,
        `${ME}/p/a.jpg`,
        `${OTHER}/p/b.jpg`,
        null,
        `${ME}/`,
        `${ME}x/p/c.jpg`,
        `x/${ME}/p/d.jpg`,
        `${ME}/../${OTHER}/p/e.jpg`,
        `${ME}/p\\..\\f.jpg`,
      ]),
    ).toEqual([`${ME}/p/a.jpg`]);
  });
});

import "server-only";

import { randomUUID } from "node:crypto";

import { z } from "zod";

import { fail, failFromError, ok } from "@/app/api/_lib/response";
import { requireUser } from "@/lib/auth/session";
import { createAdminSupabase } from "@/lib/db/admin";
import { enqueueEmail } from "@/lib/email/queue";
import { ORIGINALS_BUCKET, THUMBS_BUCKET } from "@/lib/image/constants";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteCtx = { params: { token: string } };

const TokenSchema = z.string().uuid();

const ActionSchema = z.object({
  action: z.literal("claim"),
});

/** 이메일 prefix — 표시명이 없을 때 fallback. */
function emailPrefix(email: string): string {
  const i = email.indexOf("@");
  return i > 0 ? email.slice(0, i) : email;
}

interface GiftPreview {
  giftId: string;
  status: "pending" | "claimed" | "expired";
  expiresAt: string;
  recipientEmail: string;
  message: string | null;
  senderName: string;
  /** 이미 수령했다면 새 프로젝트 id */
  claimedProjectId: string | null;
  project: {
    id: string;
    title: string;
    bookSizeName: string;
    pageCount: number;
  };
}

/**
 * 만료 검사 + (필요 시) status='expired' 마킹.
 * 반환: 조회 시점 status (실시간 만료 적용 후).
 */
async function ensureExpired(
  admin: ReturnType<typeof createAdminSupabase>,
  giftId: string,
  expiresAt: string,
  currentStatus: "pending" | "claimed" | "expired",
): Promise<"pending" | "claimed" | "expired"> {
  if (currentStatus !== "pending") return currentStatus;
  if (new Date(expiresAt).getTime() >= Date.now()) return currentStatus;
  await admin
    .from("gifts")
    .update({ status: "expired" })
    .eq("id", giftId)
    .eq("status", "pending"); // race-safe
  return "expired";
}

interface LoadedGift {
  gift: {
    id: string;
    order_id: string;
    sender_id: string;
    recipient_email: string;
    message: string | null;
    gift_token: string;
    status: "pending" | "claimed" | "expired";
    claimed_project_id: string | null;
    claimed_at: string | null;
    expires_at: string;
    created_at: string;
  };
  /** 연결된 원본 주문의 현재 상태 — claim 시 환불/취소 여부 재확인용. */
  orderStatus: string;
  project: {
    id: string;
    user_id: string;
    title: string;
    layout_mode: string;
    cover_json: Record<string, unknown> | null;
    book_size_id: string;
    book_sizes: { name: string } | null;
  };
  senderName: string;
  senderEmail: string | null;
  bookSizeName: string;
  pageCount: number;
}

interface LoadError {
  error: { code: string; message: string };
}

type LoadResult = LoadedGift | LoadError;

/**
 * 발신자 + 프로젝트 메타 + 페이지 수 + 책 사이즈를 한 번에 로드.
 * GET / claim 양쪽에서 재사용.
 */
async function loadGiftFull(
  admin: ReturnType<typeof createAdminSupabase>,
  token: string,
): Promise<LoadResult> {
  // gifts + 발신자 profile + order + project + book_size 단일 호출
  const { data: gift, error: giftErr } = await admin
    .from("gifts")
    .select(
      `
      id,
      order_id,
      sender_id,
      recipient_email,
      message,
      gift_token,
      status,
      claimed_project_id,
      claimed_at,
      expires_at,
      created_at,
      orders!inner (
        id,
        status,
        project_id,
        projects!inner (
          id,
          user_id,
          title,
          layout_mode,
          cover_json,
          book_size_id,
          book_sizes ( name )
        )
      )
      `,
    )
    .eq("gift_token", token)
    .maybeSingle();

  if (giftErr) {
    return { error: { code: "GIFT_QUERY_FAILED", message: giftErr.message } };
  }
  if (!gift) {
    return { error: { code: "NOT_FOUND", message: "유효하지 않은 선물 링크입니다." } };
  }

  const order = (gift.orders as unknown) as {
    id: string;
    status: string;
    project_id: string;
    projects: {
      id: string;
      user_id: string;
      title: string;
      layout_mode: string;
      cover_json: Record<string, unknown> | null;
      book_size_id: string;
      book_sizes: { name: string } | null;
    };
  };

  const project = order.projects;

  // 발신자 표시명
  const { data: senderProfile } = await admin
    .from("profiles")
    .select("display_name, email")
    .eq("id", gift.sender_id)
    .maybeSingle();

  const senderName =
    senderProfile?.display_name ||
    (senderProfile?.email ? emailPrefix(senderProfile.email) : "보낸이");

  // 페이지 수
  const { count: pageCount } = await admin
    .from("pages")
    .select("id", { count: "exact", head: true })
    .eq("project_id", project.id);

  return {
    gift: {
      id: gift.id,
      order_id: gift.order_id,
      sender_id: gift.sender_id,
      recipient_email: gift.recipient_email,
      message: gift.message,
      gift_token: gift.gift_token,
      status: gift.status as "pending" | "claimed" | "expired",
      claimed_project_id: gift.claimed_project_id,
      claimed_at: gift.claimed_at,
      expires_at: gift.expires_at,
      created_at: gift.created_at,
    },
    orderStatus: order.status,
    project,
    senderName,
    senderEmail: senderProfile?.email ?? null,
    bookSizeName: project.book_sizes?.name ?? "",
    pageCount: pageCount ?? 0,
  };
}

/**
 * GET /api/gifts/[token]
 *
 * 로그인 필요 — 선물 미리보기 정보 반환.
 * 만료/없음/이미 수령 케이스는 status 값으로 표현 (UI에서 분기).
 */
export async function GET(_req: Request, { params }: RouteCtx) {
  try {
    await requireUser();

    const tokenParse = TokenSchema.safeParse(params.token);
    if (!tokenParse.success) {
      return fail("INVALID_TOKEN", "토큰 형식이 올바르지 않습니다.", 400);
    }
    const token = tokenParse.data;

    const admin = createAdminSupabase();
    const loaded = await loadGiftFull(admin, token);
    if ("error" in loaded) {
      return fail(
        loaded.error.code,
        loaded.error.message,
        loaded.error.code === "NOT_FOUND" ? 404 : 500,
      );
    }
    const { gift, project, senderName, bookSizeName, pageCount } = loaded;

    // 실시간 만료 적용
    const status = await ensureExpired(
      admin,
      gift.id,
      gift.expires_at,
      gift.status,
    );

    const preview: GiftPreview = {
      giftId: gift.id,
      status,
      expiresAt: gift.expires_at,
      recipientEmail: gift.recipient_email,
      message: gift.message,
      senderName,
      claimedProjectId: gift.claimed_project_id,
      project: {
        id: project.id,
        title: project.title,
        bookSizeName,
        pageCount,
      },
    };

    return ok(preview);
  } catch (err) {
    return failFromError(err);
  }
}

/**
 * POST /api/gifts/[token]
 *   body: { action: 'claim' }
 *
 *   수신자가 선물을 수령 — 발신자 프로젝트(+ pages, + cover_json, + photos 메타)를
 *   수신자 계정으로 클론한다.
 *
 *   멱등: 이미 claimed 면 기존 claimed_project_id 그대로 반환.
 *
 *   Storage 정책:
 *     photos 행을 새로 INSERT 하면서 storage 객체(원본 + 썸네일)를 수신자 폴더
 *     ({recipientId}/{newProjectId}/...) 로 admin.storage.copy 한다.
 *     - 발신자가 원본을 삭제해도 수신자 미리보기가 유지된다.
 *     - storage RLS 는 첫 path segment 가 auth.uid() 인지로 권한 검증하므로
 *       수신자 폴더로 복사해야 수신자가 직접 SELECT 할 수 있다.
 *     - copy 실패 시(원본 부재 등) best-effort 폴백: 원본 storage_key 를 그대로 참조.
 */
export async function POST(req: Request, { params }: RouteCtx) {
  try {
    const user = await requireUser();

    const tokenParse = TokenSchema.safeParse(params.token);
    if (!tokenParse.success) {
      return fail("INVALID_TOKEN", "토큰 형식이 올바르지 않습니다.", 400);
    }
    const token = tokenParse.data;

    const raw = (await req.json().catch(() => ({}))) as unknown;
    const actionParse = ActionSchema.safeParse(raw ?? {});
    if (!actionParse.success) {
      return fail(
        "INVALID_BODY",
        "action: 'claim' 이 필요합니다.",
        400,
        actionParse.error.flatten(),
      );
    }

    const admin = createAdminSupabase();
    const loaded = await loadGiftFull(admin, token);
    if ("error" in loaded) {
      return fail(
        loaded.error.code,
        loaded.error.message,
        loaded.error.code === "NOT_FOUND" ? 404 : 500,
      );
    }
    const { gift, project, senderName, bookSizeName, pageCount } = loaded;

    // 자기 자신에게 보낸 선물은 클레임 불가 (의미 없음)
    if (gift.sender_id === user.id) {
      return fail(
        "CANNOT_CLAIM_OWN_GIFT",
        "본인이 보낸 선물은 받을 수 없어요.",
        400,
      );
    }

    // 실시간 만료
    const currentStatus = await ensureExpired(
      admin,
      gift.id,
      gift.expires_at,
      gift.status,
    );

    if (currentStatus === "expired") {
      return fail("GIFT_EXPIRED", "만료된 선물 링크입니다.", 410);
    }

    // 멱등: 이미 claimed
    if (currentStatus === "claimed") {
      if (!gift.claimed_project_id) {
        // 데이터 일관성 깨짐 — 안전하게 에러
        return fail(
          "GIFT_INCONSISTENT",
          "이미 수령된 선물이지만 프로젝트를 찾을 수 없어요. 고객센터로 문의해 주세요.",
          500,
        );
      }
      return ok({ newProjectId: gift.claimed_project_id, alreadyClaimed: true });
    }

    // 원본 주문이 환불/취소되었으면 신규 수령 거부 — 대금이 회수된 콘텐츠가
    //   계속 배포되는 정합성 결함 차단. (발급은 paid 이상만 허용하지만 발급 이후
    //   refunded/cancelled 로 전이될 수 있으므로 claim 시점에 재확인.)
    const giftableOrderStatuses = new Set([
      "paid",
      "in_production",
      "shipped",
      "delivered",
    ]);
    if (!giftableOrderStatuses.has(loaded.orderStatus)) {
      return fail(
        "GIFT_ORDER_NOT_GIFTABLE",
        "원본 주문이 더 이상 유효하지 않아 이 선물을 받을 수 없어요.",
        410,
      );
    }

    // status === 'pending' → 클론 진행
    // 1) 새 project INSERT
    const newProjectId = randomUUID();
    const { error: projInsErr } = await admin.from("projects").insert({
      id: newProjectId,
      user_id: user.id,
      book_size_id: project.book_size_id,
      title: project.title,
      status: "draft",
      layout_mode: (project.layout_mode as "polaroid" | "collage") ?? "polaroid",
      cover_json: project.cover_json,
    });
    if (projInsErr) {
      return fail(
        "PROJECT_CLONE_FAILED",
        `프로젝트 복제 실패: ${projInsErr.message}`,
        500,
      );
    }

    // 2) pages 클론 — fabric_json 그대로 복사. 이 시점에서 photo id 는 "원본 photos 의 id"
    //    인데, 단계 (3) 에서 새 photos id 와 매핑이 필요. 따라서 매핑 테이블을 먼저 만들고
    //    fabric_json 안의 src 등을 추후 단계에서 치환해야 정확하지만 — 본 마일스톤은
    //    photos 동일 storage_key 공유 정책이라 ID 도 동일하게 INSERT 하면 fabric_json 의
    //    photo 참조가 그대로 유효하다.
    //    그러나 photos.id 는 PK 라 동일 id INSERT 불가 → 원본 photo id 는 보존하지 않고
    //    매핑을 만든 뒤 fabric_json 내 photo 참조를 후처리한다.

    // 2-1) 원본 photos 로드
    const { data: srcPhotos, error: srcPhotosErr } = await admin
      .from("photos")
      .select(
        "id, storage_key, thumb_key, filename, mime, size_bytes, width, height, exif_taken_at, exif_camera, order_idx",
      )
      .eq("project_id", project.id)
      .is("deleted_at", null)
      .order("order_idx", { ascending: true });
    if (srcPhotosErr) {
      return fail(
        "SRC_PHOTOS_QUERY_FAILED",
        srcPhotosErr.message,
        500,
      );
    }

    // 2-2) Storage 객체 복사 + 새 photos INSERT
    //   - 발신자가 원본을 삭제해도 수신자 미리보기가 깨지지 않도록 storage 객체를
    //     수신자 폴더({recipientId}/{newProjectId}/...)로 복사한다 (RLS 호환 경로).
    //   - 복사 실패는 best-effort: 원본 storage_key 를 그대로 참조하도록 폴백 (M16-2 원래 정책).
    //     copy 실패 사유는 발신자가 이미 객체를 지웠거나, 일시적 storage 오류 등.
    const photoIdMap: Record<string, string> = {};
    const copiedKeys: { bucket: string; key: string }[] = [];
    if ((srcPhotos ?? []).length > 0) {
      const photosInsert: Array<{
        id: string;
        project_id: string;
        storage_key: string;
        thumb_key: string | null;
        filename: string | null;
        mime: string | null;
        size_bytes: number | null;
        width: number | null;
        height: number | null;
        exif_taken_at: string | null;
        exif_camera: string | null;
        order_idx: number;
      }> = [];

      for (const p of srcPhotos ?? []) {
        const newId = randomUUID();
        photoIdMap[p.id] = newId;

        // 원본 storage_key 의 확장자 유지 (없으면 jpg)
        const origExtMatch = p.storage_key.match(/\.([^.]+)$/);
        const ext = origExtMatch ? origExtMatch[1] : "jpg";

        let nextStorageKey = p.storage_key;
        let nextThumbKey: string | null = p.thumb_key;

        // 원본 buckets/photo-originals 복사 시도
        const targetStorageKey = `${user.id}/${newProjectId}/${newId}.${ext}`;
        const { error: origCopyErr } = await admin.storage
          .from(ORIGINALS_BUCKET)
          .copy(p.storage_key, targetStorageKey);
        if (!origCopyErr) {
          nextStorageKey = targetStorageKey;
          copiedKeys.push({ bucket: ORIGINALS_BUCKET, key: targetStorageKey });
        } else {
          console.warn(
            "[gifts/claim] storage copy(originals) failed — fallback to source key:",
            { src: p.storage_key, error: origCopyErr.message },
          );
        }

        // 썸네일 복사 시도 (있을 때만)
        if (p.thumb_key) {
          const targetThumbKey = `${user.id}/${newProjectId}/${newId}.webp`;
          const { error: thumbCopyErr } = await admin.storage
            .from(THUMBS_BUCKET)
            .copy(p.thumb_key, targetThumbKey);
          if (!thumbCopyErr) {
            nextThumbKey = targetThumbKey;
            copiedKeys.push({ bucket: THUMBS_BUCKET, key: targetThumbKey });
          } else {
            console.warn(
              "[gifts/claim] storage copy(thumbs) failed — fallback to source key:",
              { src: p.thumb_key, error: thumbCopyErr.message },
            );
            // nextThumbKey 는 원본(p.thumb_key) 그대로 유지
          }
        }

        photosInsert.push({
          id: newId,
          project_id: newProjectId,
          storage_key: nextStorageKey,
          thumb_key: nextThumbKey,
          filename: p.filename,
          mime: p.mime,
          size_bytes: p.size_bytes,
          width: p.width,
          height: p.height,
          exif_taken_at: p.exif_taken_at,
          exif_camera: p.exif_camera,
          order_idx: p.order_idx,
        });
      }

      const { error: photoInsErr } = await admin
        .from("photos")
        .insert(photosInsert);
      if (photoInsErr) {
        // 롤백: 방금 만든 project 제거 (cascade 로 photos 도 정리됨) + 복사한 storage 객체 제거
        await admin.from("projects").delete().eq("id", newProjectId);
        for (const { bucket, key } of copiedKeys) {
          await admin.storage
            .from(bucket)
            .remove([key])
            .catch(() => undefined);
        }
        return fail(
          "PHOTOS_CLONE_FAILED",
          `사진 메타 복제 실패: ${photoInsErr.message}`,
          500,
        );
      }
    }

    // 3) pages 클론 — fabric_json 내 photoId 치환
    const rollbackStorage = async () => {
      for (const { bucket, key } of copiedKeys) {
        await admin.storage
          .from(bucket)
          .remove([key])
          .catch(() => undefined);
      }
    };

    const { data: srcPages, error: srcPagesErr } = await admin
      .from("pages")
      .select("page_no, layout_mode, fabric_json")
      .eq("project_id", project.id)
      .order("page_no", { ascending: true });
    if (srcPagesErr) {
      await admin.from("projects").delete().eq("id", newProjectId);
      await rollbackStorage();
      return fail("SRC_PAGES_QUERY_FAILED", srcPagesErr.message, 500);
    }

    if ((srcPages ?? []).length > 0) {
      const pagesInsert = (srcPages ?? []).map((p) => ({
        id: randomUUID(),
        project_id: newProjectId,
        page_no: p.page_no,
        layout_mode: p.layout_mode,
        fabric_json: remapPhotoIdsInFabricJson(p.fabric_json, photoIdMap),
      }));

      const { error: pagesInsErr } = await admin
        .from("pages")
        .insert(pagesInsert);
      if (pagesInsErr) {
        await admin.from("projects").delete().eq("id", newProjectId);
        await rollbackStorage();
        return fail(
          "PAGES_CLONE_FAILED",
          `페이지 복제 실패: ${pagesInsErr.message}`,
          500,
        );
      }
    }

    // cover_json 도 photoId 치환 (단계 1 에서는 원본을 그대로 넣었음)
    const remappedCover = remapPhotoIdsInFabricJson(
      project.cover_json,
      photoIdMap,
    );
    if (remappedCover !== project.cover_json) {
      await admin
        .from("projects")
        .update({ cover_json: remappedCover })
        .eq("id", newProjectId);
    }

    // 4) gifts 상태 갱신 — race-safe (where status='pending')
    const { data: updated, error: updErr } = await admin
      .from("gifts")
      .update({
        status: "claimed",
        claimed_at: new Date().toISOString(),
        claimed_project_id: newProjectId,
      })
      .eq("id", gift.id)
      .eq("status", "pending")
      .select("id, claimed_project_id")
      .maybeSingle();

    if (updErr) {
      // 클론은 됐지만 상태 업데이트 실패 — 다음 GET 에서 멱등 처리되도록 그대로 응답
      console.error("[gifts/claim] status update failed:", updErr.message);
    }
    if (!updated) {
      // 동시성: 다른 요청이 먼저 claim — 우리 클론을 롤백하고 기존 결과 사용
      await admin.from("projects").delete().eq("id", newProjectId);
      await rollbackStorage();
      const { data: latest } = await admin
        .from("gifts")
        .select("claimed_project_id, status")
        .eq("id", gift.id)
        .maybeSingle();
      if (latest?.claimed_project_id) {
        return ok({
          newProjectId: latest.claimed_project_id,
          alreadyClaimed: true,
        });
      }
      return fail("GIFT_RACE", "선물 수령 처리에 실패했어요. 다시 시도해 주세요.", 409);
    }

    // 5) 발신자에게 수령 완료 알림
    const senderEmail = loaded.senderEmail;
    if (senderEmail) {
      const recipientName = user.email
        ? emailPrefix(user.email)
        : emailPrefix(gift.recipient_email);
      await enqueueEmail({
        template: "gift.claimed",
        to: { email: senderEmail },
        context: {
          kind: "gift",
          giftToken: gift.gift_token,
          senderName,
          recipientName,
          bookSizeName,
          pageCount,
          projectTitle: project.title,
        },
        relatedType: "gift",
        relatedId: gift.id,
      });
    }

    return ok({ newProjectId, alreadyClaimed: false });
  } catch (err) {
    return failFromError(err);
  }
}

/**
 * fabric_json (PageDoc 또는 임의 JSON) 안의 photoId 참조를 새 id 로 치환.
 *
 * - 본 마일스톤에서는 storage_key 를 공유하므로 사실상 photo id 외에는 갱신할 필요가 없다.
 * - 안전하게 깊은 walk 로 모든 객체에 대해 키가 'photoId' | 'photo_id' 인 string 값을
 *   매핑이 있을 때만 치환.
 */
function remapPhotoIdsInFabricJson(
  json: Record<string, unknown> | null,
  map: Record<string, string>,
): Record<string, unknown> | null {
  if (!json || Object.keys(map).length === 0) return json;

  const replaceInValue = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(replaceInValue);
    if (v && typeof v === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, vv] of Object.entries(v as Record<string, unknown>)) {
        if (
          (k === "photoId" || k === "photo_id") &&
          typeof vv === "string" &&
          map[vv]
        ) {
          out[k] = map[vv];
        } else {
          out[k] = replaceInValue(vv);
        }
      }
      return out;
    }
    return v;
  };

  return replaceInValue(json) as Record<string, unknown>;
}

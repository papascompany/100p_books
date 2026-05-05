import "server-only";

import { nanoid } from "nanoid";
import { z } from "zod";

import { fail, failFromError, ok } from "@/app/api/_lib/response";
import { requireUser } from "@/lib/auth/session";
import { createAdminSupabase } from "@/lib/db/admin";
import { createServerSupabase } from "@/lib/db/server";
import type { BookSize, OrderAddress } from "@/lib/db/types";
import { isPageDoc } from "@/lib/layout/types";
import { calcOrderAmount } from "@/lib/orders/pricing";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** 한국 휴대전화 번호 — 010, 011 등 + 7~8자리. 하이픈 옵션. */
const PHONE_REGEX = /^(\+?82-?|0)1[016789]-?\d{3,4}-?\d{4}$/;
/** 우편번호 — 5자리. */
const ZIP_REGEX = /^\d{5}$/;

const AddressSchema = z.object({
  name: z.string().min(1, "받는 분 이름을 입력하세요.").max(40),
  phone: z
    .string()
    .min(9)
    .max(20)
    .regex(PHONE_REGEX, "전화번호 형식이 올바르지 않습니다."),
  zip: z.string().regex(ZIP_REGEX, "우편번호는 5자리 숫자입니다."),
  addr1: z.string().min(1, "주소를 입력하세요.").max(200),
  addr2: z.string().max(200).optional(),
  memo: z.string().max(200).optional(),
});

const BodySchema = z.object({
  projectId: z.string().uuid(),
  qty: z.number().int().min(1).max(10),
  address: AddressSchema,
});

/**
 * POST /api/orders/create
 *
 *   body:
 *     {
 *       projectId: uuid,
 *       qty: 1..10,
 *       address: { name, phone, zip, addr1, addr2?, memo? }
 *     }
 *
 *   응답:
 *     {
 *       orderId: uuid,
 *       amount: int (KRW),
 *       tossOrderId: string,        // 토스 식별자 (8자 short id)
 *       tossOrderName: string,      // "${bookSize.name} ${pageCount}p (수량 ${qty})"
 *       breakdown: { unit, surcharge, discount, total }
 *     }
 *
 * 흐름:
 *   1. 인증 + 소유권.
 *   2. pages 카운트 + cover_json 존재 확인.
 *   3. book_sizes 로드 → calcOrderAmount.
 *   4. orders INSERT (status=pending, amount, address, toss_order_id).
 */
export async function POST(req: Request) {
  try {
    const user = await requireUser();

    const raw = (await req.json().catch(() => ({}))) as unknown;
    const parsed = BodySchema.safeParse(raw ?? {});
    if (!parsed.success) {
      return fail(
        "INVALID_BODY",
        "요청 본문이 올바르지 않습니다.",
        400,
        parsed.error.flatten(),
      );
    }
    const { projectId, qty, address } = parsed.data;

    const supabase = createServerSupabase();

    // 1) 소유권
    const { data: project, error: projErr } = await supabase
      .from("projects")
      .select("id, user_id, book_size_id, title, cover_json")
      .eq("id", projectId)
      .maybeSingle();
    if (projErr) return fail("PROJECT_QUERY_FAILED", projErr.message, 500);
    if (!project) return fail("NOT_FOUND", "프로젝트를 찾을 수 없습니다.", 404);
    if (project.user_id !== user.id) {
      return fail("FORBIDDEN", "해당 프로젝트에 대한 권한이 없습니다.", 403);
    }

    // 2) pages 카운트 + cover_json 존재 확인
    const [{ count: pageCount, error: pagesErr }, { data: bookSizeRow, error: sizeErr }] =
      await Promise.all([
        supabase
          .from("pages")
          .select("id", { count: "exact", head: true })
          .eq("project_id", projectId),
        supabase
          .from("book_sizes")
          .select(
            "id, name, width_mm, height_mm, cover_width_mm, cover_height_mm, spine_formula_per_page, active, display_order, created_at",
          )
          .eq("id", project.book_size_id)
          .maybeSingle(),
      ]);
    if (pagesErr) return fail("PAGES_QUERY_FAILED", pagesErr.message, 500);
    if (sizeErr) return fail("BOOK_SIZE_QUERY_FAILED", sizeErr.message, 500);
    if (!bookSizeRow) {
      return fail("NOT_FOUND", "책 사이즈를 찾을 수 없습니다.", 404);
    }
    const bookSize: BookSize = bookSizeRow;
    const pages = pageCount ?? 0;

    if (pages === 0) {
      return fail(
        "NO_PAGES",
        "내지 페이지가 없습니다. 자동 편집을 먼저 진행하세요.",
        400,
      );
    }

    const stored = project.cover_json as unknown;
    if (!stored || !isPageDoc(stored) || stored.layoutMode !== "cover") {
      return fail("NO_COVER", "표지를 먼저 편집하세요.", 400);
    }

    // 3) 가격 계산
    const breakdown = calcOrderAmount({
      bookSize: bookSize.name,
      pageCount: pages,
      qty,
    });

    // 4) orders INSERT (service_role 필요 — RLS 정책상 사용자 INSERT 불가)
    const admin = createAdminSupabase();
    const tossOrderId = `100p-${nanoid(8)}`;
    const tossOrderName = `${bookSize.name} ${pages}p (수량 ${qty})`;

    const { data: inserted, error: insErr } = await admin
      .from("orders")
      .insert({
        project_id: projectId,
        user_id: user.id,
        qty,
        amount: breakdown.total,
        address: address as OrderAddress,
        status: "pending",
        toss_order_id: tossOrderId,
        toss_payment_key: null,
        cover_pdf_key: null,
        interior_pdf_key: null,
        paid_at: null,
      })
      .select("id, amount, toss_order_id, created_at")
      .single();
    if (insErr || !inserted) {
      return fail(
        "ORDER_INSERT_FAILED",
        insErr?.message ?? "주문 생성에 실패했습니다.",
        500,
      );
    }

    return ok({
      orderId: inserted.id,
      amount: inserted.amount,
      tossOrderId: inserted.toss_order_id,
      tossOrderName,
      breakdown,
    });
  } catch (err) {
    return failFromError(err);
  }
}

import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { nanoid } from "nanoid";
import { z } from "zod";

import { fail, failFromError, ok } from "@/app/api/_lib/response";
import { requireActiveUser } from "@/lib/auth/session";
import { createAdminSupabase } from "@/lib/db/admin";
import { createServerSupabase } from "@/lib/db/server";
import type { BookSize, Database, DiscountCode, OrderAddress } from "@/lib/db/types";
import { reasonMessage, validateDiscount } from "@/lib/discounts/validate";
import { calcCoverDimensions } from "@/lib/layout/cover";
import { isPageDoc } from "@/lib/layout/types";
import {
  calcOrderAmount,
  MIN_PAYMENT_AMOUNT,
  quoteOrder,
} from "@/lib/orders/pricing";
import { sumHeldOrderPoints } from "@/lib/orders/refund";

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
  /** 사용자 입력 할인 코드 (선택). 비어있으면 미사용. */
  discountCode: z.string().trim().min(1).max(40).optional(),
  /** 사용할 포인트 (선택). 0 또는 미설정이면 미사용. 차감은 결제 confirm 시점. */
  usePoints: z.number().int().min(0).optional(),
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
 *       breakdown: { unit, surcharge, discount, total },
 *       reused: boolean             // 기존 pending 주문을 갱신해 재사용했는가
 *     }
 *
 * 흐름:
 *   1. 인증 + 소유권.
 *   2. pages 카운트 + cover_json 존재 확인.
 *   3. book_sizes 로드 → quoteOrder (결제 confirm 의 재검증과 같은 함수).
 *   4. 같은 사용자·프로젝트의 재사용 가능한 pending 주문이 있으면 갱신, 없으면 INSERT.
 *
 * 재사용 (DEBT-6 일부):
 *   결제창을 닫고 다시 "결제하기" 를 누를 때마다 pending 주문이 새로 쌓이던 문제.
 *   이전 주문을 cancelled 로 정리하지 않고 **갱신해 재사용**한다 — cancelled 주문이 생기면
 *   프로젝트 삭제가 FK 로 부분 실패하는 DEBT-9 를 자주 밟게 되기 때문이다.
 *   재사용 조건: pending + paymentKey 미바인딩(결제 승인 시도 전) + 크레딧이 잡혀 있지 않음.
 *   toss_order_id 는 새로 발급한다 — 이전 결제창(같은 주문번호)이 뒤늦게 승인을 시도해도
 *   confirm 의 주문번호 대조에서 캡처 전에 막힌다.
 */
export async function POST(req: Request) {
  try {
    const user = await requireActiveUser();

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
    const { projectId, qty, address, discountCode, usePoints } = parsed.data;

    const supabase = await createServerSupabase();

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

    // 2-1) 표지 규격 게이트 — 규격 개정 이전(2배 폭 등) cover_json 이면
    // 크롭마크가 어긋난 인쇄 PDF 가 생성되므로 주문 전에 재생성을 요구한다.
    // (표지 에디터가 동일 조건에서 "새 규격으로 다시 만들기" 배너를 띄운다.)
    const expectedCover = calcCoverDimensions({ bookSize, pageCount: pages });
    if (Math.abs(expectedCover.totalWidthMm - stored.widthMm) > 0.5) {
      return fail(
        "COVER_FORMAT_OUTDATED",
        "표지 규격이 갱신되었어요. 표지 편집기에서 '새 규격으로 다시 만들기'를 실행한 뒤 다시 주문해주세요.",
        409,
      );
    }

    // 3) 가격 계산
    const breakdown = calcOrderAmount({
      bookSize: bookSize.name,
      pageCount: pages,
      qty,
    });

    // 3-1) 할인 코드 (선택) — 서버에서 재검증 + 금액 재계산
    const admin = createAdminSupabase();
    let discountCodeRow: DiscountCode | null = null;
    if (discountCode) {
      const dv = await validateDiscount({
        supabase: admin,
        code: discountCode,
        userId: user.id,
        subtotal: breakdown.total,
      });
      if (!dv.valid) {
        return fail(
          "DISCOUNT_INVALID",
          reasonMessage(dv.reason),
          400,
          { reason: dv.reason },
        );
      }
      discountCodeRow = dv.code;
    }
    const discountCodeId = discountCodeRow?.id ?? null;

    // 3-2) 포인트 사용 (선택) — 잔액 검증.
    //   실제 차감은 결제 confirm 이 캡처 **전**에 reserve_order_credits 로 원자 선점한다.
    //   여기서는 검증만 + 주문 amount 산정.
    if (usePoints && usePoints > 0) {
      const { data: pts, error: ptsErr } = await admin
        .from("user_points")
        .select("balance")
        .eq("user_id", user.id)
        .maybeSingle();
      if (ptsErr) {
        return fail("POINTS_QUERY_FAILED", ptsErr.message, 500);
      }
      const balance = pts?.balance ?? 0;
      if (balance < usePoints) {
        return fail(
          "POINTS_INSUFFICIENT",
          `포인트 잔액이 부족합니다. (보유 ${balance}, 사용 ${usePoints})`,
          400,
          { balance, requested: usePoints },
        );
      }
    }

    // 사용 포인트·최종 금액 정본 — quoteOrder 하나로 계산한다.
    //   클라이언트(OrderForm)와 같은 clampPointsForMinPayment(100P 단위 내림 + 토스 최소
    //   결제 금액 100원 확보)를 쓰고, 결제 confirm 의 재검증(detectOrderPricingDrift)도
    //   같은 함수라 생성 시점과 결제 시점의 금액 규칙이 갈라지지 않는다.
    const { discountAmount, pointsUsed, finalAmount } = quoteOrder({
      bookSize: bookSize.name,
      pageCount: pages,
      qty,
      discount: discountCodeRow,
      requestedPoints: usePoints ?? 0,
    });

    // 토스는 100원 미만 결제 요청 자체가 불가 — 결제할 수 없는 주문을
    // 만들지 않는다. (포인트는 위에서 클램프되므로 이 게이트에 걸리는 건
    // 사실상 할인 코드만으로 100원 미만이 된 경우.)
    if (finalAmount < MIN_PAYMENT_AMOUNT) {
      return fail(
        "AMOUNT_BELOW_MINIMUM",
        `최종 결제 금액이 최소 결제 금액(${MIN_PAYMENT_AMOUNT}원) 미만입니다. 할인 적용을 조정해주세요.`,
        400,
        { finalAmount },
      );
    }

    // 4) orders 재사용 또는 INSERT (service_role 필요 — RLS 정책상 사용자 INSERT 불가)
    const tossOrderId = `100p-${nanoid(8)}`;
    const tossOrderName = `${bookSize.name} ${pages}p (수량 ${qty})`;
    const orderValues = {
      qty,
      amount: finalAmount,
      address: address as OrderAddress,
      toss_order_id: tossOrderId,
      discount_code_id: discountCodeId,
      discount_amount: discountAmount,
      points_used: pointsUsed,
    };
    const respond = (
      row: { id: string; amount: number; toss_order_id: string | null },
      reused: boolean,
    ) =>
      ok({
        orderId: row.id,
        amount: row.amount,
        tossOrderId: row.toss_order_id,
        tossOrderName,
        breakdown,
        discount: discountCodeId
          ? {
              codeId: discountCodeId,
              amount: discountAmount,
            }
          : null,
        pointsUsed,
        reused,
      });

    const reused = await reuseAbandonedPendingOrder(admin, {
      userId: user.id,
      projectId,
      values: orderValues,
    });
    if (reused) return respond(reused, true);

    const { data: inserted, error: insErr } = await admin
      .from("orders")
      .insert({
        project_id: projectId,
        user_id: user.id,
        ...orderValues,
        status: "pending",
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

    return respond(inserted, false);
  } catch (err) {
    return failFromError(err);
  }
}

type Admin = SupabaseClient<Database>;

interface ReusableOrderValues {
  qty: number;
  amount: number;
  address: OrderAddress;
  toss_order_id: string;
  discount_code_id: string | null;
  discount_amount: number;
  points_used: number;
}

/**
 * 같은 사용자·프로젝트의 "결제창에서 이탈한" pending 주문을 새 주문서 값으로 갱신해 재사용.
 *
 *   - paymentKey 가 묶인 주문은 결제 승인 시도가 진행 중이거나 캡처 뒤 복구 대기일 수 있어
 *     절대 건드리지 않는다(confirm 이 캡처 전에 바인딩한다).
 *   - 크레딧(원장 순액·할인 사용 기록)이 잡혀 있는 주문도 건너뛴다 — 금액을 바꾸면
 *     reserve_order_credits 가 CREDITS_STATE_INVALID 로 결제를 영구히 막는다.
 *   - 갱신은 updated_at 비교 후 교체(CAS)라 더블클릭 동시 요청 중 한쪽만 재사용하고,
 *     진 쪽은 새 주문을 INSERT 한다(두 결제창이 서로의 주문번호를 덮지 않게).
 *   - 조회·갱신 실패는 재사용만 포기하고 INSERT 로 진행한다(주문 자체를 막지 않음).
 */
async function reuseAbandonedPendingOrder(
  admin: Admin,
  args: { userId: string; projectId: string; values: ReusableOrderValues },
): Promise<{ id: string; amount: number; toss_order_id: string | null } | null> {
  try {
    const { data: candidate, error } = await admin
      .from("orders")
      .select("id, updated_at")
      .eq("user_id", args.userId)
      .eq("project_id", args.projectId)
      .eq("status", "pending")
      .is("toss_payment_key", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error || !candidate) return null;

    const [held, { count: uses, error: usesErr }] = await Promise.all([
      sumHeldOrderPoints(admin, candidate.id),
      admin
        .from("discount_uses")
        .select("id", { count: "exact", head: true })
        .eq("order_id", candidate.id),
    ]);
    if (usesErr || held !== 0 || (uses ?? 0) > 0) return null;

    // created_at 도 지금으로 — 재사용은 사실상 새 주문서다. 나이 기준으로 오래된 pending 을
    // 정리하는 작업이 방금 결제창을 연 주문을 취소하지 않게 한다.
    const { data: updated, error: upErr } = await admin
      .from("orders")
      .update({ ...args.values, created_at: new Date().toISOString() })
      .eq("id", candidate.id)
      .eq("status", "pending")
      .is("toss_payment_key", null)
      .eq("updated_at", candidate.updated_at)
      .select("id, amount, toss_order_id")
      .maybeSingle();
    if (upErr || !updated) return null;
    return updated;
  } catch (e) {
    console.warn(
      "[orders/create] pending 주문 재사용 실패 — 새 주문으로 진행:",
      e instanceof Error ? e.message : String(e),
    );
    return null;
  }
}

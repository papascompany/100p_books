import "server-only";

import { z } from "zod";

import { fail, failFromError, ok } from "@/app/api/_lib/response";
import { requireUser } from "@/lib/auth/session";
import { createAdminSupabase } from "@/lib/db/admin";
import {
  normalizeCode,
  reasonMessage,
  validateDiscount,
} from "@/lib/discounts/validate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z.object({
  code: z.string().trim().min(1).max(40),
  /** 검증 시점의 합계 (KRW). 클라 표시용 — 서버는 결제 confirm 에서 재계산하므로 보안상 신뢰 X. */
  subtotal: z.number().int().positive().max(100_000_000),
});

/**
 * POST /api/discounts/validate
 *
 *   body: { code: string, subtotal: number }
 *
 *   응답 (성공):
 *     {
 *       valid: true,
 *       codeId: uuid,
 *       code: 'XXXX',
 *       type: 'percent' | 'amount',
 *       value: number,
 *       discountAmount: number    // subtotal 기준 차감액
 *     }
 *
 *   응답 (실패 — HTTP 200, valid=false):
 *     {
 *       valid: false,
 *       reason: 'not_found' | 'inactive' | 'expired' | 'limit_reached' | 'already_used' | 'subtotal_too_low',
 *       message: string
 *     }
 *
 * 비고:
 *   - 코드 enumeration 방지: 어떤 사유든 동일 응답 형태로 반환 (timing 차이 외 노출 X).
 *   - 실제 결제 시점에 다시 한 번 검증 + discount_uses INSERT.
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
    const { code, subtotal } = parsed.data;

    const admin = createAdminSupabase();
    const result = await validateDiscount({
      supabase: admin,
      code,
      userId: user.id,
      subtotal,
    });

    if (!result.valid) {
      return ok({
        valid: false as const,
        reason: result.reason,
        message: reasonMessage(result.reason),
        normalized: normalizeCode(code),
      });
    }

    return ok({
      valid: true as const,
      codeId: result.code.id,
      code: result.code.code,
      type: result.code.type,
      value: Number(result.code.value),
      discountAmount: result.discountAmount,
    });
  } catch (err) {
    return failFromError(err);
  }
}

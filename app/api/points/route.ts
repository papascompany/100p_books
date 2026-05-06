import "server-only";

import { failFromError, ok } from "@/app/api/_lib/response";
import { requireUser } from "@/lib/auth/session";
import { createAdminSupabase } from "@/lib/db/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/points
 *
 * 응답: { balance: number, updatedAt: string | null }
 *
 * user_points 행이 없는 신규 사용자는 balance=0 으로 처리한다.
 * 차감/적립은 본 라우트가 아닌 결제/추천 보상 라우트에서만 수행 (service_role).
 */
export async function GET() {
  try {
    const user = await requireUser();
    const admin = createAdminSupabase();

    const { data, error } = await admin
      .from("user_points")
      .select("balance, updated_at")
      .eq("user_id", user.id)
      .maybeSingle();

    if (error) {
      return failFromError(new Error(`포인트 조회 실패: ${error.message}`));
    }

    return ok({
      balance: data?.balance ?? 0,
      updatedAt: data?.updated_at ?? null,
    });
  } catch (err) {
    return failFromError(err);
  }
}

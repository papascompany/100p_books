import "server-only";

import { z } from "zod";

import { fail, failFromError, ok } from "@/app/api/_lib/response";
import { createAdminSupabase } from "@/lib/db/admin";
import { enforceRateLimit } from "@/lib/security/rate-limit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/auth/signup
 *   body: { email, password }
 *
 * 이메일+비밀번호 회원가입을 서버에서 처리한다.
 *
 * 왜 클라 supabase.auth.signUp 이 아닌 서버 admin.createUser 인가:
 *   - admin.createUser({ email_confirm: true }) 는 Supabase 의 "Confirm email"
 *     설정과 무관하게 즉시 확인된(=바로 로그인 가능) 계정을 만든다.
 *   - 따라서 대시보드 설정에 의존하지 않고 "이메일 인증 없이 즉시 가입" 을 보장.
 *   - 확인 메일도 발송하지 않으므로 사용자는 메일을 전혀 거치지 않는다.
 *
 * 가입 직후 세션은 클라이언트가 signInWithPassword 로 발급받는다.
 *
 * 보안:
 *   - service_role 은 서버에서만 사용 (createAdminSupabase).
 *   - IP 당 시간당 10회 rate limit (남용/스팸 계정 차단).
 *   - 약관 동의 시각은 record_agreements RPC 로 기록.
 */
const BodySchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(6, "비밀번호는 최소 6자 이상이어야 합니다.").max(72),
});

export async function POST(req: Request) {
  try {
    // 🛡 Rate limit — IP 기준 (미인증 요청)
    const rl = await enforceRateLimit("signup", req, null);
    if (!rl.success) {
      return fail(
        "RATE_LIMITED",
        "가입 시도가 너무 잦습니다. 잠시 후 다시 시도해 주세요.",
        429,
        { resetAt: rl.reset, limit: rl.limit },
      );
    }

    const raw = (await req.json().catch(() => ({}))) as unknown;
    const parsed = BodySchema.safeParse(raw ?? {});
    if (!parsed.success) {
      return fail(
        "INVALID_BODY",
        parsed.error.issues[0]?.message ?? "입력값이 올바르지 않습니다.",
        400,
      );
    }
    const email = parsed.data.email.trim().toLowerCase();
    const { password } = parsed.data;

    const admin = createAdminSupabase();

    // 즉시 확인된 계정 생성 (확인 메일 없음)
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });

    if (error) {
      const msg = (error.message || "").toLowerCase();
      // 이미 등록된 이메일
      if (
        msg.includes("already") ||
        msg.includes("registered") ||
        msg.includes("exists") ||
        (error as { status?: number }).status === 422
      ) {
        return fail(
          "EMAIL_EXISTS",
          "이미 가입된 이메일이에요. 로그인하거나 비밀번호 찾기를 이용하세요.",
          409,
        );
      }
      return fail("SIGNUP_FAILED", error.message || "회원가입에 실패했습니다.", 400);
    }

    const userId = data.user?.id;
    if (userId) {
      // 약관 동의 시각 기록 (best-effort)
      try {
        await admin.rpc("record_agreements", { p_user_id: userId });
      } catch {
        // 무시 — 가입 자체는 성공
      }
    }

    return ok({ created: true, email });
  } catch (err) {
    return failFromError(err);
  }
}

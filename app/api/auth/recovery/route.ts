import "server-only";

import { NextResponse } from "next/server";

import { PASSWORD_RECOVERY_COOKIE } from "@/lib/auth/recovery";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * DELETE /api/auth/recovery
 *
 * 비밀번호 재설정 마커 쿠키를 즉시 만료시킨다.
 * 재설정 폼이 변경에 성공한 직후 호출한다 — 같은 기기에서 남은 유효시간 동안
 * 폼이 다시 열리는 것을 막는다. (미호출이어도 15분 뒤 자동 만료.)
 */
export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set({
    name: PASSWORD_RECOVERY_COOKIE,
    value: "",
    path: "/",
    maxAge: 0,
  });
  return res;
}

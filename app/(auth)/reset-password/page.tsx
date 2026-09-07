import type { Metadata } from "next";
import { cookies } from "next/headers";
import { Suspense } from "react";

import { PASSWORD_RECOVERY_COOKIE } from "@/lib/auth/recovery";
import { createServerSupabase } from "@/lib/db/server";

import InvalidLinkCard from "./InvalidLinkCard";
import ResetPasswordForm from "./ResetPasswordForm";

export const metadata: Metadata = {
  title: "비밀번호 재설정",
  description: "새 비밀번호를 설정하세요.",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * 재설정 폼은 **재설정 메일 링크를 실제로 통과한 경우에만** 렌더한다.
 *
 * 이전에는 클라이언트가 `getSession()` 결과의 존재만 확인했기 때문에,
 * 그냥 로그인한 사용자가 주소창에 `/reset-password` 를 치면 현재 비밀번호를
 * 묻지 않고 비밀번호를 바꿀 수 있었다. 로그아웃 UI 부재와 겹쳐 공용 기기에서
 * 계정 영구 탈취가 가능했다.
 *
 * 게이트: `/api/auth/callback` 이 심은 httpOnly 마커 쿠키 == 현재 세션 사용자 id.
 * getUser() 로 서버 검증한 값과 비교하므로 쿠키 위조만으로는 통과할 수 없다.
 */
export default async function ResetPasswordPage() {
  const marker = cookies().get(PASSWORD_RECOVERY_COOKIE)?.value ?? null;

  let userId: string | null = null;
  if (marker) {
    try {
      const { data } = await createServerSupabase().auth.getUser();
      userId = data.user?.id ?? null;
    } catch {
      userId = null;
    }
  }

  if (!marker || !userId || marker !== userId) {
    return <InvalidLinkCard />;
  }

  return (
    <Suspense fallback={null}>
      <ResetPasswordForm />
    </Suspense>
  );
}

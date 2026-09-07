import { LogOut } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * 로그아웃 버튼.
 *
 * form POST 라 JS 가 죽어도 동작한다 — 서버가 세션 쿠키를 지우고 303 으로 홈에 보낸다.
 * (클라이언트 supabase 세션도 쿠키 저장소를 쓰므로 서버 삭제만으로 함께 끊긴다.)
 *
 * 배경: 이 버튼이 생기기 전까지 일반 사용자에게는 **로그아웃 수단이 아예 없었다**
 *       (`/api/auth/sign-out` 의 유일한 호출자가 관리자 사이드바였다).
 *       공용 기기에 세션이 남으면 다음 사용자가 계정을 그대로 쓸 수 있었다.
 */
export default function SignOutButton({
  className,
  label = "로그아웃",
  showIcon = true,
}: {
  className?: string;
  label?: string;
  showIcon?: boolean;
}) {
  return (
    <form action="/api/auth/sign-out" method="post" className="contents">
      <button
        type="submit"
        className={cn(
          "inline-flex items-center gap-2 text-sm font-medium transition-colors",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          className,
        )}
      >
        {showIcon ? <LogOut className="size-4" aria-hidden /> : null}
        {label}
      </button>
    </form>
  );
}

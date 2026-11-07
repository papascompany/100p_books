import { requireUser } from "@/lib/auth/session";

import UsersClient from "./UsersClient";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function AdminUsersPage() {
  // 본인 행 표시용 — layout 의 requireAdmin 이 이미 같은 요청에서 호출해 React cache 로 재사용된다.
  const me = await requireUser().catch(() => null);
  return (
    <div className="space-y-4">
      <header>
        <h1 className="font-display text-2xl font-semibold tracking-tight md:text-3xl">
          사용자
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          이메일 / 역할 관리. 자기 자신의 admin 해제는 차단됩니다.
        </p>
      </header>
      <UsersClient selfId={me?.id ?? null} />
    </div>
  );
}

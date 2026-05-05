import UsersClient from "./UsersClient";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default function AdminUsersPage() {
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
      <UsersClient />
    </div>
  );
}

import AuditClient from "./AuditClient";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default function AdminAuditPage() {
  return (
    <div className="space-y-4">
      <header>
        <h1 className="font-display text-2xl font-semibold tracking-tight md:text-3xl">
          감사 로그
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          관리자 핵심 액션의 시각/주체/대상/세부정보를 50건씩 표시합니다.
        </p>
      </header>
      <AuditClient />
    </div>
  );
}

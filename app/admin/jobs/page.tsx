import JobsClient from "./JobsClient";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default function AdminJobsPage() {
  return (
    <div className="space-y-4">
      <header>
        <h1 className="font-display text-2xl font-semibold tracking-tight md:text-3xl">
          PDF 빌드 잡
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          상태/기간으로 필터링. 실패 잡은 재시도 가능 (max_attempts 까지).
        </p>
      </header>
      <JobsClient />
    </div>
  );
}

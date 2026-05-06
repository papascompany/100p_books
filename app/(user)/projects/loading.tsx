export default function ProjectsLoading() {
  return (
    <div className="container py-6 md:py-10">
      {/* 헤더 스켈레톤 */}
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="h-8 w-32 animate-pulse rounded-lg bg-muted" />
          <div className="h-5 w-6 animate-pulse rounded-full bg-muted" />
        </div>
        <div className="h-9 w-32 animate-pulse rounded-lg bg-muted" />
      </div>

      {/* 카드 그리드 스켈레톤 */}
      <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <li key={i} className="overflow-hidden rounded-xl border bg-card">
            <div className="aspect-square w-full animate-pulse bg-muted" />
            <div className="px-3 py-3">
              <div className="h-4 w-3/4 animate-pulse rounded bg-muted" />
              <div className="mt-1.5 h-3 w-1/2 animate-pulse rounded bg-muted" />
              <div className="mt-2 h-3 w-1/3 animate-pulse rounded bg-muted" />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

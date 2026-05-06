export default function GalleryLoading() {
  return (
    <div className="container mx-auto max-w-5xl px-4 py-10 animate-pulse">
      <div className="mb-8 space-y-2">
        <div className="h-9 w-36 rounded-lg bg-muted" />
        <div className="h-4 w-64 rounded bg-muted" />
      </div>
      {/* 정렬 탭 스켈레톤 */}
      <div className="mb-6 flex gap-2">
        <div className="h-9 w-20 rounded-full bg-muted" />
        <div className="h-9 w-20 rounded-full bg-muted" />
      </div>
      {/* 카드 그리드 스켈레톤 */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="overflow-hidden rounded-xl border bg-card">
            <div className="aspect-square bg-muted" />
            <div className="space-y-2 p-3">
              <div className="flex gap-1">
                {Array.from({ length: 5 }).map((_, j) => (
                  <div key={j} className="h-3 w-3 rounded bg-muted" />
                ))}
              </div>
              <div className="h-3 w-full rounded bg-muted" />
              <div className="h-3 w-2/3 rounded bg-muted" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

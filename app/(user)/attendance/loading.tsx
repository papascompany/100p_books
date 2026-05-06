export default function AttendanceLoading() {
  return (
    <div className="container max-w-lg py-8 animate-pulse">
      <div className="mb-6 flex items-center justify-between">
        <div className="space-y-2">
          <div className="h-8 w-28 rounded-lg bg-muted" />
          <div className="h-4 w-48 rounded bg-muted" />
        </div>
        <div className="h-8 w-20 rounded-full bg-muted" />
      </div>
      {/* 캘린더 카드 스켈레톤 */}
      <div className="rounded-xl border bg-card p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div className="h-5 w-32 rounded bg-muted" />
          <div className="h-4 w-20 rounded bg-muted" />
        </div>
        {/* 요일 헤더 */}
        <div className="grid grid-cols-7 gap-1">
          {Array.from({ length: 7 }).map((_, i) => (
            <div key={i} className="h-4 rounded bg-muted" />
          ))}
        </div>
        {/* 날짜 셀 */}
        {Array.from({ length: 5 }).map((_, row) => (
          <div key={row} className="grid grid-cols-7 gap-1">
            {Array.from({ length: 7 }).map((_, col) => (
              <div key={col} className="mx-auto size-9 rounded-full bg-muted" />
            ))}
          </div>
        ))}
        <div className="pt-2">
          <div className="h-10 w-full rounded-lg bg-muted" />
        </div>
      </div>
    </div>
  );
}

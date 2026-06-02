export default function AttendanceLoading() {
  return (
    <div className="container max-w-lg py-8 animate-pulse">
      <div className="mb-6 flex items-center justify-between">
        <div className="space-y-2">
          <div className="h-8 w-28 bg-hairline rounded" />
          <div className="h-4 w-48 bg-soft-cloud rounded" />
        </div>
        <div className="h-8 w-20 bg-hairline rounded" />
      </div>
      {/* 캘린더 카드 스켈레톤 */}
      <div className="rounded-2xl border border-hairline bg-soft-cloud p-5 space-y-4 shadow-soft">
        <div className="flex items-center justify-between">
          <div className="h-5 w-32 bg-hairline rounded" />
          <div className="h-4 w-20 bg-hairline rounded" />
        </div>
        {/* 요일 헤더 */}
        <div className="grid grid-cols-7 gap-1">
          {Array.from({ length: 7 }).map((_, i) => (
            <div key={i} className="h-4 bg-hairline rounded" />
          ))}
        </div>
        {/* 날짜 셀 */}
        {Array.from({ length: 5 }).map((_, row) => (
          <div key={row} className="grid grid-cols-7 gap-1">
            {Array.from({ length: 7 }).map((_, col) => (
              <div key={col} className="mx-auto size-9 rounded-full bg-hairline" />
            ))}
          </div>
        ))}
        <div className="pt-2">
          <div className="h-10 w-full bg-hairline rounded-md" />
        </div>
      </div>
    </div>
  );
}

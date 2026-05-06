export default function UserLoading() {
  return (
    <div className="container py-8 animate-pulse">
      {/* 페이지 타이틀 스켈레톤 */}
      <div className="mb-6 space-y-2">
        <div className="h-8 w-48 bg-[#e5e5e5]" />
        <div className="h-4 w-72 bg-[#e5e5e5]" />
      </div>
      {/* 카드 그리드 스켈레톤 */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="border border-[#e5e5e5] bg-[#f5f5f5] p-6 space-y-3">
            <div className="h-5 w-3/4 bg-[#e5e5e5]" />
            <div className="h-4 w-full bg-[#e5e5e5]" />
            <div className="h-4 w-2/3 bg-[#e5e5e5]" />
          </div>
        ))}
      </div>
    </div>
  );
}

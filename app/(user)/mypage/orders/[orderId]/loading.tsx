export default function OrderDetailLoading() {
  return (
    <div className="container py-6 md:py-10 animate-pulse">
      <div className="mb-3 h-3 w-20 bg-[#e5e5e5]" />
      <div className="mb-6 space-y-2">
        <div className="h-8 w-64 bg-[#e5e5e5]" />
        <div className="h-3 w-72 bg-[#e5e5e5]" />
      </div>
      <div className="grid gap-6 md:grid-cols-2">
        {Array.from({ length: 2 }).map((_, i) => (
          <div
            key={i}
            className="rounded-2xl border border-[#e5e5e5] bg-[#f5f5f5] p-4 sm:p-5 space-y-3"
          >
            <div className="h-4 w-24 bg-[#e5e5e5]" />
            {Array.from({ length: 4 }).map((__, j) => (
              <div key={j} className="flex justify-between">
                <div className="h-3 w-20 bg-[#e5e5e5]" />
                <div className="h-3 w-32 bg-[#e5e5e5]" />
              </div>
            ))}
          </div>
        ))}
      </div>
      <div className="mt-6 rounded-2xl border border-[#e5e5e5] bg-[#f5f5f5] p-4 sm:p-5">
        <div className="h-4 w-24 bg-[#e5e5e5] mb-3" />
        <div className="flex gap-2">
          <div className="h-10 w-32 bg-[#e5e5e5]" />
          <div className="h-10 w-32 bg-[#e5e5e5]" />
        </div>
      </div>
    </div>
  );
}

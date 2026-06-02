export default function PointsLoading() {
  return (
    <div className="container mx-auto max-w-3xl px-4 py-10 animate-pulse">
      <div className="mb-3 h-3 w-20 bg-hairline" />
      <div className="mb-6 space-y-2">
        <div className="h-8 w-36 bg-hairline" />
        <div className="h-3 w-72 bg-hairline" />
      </div>
      <div className="rounded-2xl border border-hairline bg-white p-5">
        <div className="mb-4 grid grid-cols-3 gap-2 rounded-xl border border-hairline bg-soft-cloud p-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="space-y-1.5 text-center">
              <div className="mx-auto h-3 w-12 bg-hairline" />
              <div className="mx-auto h-5 w-16 bg-hairline" />
            </div>
          ))}
        </div>
        <div className="space-y-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex justify-between gap-3 py-2">
              <div className="flex gap-2">
                <div className="size-7 rounded-full bg-hairline" />
                <div className="space-y-1.5">
                  <div className="h-3 w-24 bg-hairline" />
                  <div className="h-2.5 w-16 bg-hairline" />
                </div>
              </div>
              <div className="space-y-1.5 text-right">
                <div className="h-3 w-16 bg-hairline" />
                <div className="h-2.5 w-20 bg-hairline" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

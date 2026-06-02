export default function OrdersLoading() {
  return (
    <div className="container max-w-2xl py-8 animate-pulse">
      <div className="mb-6 h-7 w-24 bg-hairline" />
      <div className="space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="border border-hairline bg-soft-cloud p-4">
            <div className="flex items-center justify-between">
              <div className="space-y-2">
                <div className="h-4 w-40 bg-hairline" />
                <div className="h-3 w-28 bg-hairline" />
              </div>
              <div className="h-7 w-16 bg-hairline" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

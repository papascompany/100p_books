export default function OrderLoading() {
  return (
    <div className="container max-w-2xl py-8 animate-pulse">
      <div className="mb-6 space-y-2">
        <div className="h-7 w-32 bg-[#e5e5e5]" />
        <div className="h-3 w-72 bg-[#e5e5e5]" />
      </div>
      <div className="space-y-4">
        <div className="rounded-2xl border border-[#e5e5e5] bg-[#f5f5f5] p-5 space-y-3">
          <div className="h-4 w-20 bg-[#e5e5e5]" />
          <div className="flex items-center justify-between">
            <div className="h-4 w-32 bg-[#e5e5e5]" />
            <div className="h-10 w-32 bg-[#e5e5e5]" />
          </div>
        </div>
        <div className="rounded-2xl border border-[#e5e5e5] bg-[#f5f5f5] p-5 space-y-3">
          <div className="h-4 w-16 bg-[#e5e5e5]" />
          <div className="h-10 w-full bg-[#e5e5e5]" />
          <div className="h-10 w-full bg-[#e5e5e5]" />
          <div className="h-10 w-full bg-[#e5e5e5]" />
        </div>
        <div className="rounded-2xl border border-[#e5e5e5] bg-[#f5f5f5] p-5">
          <div className="flex justify-between mb-2">
            <div className="h-4 w-24 bg-[#e5e5e5]" />
            <div className="h-4 w-20 bg-[#e5e5e5]" />
          </div>
          <div className="flex justify-between">
            <div className="h-6 w-20 bg-[#e5e5e5]" />
            <div className="h-6 w-32 bg-[#e5e5e5]" />
          </div>
        </div>
        <div className="h-12 w-full bg-[#e5e5e5]" />
      </div>
    </div>
  );
}

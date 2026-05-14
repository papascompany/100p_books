export default function AccountLoading() {
  return (
    <div className="container mx-auto max-w-2xl px-4 py-10 animate-pulse">
      <div className="mb-6 h-8 w-32 bg-[#e5e5e5]" />
      <div className="space-y-4">
        <div className="rounded-2xl border border-[#e5e5e5] bg-[#f5f5f5] p-5 space-y-3">
          <div className="h-4 w-24 bg-[#e5e5e5]" />
          <div className="h-3 w-56 bg-[#e5e5e5]" />
          <div className="h-3 w-44 bg-[#e5e5e5]" />
        </div>
        <div className="rounded-2xl border border-[#e5e5e5] bg-[#f5f5f5] p-5 space-y-3">
          <div className="h-4 w-24 bg-[#e5e5e5]" />
          <div className="h-10 w-32 bg-[#e5e5e5]" />
        </div>
      </div>
    </div>
  );
}

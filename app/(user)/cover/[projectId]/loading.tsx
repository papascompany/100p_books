export default function CoverLoading() {
  return (
    <div className="flex h-screen flex-col animate-pulse">
      <div className="flex items-center justify-between border-b border-[#e5e5e5] bg-white px-4 py-3">
        <div className="h-5 w-32 bg-[#e5e5e5]" />
        <div className="flex gap-2">
          <div className="h-9 w-20 bg-[#e5e5e5]" />
          <div className="h-9 w-24 bg-[#e5e5e5]" />
        </div>
      </div>
      <div className="flex flex-1">
        <div className="flex-1 bg-[#f5f5f5]" />
        <div className="w-72 border-l border-[#e5e5e5] bg-white p-4 space-y-3">
          <div className="h-4 w-24 bg-[#e5e5e5]" />
          <div className="h-32 w-full bg-[#e5e5e5]" />
          <div className="h-4 w-24 bg-[#e5e5e5]" />
          <div className="h-32 w-full bg-[#e5e5e5]" />
        </div>
      </div>
    </div>
  );
}
